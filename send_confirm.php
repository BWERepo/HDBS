<?php
// send_confirm.php — Resend order confirmation email from admin
require_once __DIR__ . '/api/applog.php';
define('PUBLIC_HTML', __DIR__);
ob_start();
register_shutdown_function(function(){
    $e=error_get_last();
    if($e&&in_array($e['type'],[E_ERROR,E_PARSE,E_COMPILE_ERROR])){
        ob_end_clean();header('Content-Type: application/json');
        echo json_encode(['success'=>false,'error'=>$e['message'],'line'=>$e['line']]);
    }
});
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(200);ob_end_clean();exit;}

try {
    require_once __DIR__ . '/api/config.php';
    require_once __DIR__ . '/mailer.php';

    $data     = json_decode(file_get_contents('php://input'), true);
    $order_id = isset($data['order_id']) ? trim($data['order_id']) : '';
dbg('send_confirm', "START order_id=$order_id");
    if(!$order_id){ ob_end_clean(); echo json_encode(['success'=>false,'error'=>'Missing order_id']); exit; }

    $pdo = db();

    // Fetch order
    $stmt = $pdo->prepare("SELECT * FROM orders WHERE id = ? LIMIT 1");
    $stmt->execute([$order_id]);
    $order = $stmt->fetch();
    if(!$order){ ob_end_clean(); echo json_encode(['success'=>false,'error'=>'Order not found']); exit; }

    // Fetch business profile
    $biz = [];
    try {
        $brow = $pdo->prepare("SELECT value FROM settings WHERE key_name='biz_profile' LIMIT 1");
        $brow->execute();
        $bval = $brow->fetchColumn();
        if($bval) $biz = json_decode($bval, true) ?: [];
    } catch(Exception $e) {}
    applog('send_confirm','biz_profile raw: '.($bval?substr($bval,0,200):'EMPTY'));
    $biz_url   = !empty($biz['website_url'])   ? $biz['website_url']   : 'https://handmadedesignsbysuzi.com';
    applog('send_confirm','biz_url='.$biz_url.' biz_email='.(!empty($biz['website_email'])?$biz['website_email']:'FALLBACK'));
    $biz_email = !empty($biz['website_email']) ? $biz['website_email'] : 'handmadedesignsbysuzi@yahoo.com';
    $biz_url_display = preg_replace('#^https?://#', '', rtrim($biz_url, '/'));

    // Fetch items
    $iStmt = $pdo->prepare("SELECT oi.*, p.img1 as img, p.sku FROM order_items oi LEFT JOIN products p ON oi.product_id=p.id WHERE oi.order_id=?");
    $iStmt->execute([$order_id]);
    $items = $iStmt->fetchAll();

    $customer_email = isset($order['customer_email']) ? $order['customer_email'] : '';
    $customer_name  = htmlspecialchars(isset($order['customer_name']) ? $order['customer_name'] : '');
    $first_name     = explode(' ', $customer_name)[0];
    $address        = htmlspecialchars(isset($order['shipping_address']) ? $order['shipping_address'] : '');
    $total          = (float)$order['total'];
    $tax            = (float)(isset($order['tax_amount']) ? $order['tax_amount'] : 0);
    $date           = isset($order['order_date']) ? $order['order_date'] : '';

    // Build items HTML
    $items_html = '';
    $item_total = 0;
    $shipping   = 0;
    foreach($items as $item){
        if($item['product_id']==='_ship'){ $shipping=(float)$item['price']; continue; }
        $name    = htmlspecialchars($item['product_name']);
        $qty     = (int)$item['quantity'];
        $price   = number_format((float)$item['price'],2);
        $ltotal  = number_format((float)$item['price']*$qty,2);
        $item_total += (float)$item['price']*$qty;
        $img_url = isset($item['img']) ? htmlspecialchars($item['img']) : '';
        $thumb   = (!empty($img_url)&&strpos($img_url,'http')===0)
            ? "<img src='{$img_url}' width='48' height='48' style='object-fit:cover;border-radius:6px;border:1px solid #e8e0b8'>"
            : "<div style='width:48px;height:48px;background:#fdf3d0;border-radius:6px;text-align:center;line-height:48px'>&#128092;</div>";
        $sku_html = !empty($item['sku']) ? "<div style='font-size:11px;color:#a07810;font-family:monospace'>{$item['sku']}</div>" : '';
        $items_html .= "<tr>
          <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;vertical-align:middle'>
            <div style='display:flex;align-items:center;gap:10px'>{$thumb}<div><div style='font-weight:600'>{$name}</div>{$sku_html}</div></div></td>
          <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:center'>{$qty}</td>
          <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:right'>\${$price}</td>
          <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:right;font-weight:700;color:#a07810'>\${$ltotal}</td>
        </tr>";
    }

    $ship_str = $shipping>0 ? '$'.number_format($shipping,2) : 'Free';
    $tax_str  = '$'.number_format($tax,2);
    $tot_str  = '$'.number_format($total,2);
    $fee      = (float)($order['transaction_fee'] ?? 0);
    $fee_str  = $fee > 0 ? '$'.number_format($fee,2) : null;

    $subject = "Your Order from Handmade Designs By Suzi - #{$order_id}";
    $from_email = 'handmadedesignsbysuzi@yahoo.com';
    $from_name  = 'Handmade Designs By Suzi';

    $html = "<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:20px;background:#fffdf0;font-family:Arial,sans-serif'>
<div style='max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:#a07810;padding:28px;text-align:center'>
    <h1 style='color:#fff;margin:0;font-size:1.4rem'>Handmade Designs By Suzi</h1>
    <p style='color:#fdf3d0;margin:.4rem 0 0;font-size:.9rem'>Order Confirmation</p>
  </div>
  <div style='padding:28px'>
    <p>Hi {$first_name}! &#127864;</p>
    <p>Thank you so much for your order! Your bag is being prepared with care.</p>
    <div style='background:#fffdf0;border-radius:8px;padding:16px;margin:20px 0;border:1px solid #e8e0b8'>
      <div style='display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px'>
        <div style='min-width:120px'><span style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase'>Order ID</span><br><strong>{$order_id}</strong></div>
        <div style='min-width:90px'><span style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase'>Date</span><br>{$date}</div>
        <div style='min-width:100px'><span style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase'>Order Type</span><br>".(htmlspecialchars($order['order_type']??'Online'))."</div>
        <div style='min-width:90px'><span style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase'>Paid By</span><br>".(htmlspecialchars($order['payment_method']??'—'))."</div>
        <div style='min-width:90px'><span style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase'>Total Paid</span><br><strong style='color:#a07810;font-size:1.1rem'>{$tot_str}</strong></div>
      </div>
    </div>
    ".($address ? "<div style='margin-bottom:20px'><div style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase;margin-bottom:6px'>Shipping To</div><div style='background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:12px'>{$address}</div></div>" : "")."
    <div style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase;margin-bottom:8px'>Your Order</div>
    <table style='width:100%;border-collapse:collapse;font-size:.9rem'>
      <thead><tr style='background:#fffdf0'>
        <th style='padding:8px 12px;text-align:left;border-bottom:2px solid #e8e0b8;color:#a07810'>Item</th>
        <th style='padding:8px 12px;text-align:center;border-bottom:2px solid #e8e0b8;color:#a07810'>Qty</th>
        <th style='padding:8px 12px;text-align:right;border-bottom:2px solid #e8e0b8;color:#a07810'>Price</th>
        <th style='padding:8px 12px;text-align:right;border-bottom:2px solid #e8e0b8;color:#a07810'>Subtotal</th>
      </tr></thead>
      <tbody>{$items_html}</tbody>
      <tfoot>
        <tr><td colspan='3' style='padding:6px 12px;text-align:right;color:#6b6040'>Subtotal</td><td style='padding:6px 12px;text-align:right'>\$".number_format($item_total,2)."</td></tr>
        <tr><td colspan='3' style='padding:6px 12px;text-align:right;color:#6b6040'>Shipping</td><td style='padding:6px 12px;text-align:right'>{$ship_str}</td></tr>
        <tr><td colspan='3' style='padding:6px 12px;text-align:right;color:#6b6040'>Sales Tax</td><td style='padding:6px 12px;text-align:right'>{$tax_str}</td></tr>
".($fee_str ? "<tr><td colspan='3' style='padding:6px 12px;text-align:right;color:#6b6040'>Transaction Fee</td><td style='padding:6px 12px;text-align:right'>{$fee_str}</td></tr>" : "")."
        <tr style='border-top:2px solid #e8e0b8'><td colspan='3' style='padding:10px 12px;text-align:right;font-weight:700'>Total</td><td style='padding:10px 12px;text-align:right;font-weight:700;color:#a07810;font-size:1.1rem'>{$tot_str}</td></tr>
      </tfoot>
    </table>
    <p style='margin-top:24px;color:#6b6040'>Thank you for supporting my little handmade business!</p>
    <p><em style='color:#a07810'>— Susan &#127864;</em></p>
    <div style='margin-top:20px;padding-top:16px;border-top:1px solid #e8e0b8;font-size:.8rem;color:#6b6040;text-align:center'>
      <div>Website: <a href='{$biz_url}' style='color:#a07810;text-decoration:underline'>{$biz_url_display}</a></div>
      <div>Email: <a href='mailto:{$biz_email}' style='color:#a07810;text-decoration:underline'>{$biz_email}</a></div>
    </div>
  </div>
</div></body></html>";

    $no_cust_email = empty(trim($customer_email));
    $recipients = $no_cust_email
        ? array($from_email)
        : array($customer_email, $from_email);

    $result = sendEmail($recipients, $subject, $html, $from_email, $from_name);

    $dt = new DateTime('now', new DateTimeZone('America/New_York'));
    $ts = $dt->format('Y-m-d g:i A').' EDT';
    $log_to = $no_cust_email ? 'admin-only' : $customer_email;
    // Persist confirmation sent timestamp and log email
    try{
        $pdo->prepare('UPDATE orders SET confirm_sent_at=NOW() WHERE id=?')->execute([$order_id]);
        $pdo->prepare("INSERT INTO email_log (sent_at,email_type,sent_to,order_id,subject,status,email_body) VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'),?,?,?,?,?,?)")
            ->execute(['Order Confirmation', $log_to, $order_id, 'Order Confirmation - #'.$order_id, $result===true?'sent':'failed', $html]);
    }catch(Exception $ue){}
    file_put_contents(__DIR__.'/notify_log.txt',
        "$ts | SendConfirm | Order: $order_id | To: $log_to | ".($result===true?'OK':'FAIL: '.$result)."\n",
        FILE_APPEND|LOCK_EX);

    ob_end_clean();
    echo json_encode(array(
        'success' => ($result===true),
        'status'  => 'ok',
        'to'      => $log_to,
        'error'   => ($result===true ? null : $result)
    ));

} catch(Exception $e){
    ob_end_clean();
    echo json_encode(array('success'=>false,'error'=>$e->getMessage(),'line'=>$e->getLine()));
}
