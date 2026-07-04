<?php
// api/process_payment.php — Charge card via Square Web Payments SDK token
ini_set('display_errors', 0);  // never let PHP errors corrupt the JSON response

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
cors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit('Method not allowed'); }

$d         = body();
$source_id = trim($d['source_id'] ?? '');
$order_id  = trim($d['order_id'] ?? '');

if (!$source_id || !$order_id) fail('Missing source_id or order_id');

applog('PAY-START', "order=$order_id src_len=".strlen($source_id));
$pdo = db();
$biz_name_pp = bizName($pdo);
$biz_email_pp = 'handmadedesignsbysuzi@yahoo.com';
try {
    $bzRaw_pp = getSetting($pdo, 'biz_profile');
    $bz_pp = $bzRaw_pp ? json_decode($bzRaw_pp, true) : null;
    if (!empty($bz_pp['email'])) $biz_email_pp = $bz_pp['email'];
} catch (Exception $e) { /* keep fallback */ }

// test_mode is admin-only bypass for regression tests
if (!empty($d['test_mode'])) requireAdmin();

// Load order
$stmt = $pdo->prepare("SELECT * FROM orders WHERE id = ? LIMIT 1");
$stmt->execute([$order_id]);
$order = $stmt->fetch();
if (!$order) fail('Order not found', 404);
if ($order['status'] !== 'Awaiting Payment') fail('Order is not awaiting payment');

// Recalculate total server-side from stored line items (prevents client-side tampering)
$items = $pdo->prepare("SELECT * FROM order_items WHERE order_id = ?");
$items->execute([$order_id]);
$lineItems = $items->fetchAll();

$subtotal = 0;
$shipping = 0;
foreach ($lineItems as $it) {
    if ($it['product_id'] === '_ship') {
        $shipping = (float)$it['price'];
    } else {
        $subtotal += (float)$it['price'] * (int)$it['quantity'];
    }
}
$tax          = round($subtotal * 0.0975, 2);
$total        = round($subtotal + $shipping + $tax, 2);
$amountCents  = (int)round($total * 100);

// Skip Square in test_mode (regression test bypass)
if (!empty($d['test_mode'])) {
    $pdo->prepare("UPDATE orders SET status='Paid', total=?, tax_amount=?, confirm_sent_at=NOW() WHERE id=?")
        ->execute([$total, $tax, $order_id]);
    ok(['message' => 'Test payment accepted', 'total' => $total, 'order_id' => $order_id]);
}

// Load Square credentials — token from secrets.php, mode/location from DB
$token    = defined('SQUARE_TOKEN') ? SQUARE_TOKEN : '';
$sqMode   = getSetting($pdo, 'square_mode') ?: 'live';
$location = ($sqMode === 'test' && defined('SQUARE_SANDBOX_LOCATION_ID'))
    ? SQUARE_SANDBOX_LOCATION_ID
    : (getSetting($pdo, 'square_location_id') ?: 'LJP687TQBTWTA');
if (!$token) fail('Payment not configured');

$sqBase = ($sqMode === 'test') ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';

// Atomic lock: claim the order before hitting Square — prevents double-charge on concurrent requests
$guard = $pdo->prepare("UPDATE orders SET status='Processing' WHERE id=? AND status='Awaiting Payment'");
$guard->execute([$order_id]);
if ($guard->rowCount() === 0) fail('Order is no longer awaiting payment. Please refresh and try again.');

// Charge the card
$body = [
    'source_id'           => $source_id,
    'idempotency_key'     => $order_id . '-' . substr(md5($source_id), 0, 8),  // per-nonce: dedupes identical retries; allows retry with new card
    'amount_money'        => ['amount' => $amountCents, 'currency' => 'USD'],
    'location_id'         => $location,
    'note'                => $order_id,
    'buyer_email_address' => $order['customer_email'] ?? '',
];

$resp = sq_curl($sqBase . '/v2/payments', 'POST', $body, $token);

if (!$resp || !isset($resp['payment'])) {
    // Roll back status so customer can retry with a different card
    $pdo->prepare("UPDATE orders SET status='Awaiting Payment' WHERE id=? AND status='Processing'")->execute([$order_id]);
    $sqErr  = $resp ? json_encode($resp) : 'sq_curl returned null';
    applog('PAYMENT-FAIL', "order=$order_id mode=$sqMode loc=$location err=$sqErr");
    $errCode = $resp ? ($resp['errors'][0]['code'] ?? '') : '';
    $codeMap = [
        'CARD_DECLINED'                => 'Your card was declined. Please try a different card.',
        'CVV_FAILURE'                  => 'Card security code did not match. Please check and try again.',
        'ADDRESS_VERIFICATION_FAILURE' => 'Billing ZIP code did not match. Please check and try again.',
        'CARD_EXPIRED'                 => 'Your card has expired. Please use a different card.',
        'INSUFFICIENT_FUNDS'           => 'Insufficient funds. Please try a different card.',
        'INVALID_CARD'                 => 'Invalid card number. Please check and try again.',
        'CARD_NOT_SUPPORTED'           => 'This card type is not supported. Please try a different card.',
        'UNAUTHORIZED'                 => 'Payment configuration error. Please contact us.',
        'NOT_FOUND'                    => 'Payment configuration error. Please contact us.',
    ];
    $userMsg = $codeMap[$errCode] ?? ($resp ? ($resp['errors'][0]['detail'] ?? 'Payment failed. Please try again.') : 'Payment failed. Please try again.');
    fail($userMsg);
}

