<?php
// order_confirm.php — Sends order confirmation email to the customer
// Sits alongside notify.php in public_html

header('Content-Type: application/json');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
header('Access-Control-Allow-Origin: ' . $origin);
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['success'=>false,'error'=>'Method not allowed']); exit(); }

$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!$data) { http_response_code(400); echo json_encode(['success'=>false,'error'=>'Invalid JSON']); exit(); }

// ── Config ──
$from_email = 'handmadedesignsbysuzi@yahoo.com';
$from_name  = 'Handmade Designs By Suzi';

// ── Data ──
$order_id       = $data['order_id']       ?? '';
$customer_name  = htmlspecialchars($data['customer_name']  ?? '');
$customer_email = trim($data['customer_email'] ?? '');
$phone          = htmlspecialchars($data['phone']          ?? '');
$address        = htmlspecialchars($data['address']        ?? '');
$subtotal       = number_format((float)($data['subtotal']  ?? $data['total'] ?? 0), 2);
$shipping_amt   = (float)($data['shipping'] ?? 0);
$shipping_str   = $shipping_amt > 0 ? '$' . number_format($shipping_amt, 2) : 'Free';
$total          = number_format((float)($data['total']     ?? 0), 2);
$date           = htmlspecialchars($data['date']           ?? date('m/d/Y'));
$items          = $data['items'] ?? [];

if (!$customer_email || !filter_var($customer_email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['success'=>false,'error'=>'Invalid customer email']);
    exit();
}

// ── Build items rows — look up SKU and image from DB ──
$pdo = db();
$items_html = '';
foreach ($items as $item) {
    $name       = htmlspecialchars($item['name']  ?? 'Item');
    $qty        = (int)($item['q']                ?? 1);
    $price      = number_format((float)($item['price'] ?? 0), 2);
    $line_total = number_format((float)($item['price'] ?? 0) * $qty, 2);
    // Look up SKU and image from products table
    $sku = ''; $img_url = '';
    $pid = $item['id'] ?? '';
    if ($pid && $pid !== '_ship') {
        $ps = $pdo->prepare('SELECT sku, img1 FROM products WHERE id = ? LIMIT 1');
        $ps->execute([$pid]);
        $pr = $ps->fetch();
        if ($pr) { $sku = $pr['sku'] ?? ''; $img_url = $pr['img1'] ?? ''; }
    }
    $sku_html = $sku ? "<div style='font-size:11px;color:#a07810;font-family:monospace;margin-top:2px'>{$sku}</div>" : '';
    $thumb = (!empty($img_url) && strpos($img_url, 'http') === 0)
        ? "<img src='{$img_url}' width='48' height='48' style='object-fit:cover;border-radius:6px;display:block;border:1px solid #e8e0b8'>"
        : "<div style='width:48px;height:48px;background:#fdf3d0;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.3rem;border:1px solid #e8e0b8'>&#128092;</div>";
    $items_html .= "<tr>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;vertical-align:middle'>
        <div style='display:flex;align-items:center;gap:10px'>{$thumb}<div><div style='color:#2d2220;font-weight:600'>{$name}</div>{$sku_html}</div></div></td>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:center;vertical-align:middle;color:#2d2220'>{$qty}</td>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:right;vertical-align:middle;color:#2d2220'>\${$price}</td>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:right;font-weight:700;color:#a07810;vertical-align:middle'>\${$line_total}</td>
    </tr>";
}

$first_name = explode(' ', $customer_name)[0];
$subject    = "Your Order from Handmade Designs By Suzi — #{$order_id}";

