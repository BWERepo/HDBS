<?php
error_reporting(0);
ini_set('display_errors', '0');
ob_start();
register_shutdown_function(function(){
    $e = error_get_last();
    if($e && in_array($e['type'],[E_ERROR,E_PARSE,E_COMPILE_ERROR,E_CORE_ERROR])){
        ob_end_clean();
        header('Content-Type: application/json');
        echo json_encode(['success'=>false,'status'=>'fatal','error'=>$e['message'],'file'=>basename($e['file']),'line'=>$e['line']]);
    }
});
// verify_payment.php  -  Verifies Square payment, updates order, sends confirmation email with tax

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }

try {
require_once __DIR__ . '/api/config.php';
require_once __DIR__ . '/api/applog.php';
define('PUBLIC_HTML', __DIR__);
require_once dirname(__DIR__) . '/secrets.php';
require_once __DIR__ . '/mailer.php';

$raw      = file_get_contents('php://input');
$data     = json_decode($raw, true);
$order_id = trim(isset($data['order_id']) ? $data['order_id'] : '');
dbg('verify_payment', "START order_id=$order_id sq_payment_id=".($data['sq_payment_id']??'?'));

$dt = new DateTime('now', new DateTimeZone('America/New_York'));
$ts = $dt->format('Y-m-d g:i A') . ' EDT';

function vlog($msg) {
    file_put_contents(__DIR__.'/notify_log.txt', $msg."\n", FILE_APPEND|LOCK_EX);
}

if (!$order_id) { vlog("$ts | VP: no order_id"); ob_end_clean();echo json_encode(['success'=>false,'error'=>'Missing order_id']); exit(); }

vlog("$ts | VP START | Order: $order_id");

$pdo = db();

$stmt = $pdo->prepare("SELECT * FROM orders WHERE id = ? LIMIT 1");
$stmt->execute([$order_id]);
$order = $stmt->fetch();
if (!$order) { vlog("$ts | VP: order not found"); ob_end_clean(); echo json_encode(['success'=>false,'error'=>'Order not found']); exit(); }

vlog("$ts | VP: order status = " . $order['status']);

// Atomic guard  -  INSERT IGNORE claims the slot for this order; only one process wins
$confirm_key = 'confirm_sent_' . $order_id;
if (empty($data['test_mode'])) {
    $claimed = $pdo->prepare("INSERT IGNORE INTO settings (key_name, value) VALUES (?, '1')");
    $claimed->execute([$confirm_key]);
    if ($claimed->rowCount() === 0) {
        // Another process already claimed this order  -  return current tax if available
        vlog("$ts | VP: confirmation already claimed by another process, skipping");
        ob_end_clean();echo json_encode(['success'=>true,'status'=>'already_sent','tax'=>(float)$order['tax_amount']]);
        exit();
    }
}

// Test mode or manual resend  -  skip Square API, send confirmation email
$skip_square = !empty($data['test_mode']);
if ($skip_square) {
    // Only update status for ORD- orders; leave MAN- as-is
    if (strpos($order_id, 'MAN-') !== 0 && $order['status'] !== 'Paid') {
        $pdo->prepare("UPDATE orders SET status='Paid', tax_amount=0 WHERE id=?")->execute([$order_id]);
    }
    $tax_money  = (float)(isset($order['tax_amount']) ? $order['tax_amount'] : 0);
    $paid_total = (float)$order['total'];
}

// Search Square for matching payment
if (!$skip_square) {
$token = defined('SQUARE_TOKEN') ? SQUARE_TOKEN : '';
vlog("$ts | VP: searching Square payments...");

$result      = sq_curl('https://connect.squareup.com/v2/payments?sort_order=DESC&limit=100&location_id=LJP687TQBTWTA', 'GET', null, $token);
$sq_http     = ($result !== null) ? 200 : 0;
$sq_response = $result ? json_encode($result) : null;
$payments = isset($result['payments']) ? $result['payments'] : array();
vlog("$ts | VP: Square returned HTTP $sq_http, " . count($payments) . " payments");

$matched = null;
foreach ($payments as $pmt) {
    if (!empty($pmt['note']) && strpos($pmt['note'], $order_id) !== false) {
        $matched = $pmt;
        vlog("$ts | VP: matched payment " . $pmt['id'] . " status=" . $pmt['status']);
        break;
    }
}

if (!$matched) {
    vlog("$ts | VP: no match by note, trying amount fallback...");
    $order_total_cents = (int)round((float)$order['total'] * 100);
    foreach ($payments as $pmt) {
        if ($pmt['status'] === 'COMPLETED' || $pmt['status'] === 'APPROVED') {
            $pmt_cents = isset($pmt['total_money']['amount']) ? $pmt['total_money']['amount'] : 0;
            // Match within $1 of order total
            if (abs($pmt_cents - $order_total_cents) <= 100) {
                // Check it was recent (within 2 hours)
                $created = strtotime(isset($pmt['created_at']) ? $pmt['created_at'] : '');
                if ($created && (time() - $created) < 7200) {
                    $matched = $pmt;
                    vlog("$ts | VP: matched by amount \$" . number_format($pmt_cents/100,2) . " | " . $pmt['id']);
                    break;
                }
            }
        }
    }
}
if (!$matched) {
    // Payment may not be in Square yet - wait 4s and retry once
    sleep(4);
    $result2 = sq_curl('https://connect.squareup.com/v2/payments?sort_order=DESC&limit=100&location_id=LJP687TQBTWTA', 'GET', null, $token);
    $sq_response2 = $result2 ? json_encode($result2) : null;
    $payments2 = isset($result2['payments']) ? $result2['payments'] : array();
    vlog("$ts | VP: retry returned " . count($payments2) . " payments");
    foreach ($payments2 as $pmt) {
        if (!empty($pmt['note']) && strpos($pmt['note'], $order_id) !== false) {
            $matched = $pmt;
            vlog("$ts | VP: matched on retry " . $pmt['id']);
            break;
        }
    }
}
if (!$matched) {
    vlog("$ts | VP: no matching payment found for $order_id");
    foreach (array_slice($payments,0,5) as $p) {
        vlog("  - " . (isset($p['note']) ? $p['note'] : '(no note)') . " | " . $p['status']);
    }
    ob_end_clean();echo json_encode(['success'=>true,'status'=>'pending','message'=>'No matching payment']);
    exit();
}

// Square online payments are APPROVED, in-person are COMPLETED
if ($matched['status'] !== 'COMPLETED' && $matched['status'] !== 'APPROVED') {
    vlog("$ts | VP: payment status not valid: " . $matched['status']);
    // If payment FAILED, restore stock for all items in the order
    if ($matched['status'] === 'FAILED' || $matched['status'] === 'CANCELED') {
        try {
            $itemRows = $pdo->prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id != \'_ship\'');
            $itemRows->execute([$order_id]);
            $restoreStmt = $pdo->prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
            foreach ($itemRows->fetchAll(PDO::FETCH_ASSOC) as $it) {
                $restoreStmt->execute([(int)$it['quantity'], $it['product_id']]);
            }
            // Mark order as Cancelled
            $pdo->prepare('UPDATE orders SET status = ? WHERE id = ?')->execute(['Cancelled', $order_id]);
            vlog("$ts | VP: stock restored and order cancelled for failed payment: $order_id");
        } catch (Exception $restoreEx) {
            vlog("$ts | VP: stock restore error: " . $restoreEx->getMessage());
        }
    }
    ob_end_clean();echo json_encode(['success'=>true,'status'=>'pending']);
    exit();
}

// Fetch tax + authoritative total from Square Orders API (same logic as fetch_tax.php)
$tax_money  = 0;
$sq_total   = 0;
$sq_order_id = isset($matched['order_id']) ? $matched['order_id'] : '';
if ($sq_order_id) {
    $sq_oData = sq_curl('https://connect.squareup.com/v2/orders/'.$sq_order_id, 'GET', null, $token);
    $sq_order = isset($sq_oData['order']) ? $sq_oData['order'] : array();
    if (isset($sq_order['total_tax_money']['amount'])) {
        $tax_money = (float)$sq_order['total_tax_money']['amount'] / 100;
    }
    if (isset($sq_order['total_money']['amount'])) {
        $sq_total = (float)$sq_order['total_money']['amount'] / 100;
    }
}
$paid_total = $sq_total > 0 ? $sq_total : (isset($matched['total_money']['amount']) ? (float)$matched['total_money']['amount'] / 100 : 0);
vlog("$ts | VP: sq_total=\$$sq_total tax=\$$tax_money");
// Update status, payment ID, tax, and total  -  all from Square's authoritative order data
$pdo->prepare("UPDATE orders SET status='Paid', square_payment_id=?, tax_amount=?, total=?, payment_method='Credit Card' WHERE id=?")
    ->execute([$matched['id'], $tax_money, $paid_total, $order_id]);
file_put_contents(__DIR__.'/webhook_log.txt',
    "$ts | VERIFIED PAID | Order: $order_id | Tax: \$".number_format($tax_money,2)." | Square: ".$matched['id']."\n",
    FILE_APPEND|LOCK_EX);

vlog("$ts | VP: order updated, building email...");

} // end Square search block

