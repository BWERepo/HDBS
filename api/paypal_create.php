<?php
// api/paypal_create.php — Creates a PayPal Orders v2 order for one of our pending orders.
// The browser calls this from the PayPal button's createOrder callback and gets back the
// PayPal order id to approve. The amount is recomputed server-side so the client can't
// tamper with it (identical guard to process_payment.php).
ini_set('display_errors', 0);  // never let a PHP notice corrupt the JSON response

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
require_once __DIR__ . '/paypal.php';
cors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed', 405);

$d        = body();
$order_id = trim($d['order_id'] ?? '');
if (!$order_id) fail('Missing order_id');

// Admin-only bypass for regression tests: return a fake PayPal order id, no API call.
if (!empty($d['test_mode'])) { requireAdmin(); ok(['paypal_order_id' => 'TEST-PP-' . $order_id]); }

$pdo = db();

$stmt = $pdo->prepare("SELECT * FROM orders WHERE id = ? LIMIT 1");
$stmt->execute([$order_id]);
$order = $stmt->fetch();
if (!$order) fail('Order not found', 404);
if ($order['status'] !== 'Awaiting Payment') fail('Order is not awaiting payment');

list($subtotal, $shipping, $tax, $total) = pp_order_amounts($pdo, $order_id);
if ($total < 1) fail('Order total is too small');

// Customer-facing PayPal processing fee — added on top of the order total so the customer,
// not the business, covers it (Square/card checkout never adds this surcharge).
$surcharge = pp_surcharge($pdo, $total);
$total     = round($total + $surcharge, 2);

$token = pp_token();
if (!$token) fail('PayPal is not configured. Please choose another payment method.');

$body = [
    'intent' => 'CAPTURE',
    'purchase_units' => [[
        'reference_id' => $order_id,
        'custom_id'    => $order_id,          // echoed back on capture + in webhooks
        'description'  => bizName($pdo) . ' order ' . $order_id,
        'amount'       => [
            'currency_code' => 'USD',
            'value'         => number_format($total, 2, '.', ''),
            'breakdown'     => [
                'item_total' => ['currency_code' => 'USD', 'value' => number_format($subtotal, 2, '.', '')],
                'shipping'   => ['currency_code' => 'USD', 'value' => number_format($shipping, 2, '.', '')],
                'tax_total'  => ['currency_code' => 'USD', 'value' => number_format($tax, 2, '.', '')],
                'handling'   => ['currency_code' => 'USD', 'value' => number_format($surcharge, 2, '.', '')],
            ],
        ],
    ]],
];

list($status, $resp) = pp_curl(pp_api_base() . '/v2/checkout/orders', 'POST', $body, $token);

if (($status !== 200 && $status !== 201) || empty($resp['id'])) {
    applog('PP-CREATE-FAIL', "order=$order_id status=$status body=".json_encode($resp));
    fail('Could not start PayPal checkout. Please try again.');
}

ok(['paypal_order_id' => $resp['id'], 'surcharge' => $surcharge, 'total' => $total]);
