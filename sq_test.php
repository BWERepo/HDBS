<?php
// sq_test.php — Display all Square fields for a specific payment + its linked order
// DELETE THIS FILE after use — no auth protection.
require_once __DIR__ . '/api/config.php';
$secretsPath = '/home/u541882440/domains/handmadedesignsbysuzi.com/secrets.php';
if (!file_exists($secretsPath)) die('secrets.php not found at: '.$secretsPath);
require_once $secretsPath;

$token = SQUARE_TOKEN;
$base  = 'https://connect.squareup.com/v2';
$hdrs  = [
    'Square-Version: 2024-01-18',
    'Authorization: Bearer ' . $token,
    'Content-Type: application/json',
];

function sq_get($url, $hdrs) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => $hdrs,
    ]);
    $r = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'body' => $r ? json_decode($r, true) : null, 'raw' => $r];
}

// --- Pick a payment ID from the URL or use the most recent one ---
$pay_id = isset($_GET['pay_id']) ? trim($_GET['pay_id']) : null;

?><!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Square Test</title>
<style>
  body { font-family: monospace; font-size: 13px; background: #1e1e1e; color: #d4d4d4; padding: 20px; }
  h2   { color: #4ec9b0; margin-top: 2rem; }
  h3   { color: #9cdcfe; }
  .ok  { color: #6a9955; }
  .err { color: #f44747; }
  .key { color: #9cdcfe; }
  .val { color: #ce9178; }
  .num { color: #b5cea8; }
  pre  { background: #252526; padding: 1rem; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; }
  form { margin-bottom: 1.5rem; }
  input[type=text] { background:#3c3c3c;color:#fff;border:1px solid #555;padding:6px 10px;width:340px;font-family:monospace; }
  button { background:#0e639c;color:#fff;border:none;padding:7px 16px;cursor:pointer;font-family:monospace; }
</style>
</head><body>

<h2>🔍 Square Payment Inspector</h2>

<form method="get">
  <label style="color:#9cdcfe">Payment ID: </label>
  <input type="text" name="pay_id" value="<?= htmlspecialchars($pay_id ?? '') ?>" placeholder="e.g. bh8v3IsYcbWXN7WmJMZqMvCp5WcZY">
  <button type="submit">Fetch</button>
  <span style="color:#666;margin-left:1rem">(leave blank to load most recent payment)</span>
</form>

<?php

// If no pay_id, grab the most recent payment
if (!$pay_id) {
    echo "<p class='ok'>No payment ID given — fetching most recent payment…</p>";
    $r = sq_get($base . '/payments?sort_order=DESC&limit=1', $hdrs);
    if ($r['code'] !== 200 || empty($r['body']['payments'])) {
        echo "<p class='err'>Failed to fetch payments. HTTP {$r['code']}</p><pre>" . htmlspecialchars($r['raw']) . "</pre></body></html>";
        exit;
    }
    $pay_id = $r['body']['payments'][0]['id'];
    echo "<p class='ok'>Using most recent payment: <strong>$pay_id</strong></p>";
}

// --- Fetch the specific payment ---
echo "<h2>① Payment Object — /v2/payments/{$pay_id}</h2>";
$pr = sq_get($base . '/payments/' . $pay_id, $hdrs);
echo "<p>HTTP: <span class='" . ($pr['code'] === 200 ? 'ok' : 'err') . "'>{$pr['code']}</span></p>";
echo "<pre>" . htmlspecialchars(json_encode($pr['body'], JSON_PRETTY_PRINT)) . "</pre>";

$payment = $pr['body']['payment'] ?? null;
if (!$payment) {
    echo "<p class='err'>No payment object in response.</p></body></html>";
    exit;
}

// Highlight tax-related fields
$tax_fields = ['total_tax_money', 'tax_money', 'tax_details', 'amount_money', 'total_money', 'tip_money', 'app_fee_money'];
echo "<h3>Tax-related fields in payment:</h3><pre>";
foreach ($tax_fields as $f) {
    $v = isset($payment[$f]) ? json_encode($payment[$f]) : '<span class="err">MISSING</span>';
    echo "<span class='key'>$f</span>: $v\n";
}
echo "</pre>";

// --- Fetch the linked Square Order ---
$sq_order_id = $payment['order_id'] ?? null;
if ($sq_order_id) {
    echo "<h2>② Order Object — /v2/orders/{$sq_order_id}</h2>";
    $or = sq_get($base . '/orders/' . $sq_order_id, $hdrs);
    echo "<p>HTTP: <span class='" . ($or['code'] === 200 ? 'ok' : 'err') . "'>{$or['code']}</span></p>";
    echo "<pre>" . htmlspecialchars(json_encode($or['body'], JSON_PRETTY_PRINT)) . "</pre>";

    $order = $or['body']['order'] ?? null;
    if ($order) {
        $order_tax_fields = ['total_tax_money','total_money','total_discount_money','total_tip_money',
                             'total_service_charge_money','taxes','line_items','fulfillments','tenders'];
        echo "<h3>Tax-related fields in order:</h3><pre>";
        foreach ($order_tax_fields as $f) {
            $v = isset($order[$f]) ? json_encode($order[$f], JSON_PRETTY_PRINT) : '<span class="err">MISSING</span>';
            echo "<span class='key'>$f</span>: $v\n\n";
        }
        echo "</pre>";
    }
} else {
    echo "<p class='err'>No order_id on this payment.</p>";
}

?>
<p style="color:#555;margin-top:3rem">⚠️ Delete this file from the server after use.</p>
</body></html>
