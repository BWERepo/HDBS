<?php
// api/paypal.php — Shared PayPal REST (Orders v2) helpers for create/capture/refund.
// Credentials live in secrets.php / secrets.staging.php (never the browser). Environment
// follows the same staging-vs-prod split as config.php: the staging subdomain uses the
// PayPal sandbox, production uses live. This keeps the backend env in lockstep with the
// PAYPAL_ENV the storefront picks in js/config.js.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';

// 'sandbox' on the staging subdomain, 'live' in production.
function pp_env() {
    return (stripos($_SERVER['HTTP_HOST'] ?? '', 'staging') !== false) ? 'sandbox' : 'live';
}

function pp_api_base($env = null) {
    $env = $env ?: pp_env();
    return $env === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

// Returns [clientId, secret] from secrets.php, or ['',''] if not configured.
// Sandbox and live use separate constant names so both can coexist in one secrets file.
function pp_creds($env = null) {
    $env = $env ?: pp_env();
    if ($env === 'sandbox') {
        return [
            defined('PAYPAL_SANDBOX_CLIENT_ID') ? PAYPAL_SANDBOX_CLIENT_ID : '',
            defined('PAYPAL_SANDBOX_SECRET')    ? PAYPAL_SANDBOX_SECRET    : '',
        ];
    }
    return [
        defined('PAYPAL_CLIENT_ID') ? PAYPAL_CLIENT_ID : '',
        defined('PAYPAL_SECRET')    ? PAYPAL_SECRET    : '',
    ];
}

// OAuth2 client-credentials token. Returns the access token string, or null on failure.
function pp_token($env = null) {
    $env = $env ?: pp_env();
    list($clientId, $secret) = pp_creds($env);
    if (!$clientId || !$secret) { applog('PP-TOKEN-FAIL', "env=$env missing credentials"); return null; }

    $ch = curl_init(pp_api_base($env) . '/v1/oauth2/token');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_POST           => true,
        CURLOPT_USERPWD        => $clientId . ':' . $secret,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_POSTFIELDS     => 'grant_type=client_credentials',
    ]);
    $raw    = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($err) { applog('PP-TOKEN-FAIL', "env=$env curl=$err"); return null; }
    $j = json_decode($raw, true);
    if ($status !== 200 || empty($j['access_token'])) {
        applog('PP-TOKEN-FAIL', "env=$env status=$status body=".substr($raw ?: '', 0, 300));
        return null;
    }
    return $j['access_token'];
}

// Authenticated JSON call to the PayPal REST API. Returns [http_status, decoded_body|null].
// $headers lets callers add PayPal-Request-Id (idempotency) for capture/refund.
function pp_curl($url, $method, $body, $token, $headers = []) {
    $hdr = array_merge([
        'Authorization: Bearer ' . $token,
        'Content-Type: application/json',
    ], $headers);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $hdr,
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body));
    }
    $raw    = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($err) { applog('PP-CURL-ERR', "url=$url curl=$err"); return [0, null]; }
    return [$status, json_decode($raw, true)];
}

// Lazy migration: nullable column that stores the PayPal capture id so refund.php can
// route PayPal refunds the same way square_payment_id routes Square refunds.
function ensurePaypalColumn($pdo) {
    if (empty($pdo->query("SHOW COLUMNS FROM orders LIKE 'paypal_capture_id'")->fetchAll())) {
        $pdo->exec("ALTER TABLE orders ADD COLUMN paypal_capture_id VARCHAR(60) DEFAULT NULL");
    }
    if (empty($pdo->query("SHOW COLUMNS FROM orders LIKE 'paypal_surcharge'")->fetchAll())) {
        $pdo->exec("ALTER TABLE orders ADD COLUMN paypal_surcharge DECIMAL(10,2) DEFAULT 0");
    }
}

// Customer-facing processing-fee surcharge added ONLY when the customer pays via PayPal/Venmo —
// Square/card customers are never charged this; the business absorbs the Square fee instead. The
// admin sets the rate in Settings -> PayPal Transaction Fees; falls back to PayPal's published
// standard Checkout rate if that setting is unset.
function pp_surcharge($pdo, $amount) {
    $pct = 3.49; $cents = 0.49;
    try {
        $raw = getSetting($pdo, 'paypal_fees');
        if ($raw) {
            $f = json_decode($raw, true);
            if (isset($f['pct']))   $pct   = (float)$f['pct'];
            if (isset($f['cents'])) $cents = (float)$f['cents'];
        }
    } catch (Exception $e) { /* keep defaults */ }
    return round((float)$amount * $pct / 100 + $cents, 2);
}

// Recomputes an order's total server-side from its stored line items (never trust the
// client). Mirrors the exact math in process_payment.php. Returns
// [subtotal, shipping, tax, total, lineItems].
function pp_order_amounts($pdo, $order_id) {
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
    $tax   = round($subtotal * 0.0975, 2);
    $total = round($subtotal + $shipping + $tax, 2);
    return [$subtotal, $shipping, $tax, $total, $lineItems];
}
