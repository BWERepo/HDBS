<?php
// api/contact.php — Sends contact form messages to Suzi's email

require_once __DIR__ . '/config.php';
require_once dirname(__DIR__) . '/mailer.php';
cors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('Method not allowed', 405);
}

$pdo = db();

// Per-IP rate limit: 5 contact submissions per 15 minutes
(function() use ($pdo) {
    $ip  = $_SERVER['REMOTE_ADDR'] ?? '';
    $key = md5('contact_' . $ip);
    $now = time();
    $pdo->exec("CREATE TABLE IF NOT EXISTS rate_limits (
        key_hash CHAR(32) PRIMARY KEY,
        attempts INT NOT NULL DEFAULT 0,
        last_at  INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $row = $pdo->prepare("SELECT attempts, last_at FROM rate_limits WHERE key_hash = ?");
    $row->execute([$key]);
    $row = $row->fetch() ?: ['attempts' => 0, 'last_at' => 0];
    if ($row['attempts'] >= 5 && ($now - $row['last_at']) < 900) {
        $mins = (int)ceil((900 - ($now - $row['last_at'])) / 60);
        fail("Too many requests. Try again in {$mins} minute" . ($mins === 1 ? '' : 's') . '.', 429);
    }
    if ($row['attempts'] >= 5) {
        $pdo->prepare("INSERT INTO rate_limits (key_hash,attempts,last_at) VALUES (?,1,?) ON DUPLICATE KEY UPDATE attempts=1,last_at=?")->execute([$key,$now,$now]);
    } else {
        $new = $row['attempts'] + 1;
        $pdo->prepare("INSERT INTO rate_limits (key_hash,attempts,last_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE attempts=?,last_at=?")->execute([$key,$new,$now,$new,$now]);
    }
})();

$d       = body();
$name    = htmlspecialchars(trim($d['name']    ?? ''));
$email   = htmlspecialchars(trim($d['email']   ?? ''));
$subject = htmlspecialchars(trim($d['subject'] ?? 'Message from Website'));
$message = htmlspecialchars(trim($d['message'] ?? ''));

if (!$name || !$email || !$message) {
    fail('Name, email and message are required');
}
if (!filter_var(trim($d['email'] ?? ''), FILTER_VALIDATE_EMAIL)) {
    fail('Invalid email address');
}

$to       = 'handmadedesignsbysuzi@yahoo.com';
$fullsubj = 'Website Contact: ' . ($subject ?: 'New Message') . ' — ' . $name;
$biz_name_ct = bizName($pdo);

$html_body = "<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#fffdf0;font-family:sans-serif'>
<div style='max-width:560px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:linear-gradient(135deg,#a07810,#d4a017);padding:24px 28px;text-align:center'>
    <div style='color:#fff;font-size:20px;font-style:italic;font-weight:600'>{$biz_name_ct}</div>
    <div style='color:rgba(255,255,255,.85);font-size:13px;margin-top:4px'>New Contact Form Message</div>
  </div>
  <div style='padding:24px 28px'>
    <table style='width:100%;font-size:14px;color:#2d2220;border-collapse:collapse;margin-bottom:20px'>
      <tr><td style='padding:5px 0;color:#6b6040;width:70px'>From</td><td style='padding:5px 0;font-weight:600'>{$name}</td></tr>
      <tr><td style='padding:5px 0;color:#6b6040'>Email</td><td style='padding:5px 0'><a href='mailto:{$email}' style='color:#a07810'>{$email}</a></td></tr>
      <tr><td style='padding:5px 0;color:#6b6040'>Subject</td><td style='padding:5px 0'>{$subject}</td></tr>
    </table>
    <div style='background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:16px;font-size:14px;color:#2d2220;line-height:1.7;white-space:pre-wrap'>{$message}</div>
    <div style='margin-top:20px;padding:12px 16px;background:#fff8e1;border:1px solid #e8d070;border-radius:8px;font-size:13px;color:#7a5f00'>
      Click the email address above to respond directly to {$name}
    </div>
  </div>
  <div style='background:#2d2220;padding:14px 28px;text-align:center'>
    <div style='color:rgba(255,255,255,.5);font-size:12px'>{$biz_name_ct} &nbsp;&middot;&nbsp; Knoxville, TN</div>
  </div>
</div>
</body></html>";

// From (and any Reply-To) must be the SMTP-authenticated mailbox — Yahoo's relay rejects
// both a mismatched envelope-from and a mismatched Reply-To. The visitor's email is only
// shown in the message body (with a mailto: link) for the shop owner to reply to manually.
$result = sendEmail($to, $fullsubj, $html_body, $to, $name);

// Log to email_log (every outbound email is recorded)
try {
    $pdo->prepare("INSERT INTO email_log (sent_at,email_type,sent_to,order_id,subject,status,email_body) VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'),?,?,?,?,?,?)")
        ->execute(['Contact Form', $to, '', $fullsubj, $result===true?'sent':'failed', $html_body]);
} catch (Exception $e) {}

if ($result === true) {
    ok(['message' => 'Message sent']);
} else {
    fail('Failed to send — please email us directly at handmadedesignsbysuzi@yahoo.com', 500);
}
