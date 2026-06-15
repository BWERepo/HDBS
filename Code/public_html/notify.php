<?php
// notify.php — Order notification using Hostinger mail()

header('Content-Type: application/json');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
header('Access-Control-Allow-Origin: ' . $origin);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405); echo json_encode(['success'=>false,'error'=>'Method not allowed']); exit();
}

require_once __DIR__ . '/api/config.php';
require_once __DIR__ . '/api/applog.php';
define('PUBLIC_HTML', __DIR__);
$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!$data) { http_response_code(400); echo json_encode(['success'=>false,'error'=>'Invalid JSON']); exit(); }
dbg('notify', 'START order_id='.($data['order_id']??'?').' customer='.($data['customer_email']??$data['email']??'?'));

// Log receipt
$dt = new DateTime('now', new DateTimeZone('America/New_York'));
file_put_contents(__DIR__ . '/notify_log.txt',
    $dt->format('Y-m-d g:i A') . ' EDT | RECEIVED order: ' . ($data['order_id'] ?? 'unknown') . "\n",
    FILE_APPEND | LOCK_EX);

// ── Config ──
$to         = 'handmadedesignsbysuzi@yahoo.com';
$from_email = 'handmadedesignsbysuzi@yahoo.com';
$from_name  = 'Handmade Designs By Suzi';

// ── Data ──
$order_id       = $data['order_id']       ?? '';
$customer_name  = htmlspecialchars($data['customer_name']  ?? '');
$customer_email = htmlspecialchars($data['customer_email'] ?? '');
$phone          = htmlspecialchars($data['phone']          ?? 'Not provided');
$address        = htmlspecialchars($data['address']        ?? 'Not provided');
$subtotal       = number_format((float)($data['subtotal'] ?? $data['total'] ?? 0), 2);
$shipping_amt   = (float)($data['shipping'] ?? 0);
$shipping_str   = $shipping_amt > 0 ? '$' . number_format($shipping_amt, 2) : 'Free';
$total          = number_format((float)($data['total']     ?? 0), 2);
$date           = htmlspecialchars($data['date']           ?? date('m/d/Y'));
$dt_order = new DateTime('now', new DateTimeZone('America/New_York'));
$time_edt = $dt_order->format('g:i A') . ' EDT';
$items          = $data['items'] ?? [];

// ── Look up SKUs from DB ──
$sku_map = [];
try {
    require_once __DIR__ . '/api/config.php';
    $ids = array_values(array_filter(array_map(function($i){ return $i['id'] ?? ''; }, $items), function($id){ return $id && $id !== '_ship'; }));
    if ($ids) {
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $skuStmt = db()->prepare("SELECT id, sku FROM products WHERE id IN ({$placeholders})");
        $skuStmt->execute($ids);
        foreach ($skuStmt->fetchAll() as $row) $sku_map[$row['id']] = $row['sku'];
    }
} catch(Exception $e) {}

// ── Build items rows ──
$items_html = '';
$items_text = '';
foreach ($items as $item) {
    $name       = htmlspecialchars($item['name']  ?? 'Item');
    $qty        = (int)($item['q']                ?? 1);
    $price      = number_format((float)($item['price'] ?? 0), 2);
    $line_total = number_format((float)($item['price'] ?? 0) * $qty, 2);
    $sku        = htmlspecialchars($sku_map[$item['id'] ?? ''] ?? '');
    $sku_html   = $sku ? "<div style='font-size:11px;color:#a07810;font-family:monospace;margin-top:2px'>{$sku}</div>" : '';
    $items_html .= "<tr>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0'>{$name}{$sku_html}</td>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:center'>{$qty}</td>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:right'>\${$price}</td>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:right;font-weight:700;color:#a07810'>\${$line_total}</td>
    </tr>";
    $items_text .= "  {$name}" . ($sku ? " [{$sku}]" : '') . " x{$qty} - \${$line_total}\n";
}

$subject = "New Order {$order_id} from {$customer_name}";

