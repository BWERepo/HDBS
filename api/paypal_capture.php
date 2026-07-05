<?php
// api/paypal_capture.php — Captures an approved PayPal order and marks our order Paid.
// Called from the PayPal button's onApprove callback. Mirrors process_payment.php: it
// recomputes the total server-side, claims the order with an atomic status lock to prevent
// a double capture, then marks Paid, stores the capture id, and sends the confirmation.
ini_set('display_errors', 0);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
require_once __DIR__ . '/paypal.php';
cors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed', 405);

$d               = body();
$order_id        = trim($d['order_id'] ?? '');
$paypal_order_id = trim($d['paypal_order_id'] ?? '');
if (!$order_id) fail('Missing order_id');

applog('PP-CAPTURE-START', "order=$order_id pp=$paypal_order_id");
$pdo = db();
ensurePaypalColumn($pdo);

$stmt = $pdo->prepare("SELECT * FROM orders WHERE id = ? LIMIT 1");
$stmt->execute([$order_id]);
$order = $stmt->fetch();
if (!$order) fail('Order not found', 404);
if ($order['status'] !== 'Awaiting Payment') fail('Order is not awaiting payment');

list($subtotal, $shipping, $tax, $total, $lineItems) = pp_order_amounts($pdo, $order_id);

// Customer-facing PayPal processing fee — same rate/formula applied in paypal_create.php, added
// here too so our stored order total matches exactly what PayPal actually captured.
$surcharge = pp_surcharge($pdo, $total);
$total     = round($total + $surcharge, 2);

// Atomic lock: claim the order before capturing — prevents double-capture on concurrent requests.
$guard = $pdo->prepare("UPDATE orders SET status='Processing' WHERE id=? AND status='Awaiting Payment'");
$guard->execute([$order_id]);
if ($guard->rowCount() === 0) fail('Order is no longer awaiting payment. Please refresh and try again.');

// Admin-only bypass for regression tests: mark Paid without hitting PayPal.
if (!empty($d['test_mode'])) {
    requireAdmin();
    $pdo->prepare("UPDATE orders SET status='Paid', payment_method='PayPal', total=?, tax_amount=?, paypal_surcharge=?, confirm_sent_at=NOW() WHERE id=?")
        ->execute([$total, $tax, $surcharge, $order_id]);
    ok(['message' => 'Test PayPal payment accepted', 'total' => $total, 'surcharge' => $surcharge, 'order_id' => $order_id]);
}

if (!$paypal_order_id) {
    $pdo->prepare("UPDATE orders SET status='Awaiting Payment' WHERE id=? AND status='Processing'")->execute([$order_id]);
    fail('Missing paypal_order_id');
}

$token = pp_token();
if (!$token) {
    $pdo->prepare("UPDATE orders SET status='Awaiting Payment' WHERE id=? AND status='Processing'")->execute([$order_id]);
    fail('PayPal is not configured. Please choose another payment method.');
}

// PayPal-Request-Id makes the capture idempotent: a network/UI retry reuses the key so
// PayPal returns the original capture instead of charging twice.
$reqId = 'cap-' . $order_id;
list($status, $resp) = pp_curl(
    pp_api_base() . '/v2/checkout/orders/' . rawurlencode($paypal_order_id) . '/capture',
    'POST', '{}', $token, ['PayPal-Request-Id: ' . $reqId]
);

$capture = $resp['purchase_units'][0]['payments']['captures'][0] ?? null;
$capStatus = $capture['status'] ?? '';

if (($status !== 200 && $status !== 201) || !$capture || ($capStatus !== 'COMPLETED' && $capStatus !== 'PENDING')) {
    // Roll back so the customer can retry with a different method.
    $pdo->prepare("UPDATE orders SET status='Awaiting Payment' WHERE id=? AND status='Processing'")->execute([$order_id]);
    applog('PP-CAPTURE-FAIL', "order=$order_id pp=$paypal_order_id status=$status body=".json_encode($resp));
    $issue = $resp['details'][0]['description'] ?? ($resp['message'] ?? 'PayPal payment could not be completed. Please try again.');
    fail($issue);
}

$captureId = $capture['id'] ?? '';
// Actual PayPal processing fee, when PayPal returns it, for net-revenue reporting.
$fee = 0;
if (isset($capture['seller_receivable_breakdown']['paypal_fee']['value'])) {
    $fee = (float)$capture['seller_receivable_breakdown']['paypal_fee']['value'];
}

// Funding source: PayPal echoes the instrument used under payment_source. Venmo rides the
// PayPal rail (refunds/settlement identical) but we label it 'Venmo' so the admin + emails
// show what the customer actually paid with. refund.php treats both as PayPal-routed.
$paySource = isset($resp['payment_source']['venmo']) ? 'Venmo' : 'PayPal';

// Mark Paid — if this write fails the money was still captured, so log for manual reconciliation.
try {
    $pdo->prepare("UPDATE orders SET status='Paid', payment_method=?, paypal_capture_id=?, total=?, tax_amount=?, transaction_fee=?, paypal_surcharge=?, confirm_sent_at=NOW() WHERE id=?")
        ->execute([$paySource, $captureId, $total, $tax, $fee, $surcharge, $order_id]);
} catch (Exception $e) {
    applog('PP-CAPTURE-ORPHANED', "order=$order_id capture=$captureId err=".$e->getMessage());
    fail('Payment received but order update failed. Please contact us with order reference: '.$order_id);
}

// Increment customer order count
$pdo->prepare("UPDATE customers SET order_count = order_count + 1 WHERE email = ?")
    ->execute([$order['customer_email']]);

// Reflect the funding source on the row we pass to the shared email builder ("Paid by: …").
$order['payment_method'] = $paySource;
require_once __DIR__ . '/order_confirm_email.php';
sendOrderConfirmation($pdo, $order, $lineItems, $total, $shipping, $tax, $captureId, $surcharge);

ok(['message' => 'Payment successful', 'payment_id' => $captureId, 'total' => $total, 'surcharge' => $surcharge, 'order_id' => $order_id]);
