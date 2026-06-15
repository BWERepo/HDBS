<?php
// checkout.php — Creates a Square checkout session with pre-filled amount
// Upload to public_html alongside index.html on Hostinger

// ── CORS: allow your domain and local testing ──
header('Content-Type: application/json');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
header('Access-Control-Allow-Origin: ' . $origin);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Credentials: true');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit();
}

// ── Square credentials ──
require_once dirname(__DIR__) . '/secrets.php'; // outside public_html

// ── Test / Live mode ──
$mode = $data['mode'] ?? 'live';
if ($mode === 'test') {
    define('SQUARE_ACCESS_TOKEN', 'EAAAl0SOR43xq09AVkTzfRKaZZ04ZGTyAkVMYvYWxAbFT4SoZlrod4oDQtui8jYt');
    define('SQUARE_API_URL_FINAL', 'https://connect.squareupsandbox.com/v2/online-checkout/payment-links');
} else {
    define('SQUARE_ACCESS_TOKEN', defined('SQUARE_TOKEN') ? SQUARE_TOKEN : '');
    define('SQUARE_API_URL_FINAL', 'https://connect.squareup.com/v2/online-checkout/payment-links');
}
// Location IDs differ between sandbox and production
define('SQUARE_LOCATION_ID', $mode === 'test' ? 'SANDBOX_LOCATION_ID_HERE' : 'LJP687TQBTWTA');
// API URL set by mode above

// ── Read incoming JSON ──
$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data || empty($data['total']) || empty($data['order_id'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Missing total or order_id']);
    exit();
}

$total_cents    = (int) round((float)$data['total'] * 100);
$subtotal_cents = (int) round((float)($data['subtotal'] ?? $data['total']) * 100);
$shipping_cents = (int) round((float)($data['shipping'] ?? 0) * 100);
$order_id    = preg_replace('/[^A-Za-z0-9\-]/', '', $data['order_id']);
$cust_name   = htmlspecialchars($data['customer_name'] ?? '');
$note        = "Order {$order_id}" . ($cust_name ? " — {$cust_name}" : '');

if ($total_cents < 100) {
    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Amount too small']);
    exit();
}

// ── Build line items ──
$line_items = [
    [
        'name'             => $note,
        'quantity'         => '1',
        'base_price_money' => ['amount' => $subtotal_cents, 'currency' => 'USD'],
        'applied_taxes'    => [['tax_uid' => 'tn-tax']]
    ]
];
if ($shipping_cents > 0) {
    $line_items[] = [
        'name'             => 'Shipping',
        'quantity'         => '1',
        'base_price_money' => ['amount' => $shipping_cents, 'currency' => 'USD']
    ];
}

// ── Build Square payment link request ──
$payload = [
    'idempotency_key' => uniqid('suzi_', true),
    'order' => [
        'location_id' => SQUARE_LOCATION_ID,
        'line_items'  => $line_items,
        'taxes'       => [
            [
                'uid'        => 'tn-tax',
                'name'       => 'TN Sales Tax',
                'percentage' => '9.75',
                'scope'      => 'LINE_ITEM'
            ]
        ]
    ],
    'payment_note' => "Order {$order_id}",
    'checkout_options' => [
        'redirect_url'          => 'https://handmadedesignsbysuzi.com?thankyou=1&order=' . urlencode($order_id),
        'ask_for_shipping_address' => false
    ]
];

// ── Call Square API ──
$ch = curl_init(SQUARE_API_URL_FINAL);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_HTTPHEADER     => [
        'Authorization: Bearer ' . SQUARE_ACCESS_TOKEN,
        'Content-Type: application/json',
        'Square-Version: 2024-01-18'
    ],
    CURLOPT_POSTFIELDS     => json_encode($payload),
    CURLOPT_TIMEOUT        => 15
]);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_error = curl_error($ch);
curl_close($ch);

if ($curl_error) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Network error: ' . $curl_error]);
    exit();
}

$result = json_decode($response, true);

if ($http_code === 200 && !empty($result['payment_link']['url'])) {
    // Send response to browser immediately
    echo json_encode([
        'success'      => true,
        'checkout_url' => $result['payment_link']['url']
    ]);
    // Flush response so browser gets URL right away
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } else {
        if (ob_get_level()) ob_end_flush();
        flush();
    }
    // Send emails after response is sent
    $email_opts = ['http' => [
        'method'  => 'POST',
        'header'  => 'Content-Type: application/json',
        'content' => json_encode($data),
        'timeout' => 30
    ]];
    $base = 'https://handmadedesignsbysuzi.com';
    // order_confirm sends from verify_payment.php after tax is known
    @file_get_contents($base . '/notify.php', false, stream_context_create($email_opts));
} else {
    $sq_error = $result['errors'][0]['detail'] ?? 'Unknown Square error';
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => $sq_error]);
}