// ── HTML email ──
$html = "<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:20px;background:#fffdf0;font-family:Arial,sans-serif'>
<div style='max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:#a07810;padding:24px 28px;text-align:center'>
    <div style='color:#fff;font-size:22px;font-weight:bold;font-style:italic'>Handmade Designs By Suzi</div>
    <div style='color:#ffe8a0;font-size:14px;margin-top:6px'>New Order Received</div>
  </div>
  <div style='background:#fffdf0;border-bottom:1px solid #e8e0b8;padding:14px 28px'>
    <table width='100%'><tr>
      <td><div style='font-size:11px;color:#a07810;font-weight:bold;text-transform:uppercase'>Order ID</div>
          <div style='font-size:15px;font-weight:bold;font-family:monospace'>{$order_id}</div></td>
      <td style='text-align:center'><div style='font-size:11px;color:#a07810;font-weight:bold;text-transform:uppercase'>Date &amp; Time</div>
          <div style='font-size:14px;font-weight:600'>{$date}</div>
          <div style='font-size:12px;color:#6b6040'>{$time_edt}</div></td>
      <td style='text-align:right'><div style='font-size:11px;color:#a07810;font-weight:bold;text-transform:uppercase'>Total</div>
          <div style='font-size:22px;font-weight:bold;color:#a07810'>\${$total}</div></td>
    </tr></table>
  </div>
  <div style='padding:24px 28px'>
    <div style='font-size:11px;font-weight:bold;text-transform:uppercase;color:#a07810;margin-bottom:8px'>Customer</div>
    <table cellpadding='4' style='font-size:14px;color:#2d2220;margin-bottom:20px'>
      <tr><td style='color:#6b6040;width:60px'>Name</td><td style='font-weight:600'>{$customer_name}</td></tr>
      <tr><td style='color:#6b6040'>Email</td><td>{$customer_email}</td></tr>
      <tr><td style='color:#6b6040'>Phone</td><td>{$phone}</td></tr>
    </table>
    <div style='font-size:11px;font-weight:bold;text-transform:uppercase;color:#a07810;margin-bottom:8px'>Ship To</div>
    <div style='background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:12px 16px;font-size:14px;color:#2d2220;margin-bottom:20px;line-height:1.6'>{$address}</div>
    <div style='font-size:11px;font-weight:bold;text-transform:uppercase;color:#a07810;margin-bottom:8px'>Items Ordered</div>
    <table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;border-collapse:collapse;margin-bottom:16px'>
      <thead><tr style='background:#fffdf0'>
        <th style='padding:8px 12px;text-align:left;color:#6b6040;border-bottom:2px solid #e8e0b8'>Product</th>
        <th style='padding:8px 12px;text-align:center;color:#6b6040;border-bottom:2px solid #e8e0b8'>Qty</th>
        <th style='padding:8px 12px;text-align:right;color:#6b6040;border-bottom:2px solid #e8e0b8'>Price</th>
        <th style='padding:8px 12px;text-align:right;color:#6b6040;border-bottom:2px solid #e8e0b8'>Subtotal</th>
      </tr></thead>
      <tbody>{$items_html}</tbody>
      <tfoot><tr>
        <td colspan='4' style='padding:8px 12px;text-align:right;color:#6b6040'>Subtotal</td>
        <td style='padding:8px 12px;text-align:right;color:#2d2220'>\${$subtotal}</td>
      </tr><tr>
        <td colspan='4' style='padding:8px 12px;text-align:right;color:#6b6040'>Shipping</td>
        <td style='padding:8px 12px;text-align:right;color:#2d2220'>{$shipping_str}</td>
      </tr><tr>
        <td colspan='4' style='padding:12px;text-align:right;font-weight:bold;color:#2d2220;border-top:2px solid #e8e0b8'>Order Total</td>
        <td style='padding:12px;text-align:right;font-weight:bold;font-size:18px;color:#a07810;border-top:2px solid #e8e0b8'>\${$total}</td>
      </tr></tfoot>
    </table>
    <div style='background:#fff8e1;border:1px solid #e8d070;border-radius:8px;padding:12px 16px;font-size:13px;color:#7a5f00;line-height:1.6'>
      <strong>Next step:</strong> Check your Square Dashboard to confirm payment, then update the order status in your admin panel.
    </div>
  </div>
  <div style='background:#2d2220;padding:14px 28px;text-align:center'>
    <div style='color:rgba(255,255,255,0.5);font-size:12px'>Handmade Designs By Suzi &middot; Knoxville, TN</div>
  </div>
</div></body></html>";

// ── Send via SMTP ──
require_once __DIR__ . '/mailer.php';
$result = sendEmail($to, $subject, $html, $from_email, $from_name);
$sent = ($result === true);

// Log result
$dt2 = new DateTime('now', new DateTimeZone('America/New_York'));
$log = $dt2->format('Y-m-d g:i A') . ' EDT | RECEIVED order: ' . $order_id . ' | Result: ' . ($sent ? 'OK' : 'FAIL: ' . (is_string($result) ? $result : 'unknown')) . "\n";
file_put_contents(__DIR__ . '/notify_log.txt', $log, FILE_APPEND | LOCK_EX);
// Order Placed (admin notification) not logged to email_log

if ($sent) {
    echo json_encode(['success' => true, 'message' => 'Notification sent']);
} else {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'mail() returned false']);
}