$html = "<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:20px;background:#fffdf0;font-family:Arial,sans-serif'>
<div style='max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>

  <!-- Header -->
  <div style='background:#a07810;padding:28px;text-align:center'>
    <div style='color:#fff;font-size:22px;font-weight:bold;font-style:italic'>Handmade Designs By Suzi</div>
    <div style='color:#ffe8a0;font-size:14px;margin-top:6px'>Order Confirmation</div>
  </div>

  <!-- Personal greeting -->
  <div style='padding:28px 28px 0'>
    <p style='font-size:16px;color:#2d2220;margin-bottom:8px'>Hi {$first_name}! 🌸</p>
    <p style='font-size:14px;color:#4a3f35;line-height:1.8;margin-bottom:6px'>
      Thank you so much for your order! I'm thrilled you found something you love in my collection.
      Every bag I make is one of a kind, and yours is being prepared with the same care and attention
      I put into every stitch.
    </p>
    <p style='font-size:14px;color:#4a3f35;line-height:1.8;margin-bottom:0'>
      I'll get it on its way to you as soon as possible. If you have any questions at all,
      just reply to this email — I read every message personally.
    </p>
  </div>

  <!-- Order summary bar -->
  <div style='background:#fffdf0;border-top:1px solid #e8e0b8;border-bottom:1px solid #e8e0b8;padding:14px 28px;margin-top:20px'>
    <table width='100%'><tr>
      <td><div style='font-size:11px;color:#a07810;font-weight:bold;text-transform:uppercase'>Order ID</div>
          <div style='font-size:14px;font-weight:bold;font-family:monospace;color:#2d2220'>{$order_id}</div></td>
      <td style='text-align:center'><div style='font-size:11px;color:#a07810;font-weight:bold;text-transform:uppercase'>Date</div>
          <div style='font-size:14px;font-weight:600;color:#2d2220'>{$date}</div></td>
      <td style='text-align:right'><div style='font-size:11px;color:#a07810;font-weight:bold;text-transform:uppercase'>Total</div>
          <div style='font-size:20px;font-weight:bold;color:#a07810'>\${$total}</div></td>
    </tr></table>
  </div>

  <div style='padding:24px 28px'>

    <!-- Ship to -->
    <div style='font-size:11px;font-weight:bold;text-transform:uppercase;color:#a07810;margin-bottom:8px'>Shipping To</div>
    <div style='background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:12px 16px;font-size:14px;color:#2d2220;margin-bottom:20px;line-height:1.6'>{$address}</div>

    <!-- Items -->
    <div style='font-size:11px;font-weight:bold;text-transform:uppercase;color:#a07810;margin-bottom:8px'>Your Order</div>
    <table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;border-collapse:collapse;margin-bottom:16px'>
      <thead><tr style='background:#fffdf0'>
        <th style='padding:8px 12px;text-align:left;color:#6b6040;border-bottom:2px solid #e8e0b8'>Item</th>
        <th style='padding:8px 12px;text-align:center;color:#6b6040;border-bottom:2px solid #e8e0b8'>Qty</th>
        <th style='padding:8px 12px;text-align:right;color:#6b6040;border-bottom:2px solid #e8e0b8'>Price</th>
        <th style='padding:8px 12px;text-align:right;color:#6b6040;border-bottom:2px solid #e8e0b8'>Subtotal</th>
      </tr></thead>
      <tbody>{$items_html}</tbody>
      <tfoot>
        <tr><td colspan='3' style='padding:8px 12px;text-align:right;color:#6b6040'>Subtotal</td>
            <td style='padding:8px 12px;text-align:right;color:#2d2220'>\${$subtotal}</td></tr>
        <tr><td colspan='3' style='padding:4px 12px;text-align:right;color:#6b6040'>Shipping</td>
            <td style='padding:4px 12px;text-align:right;color:#2d2220'>{$shipping_str}</td></tr>
        <tr><td colspan='3' style='padding:10px 12px;text-align:right;font-weight:bold;color:#2d2220;border-top:2px solid #e8e0b8'>Total</td>
            <td style='padding:10px 12px;text-align:right;font-weight:bold;font-size:17px;color:#a07810;border-top:2px solid #e8e0b8'>\${$total}</td></tr>
      </tfoot>
    </table>

    <!-- Payment note -->
    <div style='background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:12px 16px;font-size:13px;color:#7a5f00;line-height:1.6;margin-bottom:20px'>
      💳 Payment is processed securely through Square. You should have received a separate payment receipt from Square.
    </div>

    <!-- Warm closing -->
    <p style='font-size:14px;color:#4a3f35;line-height:1.8;margin-bottom:6px'>
      Thank you for supporting my little handmade business — it truly means the world to me. 
      I hope your new bag brings you as much joy as I had making it!
    </p>
    <p style='font-size:14px;color:#a07810;font-style:italic;font-weight:600'>— Susan 🌸</p>
  </div>

  <!-- Footer -->
  <div style='background:#2d2220;padding:16px 28px;text-align:center'>
    <div style='color:rgba(255,255,255,.6);font-size:12px;line-height:1.8'>
      Handmade Designs By Suzi &middot; Knoxville, TN<br>
      Questions? Reply to this email or contact us at
      <a href='mailto:handmadedesignsbysuzi@yahoo.com' style='color:#d4a017'>handmadedesignsbysuzi@yahoo.com</a>
    </div>
  </div>

</div></body></html>";

// ── Send via SMTP — customer + BCC to Suzi ──
require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/api/config.php';
$recipients = [$customer_email, 'handmadedesignsbysuzi@yahoo.com'];
$result = sendEmail($recipients, $subject, $html, $from_email, $from_name);
$sent = ($result === true);

// Log
$dt  = new DateTime('now', new DateTimeZone('America/New_York'));
$log = $dt->format('Y-m-d g:i A') . ' EDT | Confirm to: ' . $customer_email . ' | Order: ' . $order_id . ' | Result: ' . ($sent ? 'OK' : 'FAIL: ' . (is_string($result) ? $result : 'unknown')) . "\n";
file_put_contents(__DIR__ . '/notify_log.txt', $log, FILE_APPEND | LOCK_EX);

echo json_encode(['success' => $sent, 'message' => $sent ? 'Confirmation sent' : 'mail() failed']);