$payment = $resp['payment'];
if ($payment['status'] !== 'COMPLETED') {
    $pdo->prepare("UPDATE orders SET status='Awaiting Payment' WHERE id=? AND status='Processing'")->execute([$order_id]);
    fail('Payment not completed. Status: ' . $payment['status']);
}

$payId = $payment['id'];

// Mark order paid — if this write fails the card was still charged, so log for manual reconciliation
try {
    $pdo->prepare("UPDATE orders SET status='Paid', square_payment_id=?, total=?, tax_amount=?, confirm_sent_at=NOW() WHERE id=?")
        ->execute([$payId, $total, $tax, $order_id]);
} catch (Exception $e) {
    applog('CHARGE-ORPHANED', "order=$order_id sq_payment=$payId err=".$e->getMessage());
    fail('Payment received but order update failed. Please contact us with order reference: '.$order_id);
}

// Increment customer order count
$pdo->prepare("UPDATE customers SET order_count = order_count + 1 WHERE email = ?")
    ->execute([$order['customer_email']]);

// Send confirmation email to customer + admin
$itemHtml = '';
foreach ($lineItems as $it) {
    if ($it['product_id'] === '_ship') continue;
    $lineTotal = number_format((float)$it['price'] * (int)$it['quantity'], 2);
    $itemHtml .= "<tr><td style='padding:.3rem .5rem'>" . htmlspecialchars($it['product_name']) .
        " &times;" . (int)$it['quantity'] . "</td>" .
        "<td style='padding:.3rem .5rem;text-align:right'>$" . $lineTotal . "</td></tr>\n";
}

$firstName = explode(' ', $order['customer_name'])[0];
$html = "<!DOCTYPE html><html><body>
<div style='font-family:sans-serif;max-width:560px;margin:0 auto'>
<div style='background:#2d2220;padding:20px 28px'>
  <h1 style='color:#d4a017;margin:0;font-size:1.4rem'>{$biz_name_pp}</h1>
</div>
<div style='padding:28px'>
  <h2 style='color:#a07810;margin-top:0'>Order Confirmed! 🎉</h2>
  <p>Hi " . htmlspecialchars($firstName) . ", thank you for your order! Your payment has been received and your order is being prepared with care.</p>
  <div style='background:#fffdf0;border:1px solid #e8e0b8;border-radius:10px;padding:16px;margin:16px 0'>
    <table style='width:100%;border-collapse:collapse;font-size:.9rem;table-layout:fixed;word-wrap:break-word'>
      " . $itemHtml . "
      <tr><td style='padding:.3rem .5rem;border-top:1px solid #e8e0b8'>Shipping</td><td style='padding:.3rem .5rem;text-align:right;border-top:1px solid #e8e0b8'>" . ($shipping > 0 ? '$' . number_format($shipping, 2) : 'Free') . "</td></tr>
      <tr><td style='padding:.3rem .5rem'>Tax (9.75%)</td><td style='padding:.3rem .5rem;text-align:right'>$" . number_format($tax, 2) . "</td></tr>
      <tr style='font-weight:700'><td style='padding:.5rem .5rem;border-top:2px solid #d4a017'>Total Charged</td><td style='padding:.5rem .5rem;text-align:right;border-top:2px solid #d4a017;color:#a07810'>$" . number_format($total, 2) . "</td></tr>
    </table>
  </div>
  <p><strong>Paid by:</strong> " . htmlspecialchars($order['payment_method'] ?? 'Credit Card') . (!empty($order['check_number']) ? " (Check #" . htmlspecialchars($order['check_number']) . ")" : "") . "</p>
  <p><strong>Shipping to:</strong> " . htmlspecialchars($order['shipping_address']) . "</p>
  <p>We'll send you a shipping confirmation with tracking info when your order is on its way!</p>
  <p style='color:#6b6040;font-size:.85rem'>Order #" . $order_id . " &bull; Payment ID: " . $payId . "</p>
</div>
<div style='background:#2d2220;padding:16px 28px;text-align:center'>
  <div style='color:rgba(255,255,255,.6);font-size:.8rem'>
    {$biz_name_pp} &bull; Knoxville, TN<br>
    <a href='https://handmadedesignsbysuzi.com' style='color:#d4a017'>handmadedesignsbysuzi.com</a><br>
    Questions? <a href='mailto:{$biz_email_pp}' style='color:#d4a017'>{$biz_email_pp}</a>
  </div>
</div>
</div></body></html>";

require_once dirname(__DIR__) . '/mailer.php';
$recipients = [$order['customer_email'], 'handmadedesignsbysuzi@yahoo.com'];
$mailResult = sendEmail($recipients, 'Order Confirmed — ' . $order_id, $html, 'handmadedesignsbysuzi@yahoo.com', $biz_name_pp);
// Log to email_log so card-order confirmations appear in the Email Log (consistent with send_confirm/send_shipping)
try {
    $pdo->prepare("INSERT INTO email_log (sent_at,email_type,sent_to,order_id,subject,status,email_body) VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'),?,?,?,?,?,?)")
        ->execute(['Order Confirmation', $order['customer_email'], $order_id, 'Order Confirmed — ' . $order_id, $mailResult===true?'sent':'failed', $html]);
} catch (Exception $e) {}

ok(['message' => 'Payment successful', 'payment_id' => $payId, 'total' => $total, 'order_id' => $order_id]);