// Build confirmation email
// Fetch business profile
$biz_vp = [];
try {
    $brow_vp = $pdo->prepare("SELECT value FROM settings WHERE key_name='biz_profile' LIMIT 1");
    $brow_vp->execute();
    $bval_vp = $brow_vp->fetchColumn();
    if($bval_vp) $biz_vp = json_decode($bval_vp, true) ?: [];
} catch(Exception $e) {}
$biz_url_vp   = !empty($biz_vp['website_url'])   ? $biz_vp['website_url']   : 'https://handmadedesignsbysuzi.com';
$biz_email_vp = !empty($biz_vp['website_email']) ? $biz_vp['website_email'] : 'handmadedesignsbysuzi@yahoo.com';
$biz_url_display_vp = preg_replace('#^https?://#', '', rtrim($biz_url_vp, '/'));

$customer_email = isset($order['customer_email']) ? $order['customer_email'] : '';
// If no customer email, send only to Suzi (admin notification)
$no_customer_email = empty(trim($customer_email));
if ($no_customer_email) {
    vlog("$ts | VP: no customer email  -  sending admin-only notification");
    $customer_email = 'handmadedesignsbysuzi@yahoo.com';
}
$customer_name  = htmlspecialchars($order['customer_name']);
$first_name     = explode(' ', $customer_name)[0];
$address        = htmlspecialchars(isset($order['shipping_address']) ? $order['shipping_address'] : '');
$order_date     = htmlspecialchars(isset($order['order_date']) ? $order['order_date'] : '');
$from_email     = 'handmadedesignsbysuzi@yahoo.com';
$from_name      = 'Handmade Designs By Suzi';
$subject        = "Your Order from Handmade Designs By Suzi - #{$order_id}";

