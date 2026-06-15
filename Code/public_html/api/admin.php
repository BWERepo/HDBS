<?php
// api/admin.php — Admin login, password change, security question, settings, logs

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
$pdo    = db();
$d      = body();
$action = $d['action'] ?? '';
dbg('admin', "REQUEST method=$method action=$action");

function getSetting($pdo, $key) {
    $s = $pdo->prepare("SELECT value FROM settings WHERE key_name = ?");
    $s->execute([$key]);
    $r = $s->fetch();
    return $r ? $r['value'] : null;
}

function setSetting($pdo, $key, $value) {
    $s = $pdo->prepare("INSERT INTO settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?");
    $s->execute([$key, $value, $value]);
}

// ── Login ──
if ($method === 'POST' && $action === 'login') {
    $pw   = $d['password'] ?? '';
    $hash = getSetting($pdo, 'admin_password');
    if (!$hash || !password_verify($pw, $hash)) { dbg('admin','login FAILED'); fail('Incorrect password'); }
    dbg('admin','login ok');
    ok(['message' => 'Logged in']);
}

// ── Change password ──
if ($method === 'POST' && $action === 'change_password') {
    $cur  = $d['current'] ?? '';
    $new  = $d['new'] ?? '';
    $cf   = $d['confirm'] ?? '';
    $hash = getSetting($pdo, 'admin_password');
    if (!$hash || !password_verify($cur, $hash)) fail('Current password incorrect');
    if (!$new) fail('New password cannot be empty');
    if ($new !== $cf) fail('Passwords do not match');
    setSetting($pdo, 'admin_password', password_hash($new, PASSWORD_DEFAULT));
    ok(['message' => 'Password updated']);
}

// ── Security question ──
if ($method === 'POST' && $action === 'get_sec_question') {
    $q = getSetting($pdo, 'admin_sec_question');
    if (!$q) fail('No security question set');
    ok(['question' => $q]);
}

if ($method === 'POST' && $action === 'verify_sec_answer') {
    $ans    = strtolower(trim($d['answer'] ?? ''));
    $stored = getSetting($pdo, 'admin_sec_answer');
    if (!$stored || $ans !== $stored) fail('Incorrect answer');
    ok(['message' => 'Verified']);
}

if ($method === 'POST' && $action === 'reset_password') {
    $ans    = strtolower(trim($d['answer'] ?? ''));
    $stored = getSetting($pdo, 'admin_sec_answer');
    $new    = $d['new'] ?? '';
    if (!$stored || $ans !== $stored) fail('Incorrect answer');
    if (!$new) fail('Password cannot be empty');
    setSetting($pdo, 'admin_password', password_hash($new, PASSWORD_DEFAULT));
    ok(['message' => 'Password reset']);
}

if ($method === 'POST' && $action === 'save_sec_question') {
    $q  = $d['question'] ?? '';
    $a  = strtolower(trim($d['answer'] ?? ''));
    $a2 = strtolower(trim($d['answer2'] ?? ''));
    if (!$q) fail('Question required');
    if (!$a) fail('Answer required');
    if ($a !== $a2) fail('Answers do not match');
    setSetting($pdo, 'admin_sec_question', $q);
    setSetting($pdo, 'admin_sec_answer', $a);
    ok(['message' => 'Security question saved']);
}

// ── Generic setting get/set ──
if ($method === 'POST' && $action === 'get_setting') {
    $key = $d['key'] ?? '';
    dbg('admin', "get_setting key=$key");
    if (!$key) fail('Missing key');
    $val = getSetting($pdo, $key);
    // debug_mode defaults to '0' (disabled) if never set
    if ($val === null && $key === 'debug_mode') {
        setSetting($pdo, 'debug_mode', '0');
        $val = '0';
    }
    ok(['value' => $val]);
}

if ($method === 'POST' && ($action === 'set_setting' || $action === 'save_setting')) {
    $key = $d['key'] ?? '';
    $val = $d['value'] ?? '';
    dbg('admin', "set_setting key=$key value=$val");
    if (!$key) fail('Missing key');
    setSetting($pdo, $key, $val);
    ok(['message' => 'Setting saved']);
}

// ── Log file reader ──
if ($method === 'POST' && $action === 'read_log') {
    $allowed = ['notify_log.txt', 'webhook_log.txt', 'error_log.txt'];
    $file = $d['file'] ?? '';
    if (!in_array($file, $allowed)) fail('Invalid log file');
    $path = dirname(__DIR__) . '/' . $file;
    if (!file_exists($path)) ok(['content' => 'No entries yet.']);
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $lines = array_reverse(array_slice($lines, -200));
    ok(['content' => implode("\n", $lines)]);
}

