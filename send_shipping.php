<?php
// send_shipping.php — Send shipping notification email with carrier, tracking and items
require_once __DIR__ . '/api/applog.php';
define('PUBLIC_HTML', __DIR__);
ob_start();
register_shutdown_function(function(){
    $e=error_get_last();
    if($e&&in_array($e['type'],[E_ERROR,E_PARSE,E_COMPILE_ERROR])){
        ob_end_clean();header('Content-Type: application/json');
        echo json_encode(['success'=>false,'error'=>$e['message'].' line '.$e['line']]);
    }
});
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if($_SERVER['REQUEST_METHOD']==='OPTIONS'){http_response_code(200);ob_end_clean();exit;}

try{
    require_once __DIR__ . '/api/config.php';
    require_once __DIR__ . '/mailer.php';

    $data     = json_decode(file_get_contents('php://input'), true);
    $order_id = isset($data['order_id']) ? trim($data['order_id']) : '';
dbg('send_shipping', "START order_id=$order_id");
    if(!$order_id){ ob_end_clean(); echo json_encode(['success'=>false,'error'=>'Missing order_id']); exit; }

    $pdo = db();
    $stmt = $pdo->prepare("SELECT * FROM orders WHERE id = ? LIMIT 1");
    $stmt->execute([$order_id]);
    $order = $stmt->fetch();
    if(!$order){ ob_end_clean(); echo json_encode(['success'=>false,'error'=>'Order not found']); exit; }

    // Fetch order items (exclude _ship)
    $istmt = $pdo->prepare("SELECT oi.product_name, oi.price, oi.quantity, oi.product_id, p.sku, p.img1 FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=? AND oi.product_id!='_ship'");
    $istmt->execute([$order_id]);
    $items = $istmt->fetchAll();

    $customer_email = isset($order['customer_email']) ? $order['customer_email'] : '';
    $customer_name  = htmlspecialchars(isset($order['customer_name']) ? $order['customer_name'] : '');
    $first_name     = explode(' ', $customer_name)[0];
    $carrier        = htmlspecialchars(isset($order['shipping_carrier']) ? $order['shipping_carrier'] : 'USPS');
    $tracking       = htmlspecialchars(isset($order['tracking_number']) ? $order['tracking_number'] : '');
    $address        = htmlspecialchars(isset($order['shipping_address']) ? $order['shipping_address'] : '');
    $from_email     = 'handmadedesignsbysuzi@yahoo.com';
    $from_name      = 'Handmade Designs By Suzi';
    $subject        = "Your Order Has Shipped! - #{$order_id}";

    // Tracking URL
    $tracking_url = '';
    if($tracking){
        if($carrier==='USPS')    $tracking_url='https://tools.usps.com/go/TrackConfirmAction?tLabels='.urlencode($tracking);
        elseif($carrier==='UPS') $tracking_url='https://www.ups.com/track?tracknum='.urlencode($tracking);
        elseif($carrier==='FedEx') $tracking_url='https://www.fedex.com/fedextrack/?trknbr='.urlencode($tracking);
    }

    $tracking_html = $tracking
        ? ($tracking_url
            ? "<a href='{$tracking_url}' style='color:#a07810;font-weight:700;font-family:monospace;font-size:1rem'>{$tracking}</a>"
            : "<strong style='font-family:monospace;font-size:1rem;color:#a07810'>{$tracking}</strong>")
        : '<em style="color:#6b6040">Not provided</em>';

    // Build items table HTML
    $items_html = '';
    if(!empty($items)){
        $items_html  = "<div style='margin:20px 0'>";
        $items_html .= "<div style='font-size:.75rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:.5rem'>Items in Your Order</div>";
        $items_html .= "<table style='width:100%;border-collapse:collapse;font-size:.85rem'>";
        $items_html .= "<tr style='background:#f9f4e4'>";
        $items_html .= "<th style='text-align:left;padding:6px 8px;border-bottom:2px solid #e8e0b8' colspan='2'>Item</th>";
        $items_html .= "<th style='text-align:center;padding:6px 8px;border-bottom:2px solid #e8e0b8'>Qty</th>";
        $items_html .= "</tr>";
        foreach($items as $it){
            $img = !empty($it['img1']) ? "<img src='".$it['img1']."' style='width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #e8e0b8'>" : "<span style='font-size:1.5rem'>&#128132;</span>";
            $sku = !empty($it['sku']) ? "<div style='font-size:.7rem;color:#a07810;font-family:monospace;margin-top:2px'>".$it['sku']."</div>" : '';
            $items_html .= "<tr style='border-bottom:1px solid #f0e8d0'>";
            $items_html .= "<td style='padding:7px 8px;width:56px'>{$img}</td>";
            $items_html .= "<td style='padding:7px 8px;color:#2d2220'>".htmlspecialchars($it['product_name'])."{$sku}</td>";
            $items_html .= "<td style='padding:7px 8px;text-align:center;color:#6b6040'>".(int)$it['quantity']."</td>";
            $items_html .= "</tr>";
        }
        $items_html .= "</table></div>";
    }

    // Build email
    $track_btn = $tracking_url ? "<div style='text-align:center;margin:20px 0'>
      <a href='{$tracking_url}' style='background:#a07810;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:.95rem;display:inline-block'>
        &#x1F50D; Track My Package
      </a>
    </div>" : '';

    $addr_html = $address ? "<div>
        <span style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase'>Shipping To</span><br>
        {$address}
      </div>" : '';

    // Fetch business profile for footer
    $biz2 = [];
    try {
        $brow2 = $pdo->prepare("SELECT value FROM settings WHERE key_name='biz_profile' LIMIT 1");
        $brow2->execute();
        $bval2 = $brow2->fetchColumn();
        if($bval2) $biz2 = json_decode($bval2, true) ?: [];
    } catch(Exception $e) {}
    $biz_url2   = !empty($biz2['website_url'])   ? $biz2['website_url']   : 'https://handmadedesignsbysuzi.com';
    $biz_email2 = !empty($biz2['website_email']) ? $biz2['website_email'] : 'handmadedesignsbysuzi@yahoo.com';
    $biz_url_display2 = preg_replace('#^https?://#', '', rtrim($biz_url2, '/'));

    $html = "<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:20px;background:#fffdf0;font-family:Arial,sans-serif'>
<div style='max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:#a07810;padding:28px;text-align:center'>
    <h1 style='color:#fff;margin:0;font-size:1.4rem'>Handmade Designs By Suzi</h1>
    <p style='color:#fdf3d0;margin:.4rem 0 0;font-size:.9rem'>&#x1F4E6; Your Order Has Shipped!</p>
  </div>
  <div style='padding:28px'>
    <p>Hi {$first_name}! &#127864;</p>
    <p style='margin-bottom:1.2rem'>Great news — your order is on its way!</p>
    <div style='background:#fffdf0;border-radius:8px;padding:16px;margin:20px 0;border:1px solid #e8e0b8'>
      <div style='margin-bottom:10px'>
        <span style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase'>Order ID</span><br>
        <strong>{$order_id}</strong>
      </div>
      <div style='margin-bottom:10px'>
        <span style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase'>Shipping Carrier</span><br>
        <strong style='font-size:1.1rem'>{$carrier}</strong>
      </div>
      <div style='margin-bottom:10px'>
        <span style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase'>Tracking Number</span><br>
        {$tracking_html}
      </div>
      {$addr_html}
    </div>
    {$track_btn}
    {$items_html}
    <p style='color:#6b6040;font-size:.88rem'>Please allow 24–48 hours for tracking information to update.</p>
    <p style='margin-top:20px;color:#6b6040'>Thank you so much for your order!</p>
    <p><em style='color:#a07810'>— Susan &#127864;</em></p>
    <div style='margin-top:20px;padding-top:16px;border-top:1px solid #e8e0b8;font-size:.8rem;color:#6b6040;text-align:center'>
      <div>Website: <a href='{$biz_url2}' style='color:#a07810;text-decoration:underline'>{$biz_url_display2}</a></div>
      <div>Email: <a href='mailto:{$biz_email2}' style='color:#a07810;text-decoration:underline'>{$biz_email2}</a></div>
    </div>
  </div>
</div></body></html>";

    $no_cust   = empty(trim($customer_email));
    $recipients = $no_cust ? [$from_email] : [$customer_email, $from_email];
    $result    = sendEmail($recipients, $subject, $html, $from_email, $from_name);

    // Persist shipping sent timestamp and log email
    $log_to = $no_cust ? 'admin-only' : $customer_email;
    $dt  = new DateTime('now', new DateTimeZone('America/New_York'));
    $ts  = $dt->format('Y-m-d g:i A').' EDT';
    try{
        $pdo->prepare('UPDATE orders SET shipping_sent_at=NOW() WHERE id=?')->execute([$order_id]);
        $pdo->prepare("INSERT INTO email_log (sent_at,email_type,sent_to,order_id,subject,status,email_body) VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'),?,?,?,?,?,?)")
            ->execute(['Shipping Notification', $log_to, $order_id, $subject, $result===true?'sent':'failed', $html]);
    }catch(Exception $ue){}
    file_put_contents(__DIR__.'/notify_log.txt',
        "$ts | SendShipping | Order: $order_id | Carrier: $carrier | To: $log_to | ".($result===true?'OK':'FAIL: '.$result)."\n",
        FILE_APPEND|LOCK_EX);

    ob_end_clean();
    echo json_encode(['success'=>($result===true),'to'=>$log_to,'error'=>($result===true?null:$result)]);

}catch(Exception $e){
    ob_end_clean();
    echo json_encode(['success'=>false,'error'=>$e->getMessage(),'line'=>$e->getLine()]);
}