// Get order items
$iStmt = $pdo->prepare("SELECT oi.*, p.img1 as img, p.sku as sku FROM order_items oi LEFT JOIN products p ON oi.product_id=p.id WHERE oi.order_id=?");
$iStmt->execute([$order_id]);
$db_items   = $iStmt->fetchAll();
$items_html = '';
$item_total = 0;
$shipping   = 0;

foreach ($db_items as $item) {
    if ($item['product_id'] === '_ship') { $shipping = (float)$item['price']; continue; }
    $name   = htmlspecialchars($item['product_name']);
    $qty    = (int)$item['quantity'];
    $price  = number_format((float)$item['price'], 2);
    $ltotal = number_format((float)$item['price'] * $qty, 2);
    $item_total += (float)$item['price'] * $qty;
    $img_url = htmlspecialchars(isset($item['img']) ? $item['img'] : '');
    $thumb = (!empty($img_url) && strpos($img_url,'http') === 0)
        ? "<img src='{$img_url}' width='54' height='54' style='object-fit:cover;border-radius:6px;border:1px solid #e8e0b8'>"
        : "<div style='width:54px;height:54px;background:#fdf3d0;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.4rem'>&#128092;</div>";
    $sku_html = !empty($item['sku']) ? "<div style='font-size:11px;color:#a07810;font-family:monospace;margin-top:2px'>{$item['sku']}</div>" : '';
    $items_html .= "<tr>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;vertical-align:middle'>
        <div style='display:flex;align-items:center;gap:10px'>{$thumb}<div><div style='color:#2d2220;font-weight:600'>{$name}</div>{$sku_html}</div></div></td>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:center'>{$qty}</td>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:right'>\${$price}</td>
      <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:right;font-weight:700;color:#a07810'>\${$ltotal}</td></tr>";
}

