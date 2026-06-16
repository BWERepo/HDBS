<?php
// api/contact.php — Sends contact form messages to Suzi's email

require_once __DIR__ . '/config.php';
cors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail('Method not allowed', 405);
}

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
$from     = 'susan@handmadedesignsbysuzi.com';
$fullsubj = 'Website Contact: ' . ($subject ?: 'New Message') . ' — ' . $name;

$text_body = "
NEW CONTACT MESSAGE — Handmade Designs By Suzi
================================================
From    : {$name}
Email   : {$email}
Subject : {$subject}

Message:
{$message}

---
Reply to this email to respond to {$name}.
";

$html_body = "<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#fffdf0;font-family:sans-serif'>
<div style='max-width:560px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:linear-gradient(135deg,#a07810,#d4a017);padding:24px 28px;text-align:center'>
    <div style='color:#fff;font-size:20px;font-style:italic;font-weight:600'>Handmade Designs By Suzi</div>
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
      Hit <strong>Reply</strong> to respond directly to {$name} at {$email}
    </div>
  </div>
  <div style='background:#2d2220;padding:14px 28px;text-align:center'>
    <div style='color:rgba(255,255,255,.5);font-size:12px'>Handmade Designs By Suzi &nbsp;&middot;&nbsp; Knoxville, TN</div>
  </div>
</div>
</body></html>";

$boundary = md5(time());
$headers  = implode("\r\n", [
    "From: Handmade Designs By Suzi <{$from}>",
    "Reply-To: {$name} <{$email}>",
    "MIME-Version: 1.0",
    "Content-Type: multipart/alternative; boundary=\"{$boundary}\"",
    "X-Mailer: PHP/" . phpversion(),
]);

$msg = "--{$boundary}\r\n"
    . "Content-Type: text/plain; charset=UTF-8\r\n\r\n"
    . $text_body . "\r\n\r\n"
    . "--{$boundary}\r\n"
    . "Content-Type: text/html; charset=UTF-8\r\n\r\n"
    . $html_body . "\r\n\r\n"
    . "--{$boundary}--";

$sent = mail($to, $fullsubj, $msg, $headers);

if ($sent) {
    ok(['message' => 'Message sent']);
} else {
    fail('Failed to send — please email us directly at handmadedesignsbysuzi@yahoo.com', 500);
}
