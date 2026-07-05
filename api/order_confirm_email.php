<?php
// api/order_confirm_email.php — Shared "Order Confirmed" email builder + sender.
// Used by both process_payment.php (Square) and paypal_capture.php (PayPal) so the
// customer confirmation is byte-for-byte identical no matter which processor charged.

require_once __DIR__ . '/config.php';

// Sends the order-confirmation email to the customer + business inbox and logs it to
// email_log. $paymentId is the processor's charge/capture id (shown in the footer).
// Returns the sendEmail() result (true on success). Never throws — email failure must
// not roll back an already-captured payment.
function sendOrderConfirmation($pdo, $order, $lineItems, $total, $shipping, $tax, $paymentId, $surcharge = 0) {
    $order_id = $order['id'];

    $biz_name  = bizName($pdo);
    $biz_email = 'handmadedesignsbysuzi@yahoo.com';
    try {
        $bzRaw = getSetting($pdo, 'biz_profile');
        $bz    = $bzRaw ? json_decode($bzRaw, true) : null;
        if (!empty($bz['email'])) $biz_email = $bz['email'];
    } catch (Exception $e) { /* keep fallback */ }

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
  <h1 style='color:#d4a017;margin:0;font-size:1.4rem'>{$biz_name}</h1>
</div>
<div style='padding:28px'>
  <h2 style='color:#a07810;margin-top:0'>Order Confirmed! 🎉</h2>
  <p>Hi " . htmlspecialchars($firstName) . ", thank you for your order! Your payment has been received and your order is being prepared with care.</p>
  <div style='background:#fffdf0;border:1px solid #e8e0b8;border-radius:10px;padding:16px;margin:16px 0'>
    <table style='width:100%;border-collapse:collapse;font-size:.9rem;table-layout:fixed;word-wrap:break-word'>
      " . $itemHtml . "
      <tr><td style='padding:.3rem .5rem;border-top:1px solid #e8e0b8'>Shipping</td><td style='padding:.3rem .5rem;text-align:right;border-top:1px solid #e8e0b8'>" . ($shipping > 0 ? '$' . number_format($shipping, 2) : 'Free') . "</td></tr>
      <tr><td style='padding:.3rem .5rem'>Tax (9.75%)</td><td style='padding:.3rem .5rem;text-align:right'>$" . number_format($tax, 2) . "</td></tr>
      " . ($surcharge > 0 ? "<tr><td style='padding:.3rem .5rem'>PayPal/Venmo Processing Fee</td><td style='padding:.3rem .5rem;text-align:right'>$" . number_format($surcharge, 2) . "</td></tr>" : "") . "
      <tr style='font-weight:700'><td style='padding:.5rem .5rem;border-top:2px solid #d4a017'>Total Charged</td><td style='padding:.5rem .5rem;text-align:right;border-top:2px solid #d4a017;color:#a07810'>$" . number_format($total, 2) . "</td></tr>
    </table>
  </div>
  <p><strong>Paid by:</strong> " . htmlspecialchars($order['payment_method'] ?? 'Credit Card') . (!empty($order['check_number']) ? " (Check #" . htmlspecialchars($order['check_number']) . ")" : "") . "</p>
  <p><strong>Shipping to:</strong> " . htmlspecialchars($order['shipping_address']) . "</p>
  <p>We'll send you a shipping confirmation with tracking info when your order is on its way!</p>
  <p style='color:#6b6040;font-size:.85rem'>Order #" . $order_id . " &bull; Payment ID: " . $paymentId . "</p>
</div>
<div style='background:#2d2220;padding:16px 28px;text-align:center'>
  <div style='color:rgba(255,255,255,.6);font-size:.8rem'>
    {$biz_name} &bull; Knoxville, TN<br>
    <a href='https://handmadedesignsbysuzi.com' style='color:#d4a017'>handmadedesignsbysuzi.com</a><br>
    Questions? <a href='mailto:{$biz_email}' style='color:#d4a017'>{$biz_email}</a>
  </div>
</div>
</div></body></html>";

    require_once dirname(__DIR__) . '/mailer.php';
    $recipients = [$order['customer_email'], 'handmadedesignsbysuzi@yahoo.com'];
    $mailResult = sendEmail($recipients, 'Order Confirmed — ' . $order_id, $html, 'handmadedesignsbysuzi@yahoo.com', $biz_name);
    // Log to email_log so confirmations appear in the Email Log (consistent with send_confirm/send_shipping)
    try {
        $pdo->prepare("INSERT INTO email_log (sent_at,email_type,sent_to,order_id,subject,status,email_body) VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'),?,?,?,?,?,?)")
            ->execute(['Order Confirmation', $order['customer_email'], $order_id, 'Order Confirmed — ' . $order_id, $mailResult === true ? 'sent' : 'failed', $html]);
    } catch (Exception $e) {}

    return $mailResult;
}