$subtotal_str = number_format($item_total, 2);
$shipping_str = $shipping > 0 ? '$'.number_format($shipping, 2) : 'Free';
$tax_str      = '$'.number_format($tax_money, 2);
// Calculate display total as subtotal + shipping + tax + fee (fee added after sq_fee is computed below)
$total_str    = number_format($paid_total, 2); // updated after fee calc
// Calculate Square transaction fee
$sq_pct   = 2.6;  // default  -  ideally load from settings
$sq_flat  = 0.10;
// Try to load from DB settings
try {
    $feeRow = $pdo->query("SELECT value FROM settings WHERE key_name='square_fees' LIMIT 1")->fetch();
    if ($feeRow) { $feeConf = json_decode($feeRow['value'], true); $sq_pct = isset($feeConf['pct']) ? $feeConf['pct'] : 2.6; $sq_flat = isset($feeConf['cents']) ? $feeConf['cents'] : 0.10; }
} catch(Exception $e) {}
$sq_fee     = round(($paid_total * ($sq_pct / 100) + $sq_flat), 2);
$sq_fee_str = '$'.number_format($sq_fee, 2);
$sq_fee_note = number_format($paid_total, 2).' × '.number_format($sq_pct, 1).'% + $'.number_format($sq_flat, 2);
// Display total: subtotal + shipping + tax (no transaction fee shown in email)
$display_total = $item_total + ($shipping > 0 ? $shipping : 0) + $tax_money;
$total_str = number_format($display_total, 2);

