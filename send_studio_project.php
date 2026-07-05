<?php
// send_studio_project.php — Send a custom/free-text email to a Design Studio project's customer
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
    requireAdmin();

    $data       = json_decode(file_get_contents('php://input'), true);
    $project_id = isset($data['project_id']) ? (int)$data['project_id'] : 0;
    $subject_in = isset($data['subject']) ? str_replace(["\r","\n"], '', trim($data['subject'])) : '';
    $message_in = isset($data['message']) ? trim($data['message']) : '';
    if(!$project_id){ ob_end_clean(); echo json_encode(['success'=>false,'error'=>'Missing project_id']); exit; }
    if(!$subject_in || !$message_in){ ob_end_clean(); echo json_encode(['success'=>false,'error'=>'Subject and message are required']); exit; }

    $pdo = db();
    $stmt = $pdo->prepare("SELECT * FROM studio_inquiries WHERE id = ? LIMIT 1");
    $stmt->execute([$project_id]);
    $project = $stmt->fetch();
    if(!$project){ ob_end_clean(); echo json_encode(['success'=>false,'error'=>'Project not found']); exit; }

    $customer_email = $project['email'];
    $customer_name  = htmlspecialchars($project['name']);
    $first_name     = explode(' ', $customer_name)[0];
    $from_email     = 'handmadedesignsbysuzi@yahoo.com';
    $from_name      = bizName($pdo);
    $message_html   = nl2br(htmlspecialchars($message_in, ENT_QUOTES, 'UTF-8'));
    $project_tag    = 'DS-' . $project_id;

    $biz2 = [];
    try {
        $brow2 = $pdo->prepare("SELECT value FROM settings WHERE key_name='biz_profile' LIMIT 1");
        $brow2->execute();
        $bval2 = $brow2->fetchColumn();
        if($bval2) $biz2 = json_decode($bval2, true) ?: [];
    } catch(Exception $e) {}
    $biz_email2 = !empty($biz2['email']) ? $biz2['email'] : 'handmadedesignsbysuzi@yahoo.com';

    $html = "<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:20px;background:#fffdf0;font-family:Arial,sans-serif'>
<div style='max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:#a07810;padding:28px;text-align:center'>
    <h1 style='color:#fff;margin:0;font-size:1.4rem'>{$from_name}</h1>
  </div>
  <div style='padding:28px'>
    <p>Hi {$first_name},</p>
    <div style='margin:1rem 0;color:#2d2220;line-height:1.5'>{$message_html}</div>
    <p style='margin-top:20px;color:#6b6040'>Regarding your Design Studio project.</p>
    <p><em style='color:#a07810'>&mdash; Susan &#127864;</em></p>
  </div>
  <div style='background:#2d2220;padding:16px 28px;text-align:center'>
    <div style='color:rgba(255,255,255,.6);font-size:.8rem'>
      {$from_name} &bull; Knoxville, TN<br>
      <a href='https://handmadedesignsbysuzi.com' style='color:#d4a017'>handmadedesignsbysuzi.com</a><br>
      Questions? <a href='mailto:{$biz_email2}' style='color:#d4a017'>{$biz_email2}</a>
    </div>
  </div>
</div></body></html>";

    $no_cust    = empty(trim($customer_email));
    $recipients = $no_cust ? [$from_email] : [$customer_email, $from_email];

    if(!empty($data['preview'])){
        ob_end_clean();
        echo json_encode(['success'=>true,'preview'=>true,'html'=>_emailLogoHeader($html),'subject'=>$subject_in,'to'=>($no_cust?$from_email:$customer_email)]);
        exit;
    }

    $result = sendEmail($recipients, $subject_in, $html, $from_email, $from_name);

    $log_to = $no_cust ? 'admin-only' : $customer_email;
    try{
        $pdo->prepare("INSERT INTO email_log (sent_at,email_type,sent_to,order_id,subject,status,email_body) VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'),?,?,?,?,?,?)")
            ->execute(['Project Update', $log_to, $project_tag, $subject_in, $result===true?'sent':'failed', $html]);
    }catch(Exception $ue){}

    ob_end_clean();
    echo json_encode(['success'=>($result===true),'to'=>$log_to,'error'=>($result===true?null:$result)]);

}catch(Exception $e){
    ob_end_clean();
    echo json_encode(['success'=>false,'error'=>$e->getMessage(),'line'=>$e->getLine()]);
}