if ($method === 'POST' && $action === 'clear_log') {
    $allowed = ['notify_log.txt', 'webhook_log.txt', 'error_log.txt'];
    $file = $d['file'] ?? '';
    if (!in_array($file, $allowed)) fail('Invalid log file');
    $path = dirname(__DIR__) . '/' . $file;
    file_put_contents($path, '');
    ok(['message' => 'Log cleared']);
}

// ── Error log (debug mode) ──
if ($method === 'POST' && $action === 'get_error_log') {
    $logfile = dirname(__DIR__) . '/error_log.txt';
    dbg('admin', "get_error_log exists=" . (file_exists($logfile) ? 'yes' : 'no'));
    if (!file_exists($logfile)) ok(['log' => '(error_log.txt not found — enable debug mode and trigger some actions first)']);
    $content = file_get_contents($logfile);
    if (strlen($content) > 100000) $content = "...(truncated, showing last 100KB)...\n" . substr($content, -100000);
    ok(['log' => $content]);
}

if ($method === 'POST' && $action === 'clear_error_log') {
    $logfile = dirname(__DIR__) . '/error_log.txt';
    dbg('admin', 'clear_error_log');
    file_put_contents($logfile, '');
    ok(['message' => 'Error log cleared']);
}

// ── JS debug log ──
if ($method === 'POST' && $action === 'js_debug_log') {
    if (debug_enabled()) {
        $ctx  = $d['ctx']  ?? 'js';
        $msg  = $d['msg']  ?? '';
        $data = $d['data'] ?? '';
        $edt  = (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i:s A') . ' EDT';
        $line = "$edt | JS-DEBUG | $ctx | $msg" . ($data ? " | $data" : "") . "\n";
        file_put_contents(dirname(__DIR__) . '/error_log.txt', $line, FILE_APPEND | LOCK_EX);
    }
    ok(['message' => 'logged']);
}

// ── Email a log file ──
if ($method === 'POST' && $action === 'send_log') {
    $allowed = ['notify_log.txt', 'webhook_log.txt', 'error_log.txt'];
    $file    = $d['file']  ?? '';
    $to      = trim($d['to'] ?? '');
    if (!in_array($file, $allowed)) fail('Invalid log file');
    if (!$to || !filter_var($to, FILTER_VALIDATE_EMAIL)) fail('Invalid email address');
    $path    = dirname(__DIR__) . '/' . $file;
    $logText = file_exists($path) ? file_get_contents($path) : '(empty)';
    if (strlen($logText) > 500000) $logText = "...(truncated to last 500KB)...
" . substr($logText, -500000);
    require_once __DIR__ . '/config.php';
    require_once dirname(__DIR__) . '/mailer.php';
    $edt      = (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT';
    $subject  = "[$file] Log export — $edt";
    $result   = sendEmailWithAttachment(
        $to,
        $subject,
        "<p>Log file <strong>$file</strong> exported $edt. See attached.</p>",
        $file,
        $logText,
        'text/plain',
        'handmadedesignsbysuzi@yahoo.com',
        'Handmade Designs By Suzi'
    );
    // Log to email_log table regardless of success/failure
    $status   = ($result === true) ? 'sent' : 'failed';
    $errorMsg = ($result === true) ? null : (is_string($result) ? $result : 'unknown error');
    // Build preview HTML — dark monospace matching the fullscreen log viewer style
    $escaped    = htmlspecialchars($logText, ENT_QUOTES, 'UTF-8');
    $previewHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
        . '<body style="margin:0;padding:0;background:#1e1e1e">'
        . '<div style="background:#2d2220;padding:.6rem 1rem;display:flex;justify-content:space-between;align-items:center">'
        . '<span style="color:#ffe082;font-weight:700;font-size:.9rem">' . htmlspecialchars($file, ENT_QUOTES, 'UTF-8') . '</span>'
        . '<span style="color:#a0a0a0;font-size:.8rem">' . htmlspecialchars($edt, ENT_QUOTES, 'UTF-8') . ' &mdash; emailed to ' . htmlspecialchars($to, ENT_QUOTES, 'UTF-8') . '</span>'
        . '</div>'
        . '<pre style="margin:0;padding:1.2rem;font-family:monospace;font-size:.75rem;line-height:1.7;'
        . 'color:#d4d4d4;white-space:pre-wrap;word-break:break-all;background:#1e1e1e">'
        . $escaped
        . '</pre></body></html>';
    $logStmt  = $pdo->prepare("INSERT INTO email_log (sent_at, email_type, sent_to, order_id, subject, status, error_msg, email_body)
        VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'), :type, :to, :order_id, :subject, :status, :error, :body)");
    $logStmt->execute([
        ':type'     => 'Log Export',
        ':to'       => $to,
        ':order_id' => '',
        ':subject'  => $subject,
        ':status'   => $status,
        ':error'    => $errorMsg,
        ':body'     => $previewHtml,
    ]);
    if ($result === true) ok(['message' => "Log emailed to $to"]);
    fail('Email failed: ' . $errorMsg);
}

fail('Unknown action', 400);