$html = "<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:20px;background:#fffdf0;font-family:Arial,sans-serif'>
<div style='max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:#a07810;padding:28px;text-align:center'>
    <div style='color:#fff;font-size:22px;font-weight:bold;font-style:italic'>Handmade Designs By Suzi</div>
    <div style='color:#ffe8a0;font-size:14px;margin-top:6px'>Order Confirmation</div>
  </div>
  <div style='padding:28px 28px 0'>
    <p style='font-size:16px;color:#2d2220;margin-bottom:8px'>Hi {$first_name}! &#127800;</p>
    <p style='font-size:14px;color:#4a3f35;line-height:1.8;margin-bottom:6px'>Thank you so much for your order! Your bag is being prepared with care. If you have any questions, just reply to this email.</p>
  </div>
  <div style='background:#fffdf0;border-top:1px solid #e8e0b8;border-bottom:1px solid #e8e0b8;padding:14px 28px;margin-top:20px'>
    <table width='100%'><tr>
      <td><div style='font-size:11px;color:#a07810;font-weight:bold;text-transform:uppercase'>Order ID</div>
          <div style='font-size:14px;font-weight:bold;font-family:monospace'>{$order_id}</div></td>
      <td style='text-align:center'><div style='font-size:11px;color:#a07810;font-weight:bold;text-transform:uppercase'>Date</div>
          <div style='font-size:14px;font-weight:600'>{$order_date}</div></td>
      <td style='text-align:center'><div style='font-size:11px;color:#a07810;font-weight:bold;text-transform:uppercase'>Order Type</div>
          <div style='font-size:14px;font-weight:600'>{$order['order_type']}</div></td>
      <td style='text-align:right'><div style='font-size:11px;color:#a07810;font-weight:bold;text-transform:uppercase'>Total Paid</div>
          <div style='font-size:20px;font-weight:bold;color:#a07810'>\${$total_str}</div></td>
    </tr></table>
  </div>
  <div style='padding:24px 28px'>
    <div style='font-size:11px;font-weight:bold;text-transform:uppercase;color:#a07810;margin-bottom:8px'>Shipping To</div>
    <div style='background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:12px 16px;font-size:14px;color:#2d2220;margin-bottom:20px;line-height:1.6'>{$address}</div>
    <div style='font-size:11px;font-weight:bold;text-transform:uppercase;color:#a07810;margin-bottom:8px'>Your Order</div>
    <table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;border-collapse:collapse;margin-bottom:16px'>
      <thead><tr style='background:#fffdf0'>
        <th style='padding:8px 12px;text-align:left;color:#6b6040;border-bottom:2px solid #e8e0b8;width:50%'>Item</th>
        <th style='padding:8px 12px;text-align:center;color:#6b6040;border-bottom:2px solid #e8e0b8;width:12%'>Qty</th>
        <th style='padding:8px 12px;text-align:right;color:#6b6040;border-bottom:2px solid #e8e0b8;width:18%'>Price</th>
        <th style='padding:8px 12px;text-align:right;color:#6b6040;border-bottom:2px solid #e8e0b8;width:20%'>Subtotal</th>
      </tr></thead>
      <tbody>{$items_html}</tbody>
      <tfoot>
        <tr><td colspan='3' style='padding:6px 12px;text-align:right;color:#6b6040'>Subtotal</td><td style='padding:6px 12px;text-align:right'>\${$subtotal_str}</td></tr>
        <tr><td colspan='3' style='padding:4px 12px;text-align:right;color:#6b6040'>Shipping</td><td style='padding:4px 12px;text-align:right'>{$shipping_str}</td></tr>
        ".($tax_money>0?"<tr><td colspan='3' style='padding:4px 12px;text-align:right;color:#6b6040'>Sales Tax</td><td style='padding:4px 12px;text-align:right'>{$tax_str}</td></tr>":"")."
        <tr><td colspan='3' style='padding:10px 12px;text-align:right;font-weight:bold;color:#2d2220;border-top:2px solid #e8e0b8'>Total</td>
            <td style='padding:10px 12px;text-align:right;font-weight:bold;font-size:17px;color:#a07810;border-top:2px solid #e8e0b8'>\${$total_str}</td></tr>
      </tfoot>
    </table>
    <p style='font-size:14px;color:#4a3f35;line-height:1.8'>Thank you for supporting my little handmade business!</p>
    <p style='font-size:14px;color:#a07810;font-style:italic;font-weight:600'>&#8212; Susan &#127800;</p>
  </div>
  <div style='background:#2d2220;padding:16px 28px;text-align:center'>
    <div style='color:rgba(255,255,255,.7);font-size:12px'>
      Website: <a href='{$biz_url_vp}' style='color:#d4a017;text-decoration:underline'>{$biz_url_display_vp}</a><br>
      Email: <a href='mailto:{$biz_email_vp}' style='color:#d4a017;text-decoration:underline'>{$biz_email_vp}</a>
    </div>
  </div>
</div></body></html>";

vlog("$ts | VP: sending email to $customer_email...");
$recipients = $no_customer_email ? ['handmadedesignsbysuzi@yahoo.com'] : [$customer_email, 'handmadedesignsbysuzi@yahoo.com'];
$result_mail = sendEmail($recipients, $subject, $html, $from_email, $from_name);

$dt3 = new DateTime('now', new DateTimeZone('America/New_York'));
$ts3 = $dt3->format('Y-m-d g:i A') . ' EDT';
$log_to = $no_customer_email ? 'admin-only (no customer email)' : $customer_email;
vlog("$ts3 | Confirm to: $log_to | Order: $order_id | Tax: \$".number_format($tax_money,2)." | Result: ".($result_mail===true?'OK':'FAIL: '.$result_mail));

// confirm_sent key already written atomically before send

// Log to email_log table
try {
    $pdo->prepare("INSERT INTO email_log (sent_at,email_type,sent_to,order_id,subject,status,error_msg,email_body) VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'),?,?,?,?,?,?,?)")
        ->execute(['Order Confirmation', $log_to, $order_id, $subject, $result_mail===true?'sent':'failed', $result_mail===true?null:$result_mail, $html]);
} catch(Exception $le) {}

ob_end_clean();echo json_encode(['success'=>true,'status'=>'ok','tax'=>$tax_money]);
} catch(Exception $e){
    ob_end_clean();
    echo json_encode(['success'=>false,'status'=>'error','error'=>$e->getMessage(),'file'=>basename($e->getFile()),'line'=>$e->getLine()]);
}
