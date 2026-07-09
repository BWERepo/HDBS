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

if (!function_exists('getSetting')) {
    function getSetting($pdo, $key) {
        $s = $pdo->prepare("SELECT value FROM settings WHERE key_name = ?");
        $s->execute([$key]);
        $r = $s->fetch();
        return $r ? $r['value'] : null;
    }
}
if (!function_exists('setSetting')) {
    function setSetting($pdo, $key, $value) {
        $s = $pdo->prepare("INSERT INTO settings (key_name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?");
        $s->execute([$key, $value, $value]);
    }
}

// ── Login ──
if ($method === 'POST' && $action === 'login') {
    define('LOGIN_MAX_ATTEMPTS', 5);
    define('LOGIN_LOCKOUT_SECONDS', 900); // 15 minutes

    $fails    = (int)(getSetting($pdo, 'login_fail_count') ?? 0);
    $failTime = (int)(getSetting($pdo, 'login_fail_time')  ?? 0);
    $now      = time();

    // Reset stale lockout
    if ($fails >= LOGIN_MAX_ATTEMPTS && ($now - $failTime) >= LOGIN_LOCKOUT_SECONDS) {
        $fails = 0;
        setSetting($pdo, 'login_fail_count', '0');
    }

    if ($fails >= LOGIN_MAX_ATTEMPTS) {
        $remaining = LOGIN_LOCKOUT_SECONDS - ($now - $failTime);
        $mins = (int)ceil($remaining / 60);
        dbg('admin', 'login LOCKED OUT');
        fail("Too many failed attempts. Try again in {$mins} minute" . ($mins === 1 ? '' : 's') . '.');
    }

    $pw   = $d['password'] ?? '';
    $hash = getSetting($pdo, 'admin_password');
    if (!$hash) fail('Admin password not configured. Please set a password via the settings.', 500);
    if (!password_verify($pw, $hash)) {
        $fails++;
        setSetting($pdo, 'login_fail_count', (string)$fails);
        setSetting($pdo, 'login_fail_time',  (string)$now);
        $left = LOGIN_MAX_ATTEMPTS - $fails;
        dbg('admin', "login FAILED fails={$fails}");
        if ($left > 0) fail("Incorrect password. {$left} attempt" . ($left === 1 ? '' : 's') . " remaining.");
        fail('Too many failed attempts. Account locked for 15 minutes.');
    }

    // Success — clear lockout counters, issue session token
    setSetting($pdo, 'login_fail_count', '0');
    setSetting($pdo, 'login_fail_time',  '0');
    $token   = bin2hex(random_bytes(32));
    $expires = time() + 8 * 3600; // 8 hours
    // Per-session token (supports concurrent admin sessions; not clobbered by other logins/tools)
    try {
        adminSessionsTable($pdo);
        $pdo->prepare("DELETE FROM admin_sessions WHERE expires < ?")->execute([time()]);
        $pdo->prepare("INSERT INTO admin_sessions (token, expires) VALUES (?, ?)")->execute([$token, $expires]);
    } catch (Exception $e) {}
    // Legacy single token (kept for backward compatibility during transition)
    setSetting($pdo, 'admin_session_token',   $token);
    setSetting($pdo, 'admin_session_expires', (string)$expires);
    dbg('admin', 'login ok');
    ok(['message' => 'Logged in', 'token' => $token]);
}

// ── Logout ──
if ($method === 'POST' && $action === 'logout') {
    requireAdmin();
    $tok = $_SERVER['HTTP_X_ADMIN_TOKEN'] ?? '';
    try { $pdo->prepare("DELETE FROM admin_sessions WHERE token = ?")->execute([$tok]); } catch (Exception $e) {}
    setSetting($pdo, 'admin_session_token',   '');
    setSetting($pdo, 'admin_session_expires', '0');
    ok(['message' => 'Logged out']);
}

// ── Change password ──
if ($method === 'POST' && $action === 'change_password') {
    requireAdmin();
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

if ($method === 'POST' && ($action === 'verify_sec_answer' || $action === 'reset_password')) {
    // Rate limit: 5 attempts, 15-minute lockout (shared with login lockout)
    $secFails = (int)(getSetting($pdo, 'sec_fail_count') ?? 0);
    $secTime  = (int)(getSetting($pdo, 'sec_fail_time')  ?? 0);
    $now      = time();
    if ($secFails >= 5 && ($now - $secTime) >= 900) { $secFails = 0; setSetting($pdo, 'sec_fail_count', '0'); }
    if ($secFails >= 5) {
        $mins = (int)ceil((900 - ($now - $secTime)) / 60);
        fail("Too many failed attempts. Try again in {$mins} minute" . ($mins === 1 ? '' : 's') . '.');
    }

    $ans    = strtolower(trim($d['answer'] ?? ''));
    $stored = getSetting($pdo, 'admin_sec_answer');
    // Support both bcrypt-hashed answers (new) and legacy plain-text answers (migration)
    $answerOk = $stored && (
        (str_starts_with($stored, '$2y$') && password_verify($ans, $stored)) ||
        (!str_starts_with($stored, '$2y$') && $ans === $stored)
    );
    if (!$answerOk) {
        $secFails++;
        setSetting($pdo, 'sec_fail_count', (string)$secFails);
        setSetting($pdo, 'sec_fail_time',  (string)$now);
        $left = 5 - $secFails;
        if ($left > 0) fail("Incorrect answer. {$left} attempt" . ($left === 1 ? '' : 's') . ' remaining.');
        fail('Too many failed attempts. Try again in 15 minutes.');
    }
    setSetting($pdo, 'sec_fail_count', '0');
    setSetting($pdo, 'sec_fail_time',  '0');

    if ($action === 'verify_sec_answer') ok(['message' => 'Verified']);

    // reset_password
    $new = $d['new'] ?? '';
    if (!$new) fail('Password cannot be empty');
    setSetting($pdo, 'admin_password', password_hash($new, PASSWORD_DEFAULT));
    // Invalidate ALL existing admin sessions so the user must log in with the new password
    try { $pdo->exec("DELETE FROM admin_sessions"); } catch (Exception $e) {}
    setSetting($pdo, 'admin_session_token',   '');
    setSetting($pdo, 'admin_session_expires', '0');
    ok(['message' => 'Password reset']);
}

if ($method === 'POST' && $action === 'save_sec_question') {
    requireAdmin();
    $q  = $d['question'] ?? '';
    $a  = strtolower(trim($d['answer'] ?? ''));
    $a2 = strtolower(trim($d['answer2'] ?? ''));
    if (!$q) fail('Question required');
    if (!$a) fail('Answer required');
    if ($a !== $a2) fail('Answers do not match');
    setSetting($pdo, 'admin_sec_question', $q);
    setSetting($pdo, 'admin_sec_answer', password_hash($a, PASSWORD_DEFAULT));
    ok(['message' => 'Security question saved']);
}

// ── Generic setting get/set ──
if ($method === 'POST' && $action === 'get_setting') {
    $publicKeys = ['square_fees','tax_rates','product_categories','cat_prefixes','shipping_config',
                   'square_mode','square_app_id','square_location_id','confirm_token',
                   'major_version','minor_version','debug_mode','log_page_changes'];
    $key = $d['key'] ?? '';
    if (!in_array($key, $publicKeys)) requireAdmin();
    dbg('admin', "get_setting key=$key");
    if (!$key) fail('Missing key');
    $sensitive = ['github_token','admin_password','admin_sec_answer','square_access_token','square_app_secret','smtp_pass'];
    if (in_array($key, $sensitive)) fail('Forbidden');
    $val = getSetting($pdo, $key);
    // default unset boolean settings to '0'
    if ($val === null && in_array($key, ['debug_mode', 'log_page_changes'])) {
        setSetting($pdo, $key, '0');
        $val = '0';
    }
    // auto-generate rt_token if not set
    if ($val === null && $key === 'rt_token') {
        $val = bin2hex(random_bytes(16));
        setSetting($pdo, $key, $val);
    }
    // auto-generate confirm_token if not set
    if ($val === null && $key === 'confirm_token') {
        $val = bin2hex(random_bytes(16));
        setSetting($pdo, $key, $val);
    }
    // auto-generate backup_token if not set
    if ($val === null && $key === 'backup_token') {
        $val = bin2hex(random_bytes(16));
        setSetting($pdo, $key, $val);
    }
    // default version settings
    if ($val === null && $key === 'major_version') { setSetting($pdo, $key, '1'); $val = '1'; }
    if ($val === null && $key === 'minor_version') { setSetting($pdo, $key, '0'); $val = '0'; }
    ok(['value' => $val]);
}

if ($method === 'POST' && ($action === 'set_setting' || $action === 'save_setting')) {
    requireAdmin();
    $key = $d['key'] ?? '';
    $val = $d['value'] ?? '';
    dbg('admin', "set_setting key=$key value=$val");
    if (!$key) fail('Missing key');
    $sensitive = ['github_token','admin_password','admin_sec_answer','square_access_token','square_app_secret','smtp_pass'];
    if (in_array($key, $sensitive)) fail('Forbidden');
    // biz_profile.logo arrives as a base64 data URI from the admin form — save it to disk as a
    // real file (like product images) so it's usable in <img src>, og:image, and JSON-LD, which
    // all require a fetchable URL rather than a data: URI.
    if ($key === 'biz_profile') {
        $biz = json_decode($val, true);
        if (is_array($biz) && !empty($biz['logo']) && preg_match('/^data:image\/(\w+);base64,(.+)$/s', $biz['logo'], $m)) {
            if (strlen($m[2]) > 4 * 1024 * 1024 * 4 / 3) fail('Logo image too large (max 4MB)', 400);
            $bytes = base64_decode($m[2], true);
            if (!$bytes) fail('Could not decode logo image', 400);
            $magic  = substr($bytes, 0, 4);
            $isJpeg = (substr($magic, 0, 2) === "\xFF\xD8");
            $isPng  = ($magic === "\x89PNG");
            if (!$isJpeg && !$isPng) fail('Invalid logo image format — only JPEG and PNG are accepted', 400);
            $logoDir = dirname(__DIR__) . '/business_logo/';
            $logoUrl = ALLOWED_ORIGIN . '/business_logo/';
            if (!is_dir($logoDir)) mkdir($logoDir, 0755, true);
            $ext      = $isPng ? 'png' : 'jpg';
            $filename = 'logo_' . time() . '.' . $ext;
            file_put_contents($logoDir . $filename, $bytes);
            // Remove the previous logo file, if any, to avoid orphaning uploads
            $oldLogo = getSetting($pdo, 'biz_profile');
            if ($oldLogo) {
                $oldBiz = json_decode($oldLogo, true);
                if (!empty($oldBiz['logo']) && strpos($oldBiz['logo'], $logoUrl) === 0) {
                    $oldFile = $logoDir . basename($oldBiz['logo']);
                    if (is_file($oldFile)) @unlink($oldFile);
                }
            }
            $biz['logo'] = $logoUrl . $filename;
            $val = json_encode($biz);
        }
        // biz_profile.hero_image works the same way — arrives as a base64 data URI, gets
        // saved to disk, and the setting stores the fetchable URL instead.
        if (is_array($biz) && !empty($biz['hero_image']) && preg_match('/^data:image\/(\w+);base64,(.+)$/s', $biz['hero_image'], $m2)) {
            if (strlen($m2[2]) > 4 * 1024 * 1024 * 4 / 3) fail('Hero image too large (max 4MB)', 400);
            $bytes2 = base64_decode($m2[2], true);
            if (!$bytes2) fail('Could not decode hero image', 400);
            $magic2  = substr($bytes2, 0, 4);
            $isJpeg2 = (substr($magic2, 0, 2) === "\xFF\xD8");
            $isPng2  = ($magic2 === "\x89PNG");
            if (!$isJpeg2 && !$isPng2) fail('Invalid hero image format — only JPEG and PNG are accepted', 400);
            $heroDir = dirname(__DIR__) . '/business_hero/';
            $heroUrl = ALLOWED_ORIGIN . '/business_hero/';
            if (!is_dir($heroDir)) mkdir($heroDir, 0755, true);
            $ext2      = $isPng2 ? 'png' : 'jpg';
            $filename2 = 'hero_' . time() . '.' . $ext2;
            file_put_contents($heroDir . $filename2, $bytes2);
            // Remove the previous hero image file, if any, to avoid orphaning uploads
            $oldHeroRaw = getSetting($pdo, 'biz_profile');
            $oldHero = $oldHeroRaw ? json_decode($oldHeroRaw, true) : null;
            if (!empty($oldHero['hero_image']) && strpos($oldHero['hero_image'], $heroUrl) === 0) {
                $oldFile2 = $heroDir . basename($oldHero['hero_image']);
                if (is_file($oldFile2)) @unlink($oldFile2);
            }
            $biz['hero_image'] = $heroUrl . $filename2;
            $val = json_encode($biz);
        }
    }
    setSetting($pdo, $key, $val);
    // Track when the version actually last changed, so the footer can show that instead of
    // "now" (it used to just render new Date() at page load, which is meaningless)
    if ($key === 'major_version' || $key === 'minor_version') {
        setSetting($pdo, 'version_updated_at', date('c'));
    }
    ok(['message' => 'Setting saved']);
}

if ($method === 'POST' && $action === 'save_github_token') {
    requireAdmin();
    $val = $d['value'] ?? '';
    setSetting($pdo, 'github_token', $val);
    ok(['message' => 'Token saved']);
}

if ($method === 'POST' && $action === 'get_github_token') {
    requireAdmin();
    ok(['value' => getSetting($pdo, 'github_token')]);
}

if ($method === 'POST' && $action === 'get_smtp') {
    requireAdmin();
    ok([
        'host' => getSetting($pdo, 'smtp_host') ?? '',
        'port' => getSetting($pdo, 'smtp_port') ?? '587',
        'user' => getSetting($pdo, 'smtp_user') ?? '',
        'pass_set' => (getSetting($pdo, 'smtp_pass') !== null && getSetting($pdo, 'smtp_pass') !== ''),
    ]);
}

if ($method === 'POST' && $action === 'save_smtp') {
    requireAdmin();
    $host = trim($d['host'] ?? '');
    $port = (int)($d['port'] ?? 587);
    $user = trim($d['user'] ?? '');
    $pass = $d['pass'] ?? '';
    if (!$host || !$user) fail('Host and user required');
    setSetting($pdo, 'smtp_host', $host);
    setSetting($pdo, 'smtp_port', (string)$port);
    setSetting($pdo, 'smtp_user', $user);
    if ($pass !== '') setSetting($pdo, 'smtp_pass', $pass);
    ok(['message' => 'SMTP settings saved']);
}

// ── Log file reader ──
if ($method === 'POST' && $action === 'read_log') {
    requireAdmin();
    $allowed = ['notify_log.txt', 'webhook_log.txt', 'error_log.txt', 'pages.log'];
    $file = $d['file'] ?? '';
    if (!in_array($file, $allowed)) fail('Invalid log file');
    $path = dirname(__DIR__) . '/' . $file;
    if (!file_exists($path)) ok(['content' => 'No entries yet.']);
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $lines = array_reverse(array_slice($lines, -200));
    ok(['content' => implode("\n", $lines)]);
}

if ($method === 'POST' && $action === 'clear_log') {
    requireAdmin();
    $allowed = ['notify_log.txt', 'webhook_log.txt', 'error_log.txt', 'pages.log'];
    $file = $d['file'] ?? '';
    if (!in_array($file, $allowed)) fail('Invalid log file');
    $path = dirname(__DIR__) . '/' . $file;
    file_put_contents($path, '');
    ok(['message' => 'Log cleared']);
}

// ── Error log (debug mode) ──
if ($method === 'POST' && $action === 'get_error_log') {
    requireAdmin();
    $logfile = dirname(__DIR__) . '/error_log.txt';
    dbg('admin', "get_error_log exists=" . (file_exists($logfile) ? 'yes' : 'no'));
    if (!file_exists($logfile)) ok(['log' => '(error_log.txt not found — enable debug mode and trigger some actions first)']);
    $content = file_get_contents($logfile);
    if (strlen($content) > 100000) $content = "...(truncated, showing last 100KB)...\n" . substr($content, -100000);
    ok(['log' => $content]);
}

if ($method === 'POST' && $action === 'clear_error_log') {
    requireAdmin();
    $logfile = dirname(__DIR__) . '/error_log.txt';
    dbg('admin', 'clear_error_log');
    file_put_contents($logfile, '');
    ok(['message' => 'Error log cleared']);
}

// ── JS debug log ──
if ($method === 'POST' && $action === 'js_debug_log') {
    if (debug_enabled()) {
        $ctx  = substr($d['ctx']  ?? 'js',  0, 64);
        $msg  = substr($d['msg']  ?? '',    0, 500);
        $data = substr($d['data'] ?? '',    0, 1000);
        $edt  = (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i:s A') . ' EDT';
        $line = "$edt | JS-DEBUG | $ctx | $msg" . ($data ? " | $data" : "") . "\n";
        $logfile = dirname(__DIR__) . '/error_log.txt';
        if (!file_exists($logfile) || filesize($logfile) < 2 * 1024 * 1024) {
            file_put_contents($logfile, $line, FILE_APPEND | LOCK_EX);
        }
    }
    ok(['message' => 'logged']);
}

// ── Email a log file ──
if ($method === 'POST' && $action === 'send_log') {
    requireAdmin();
    $allowed = ['notify_log.txt', 'webhook_log.txt', 'error_log.txt', 'pages.log'];
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
    $html     = "<p>Log file <strong>$file</strong> exported $edt. See attached.</p>";
    $result   = sendEmailWithAttachment(
        $to,
        $subject,
        $html,
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

// ── Page view logger ──
if ($method === 'POST' && $action === 'log_page_view') {
    $page = trim($d['page'] ?? '');
    if ($page) pagelog('admin', $page);
    ok(['message' => 'logged']);
}

if ($action === 'get_version') {
    $major = getSetting($pdo, 'major_version') ?? '1';
    $minor = getSetting($pdo, 'minor_version') ?? '0';
    $updatedAt = getSetting($pdo, 'version_updated_at');
    ok(['version' => $major . '.' . $minor, 'major' => $major, 'minor' => $minor, 'updated_at' => $updatedAt]);
}

if ($method === 'POST' && $action === 'increment_minor_version') {
    requireAdmin();
    $minor = (int)(getSetting($pdo, 'minor_version') ?? 0);
    $minor++;
    setSetting($pdo, 'minor_version', (string)$minor);
    setSetting($pdo, 'version_updated_at', date('c'));
    $major = getSetting($pdo, 'major_version') ?? '1';
    ok(['version' => $major . '.' . $minor, 'minor' => $minor]);
}

// ── DB table list (row counts) ──
if ($method === 'POST' && $action === 'db_table_list') {
    requireAdmin();
    $tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
    $result = [];
    foreach ($tables as $tbl) {
        $count = $pdo->query("SELECT COUNT(*) FROM `" . $tbl . "`")->fetchColumn();
        $result[] = ['table' => $tbl, 'rows' => (int)$count];
    }
    ok(['tables' => $result]);
}

// ── DB table contents ──
if ($method === 'POST' && $action === 'db_table_contents') {
    requireAdmin();
    $tbl    = trim($d['table'] ?? '');
    $offset = max(0, (int)($d['offset'] ?? 0));
    $limit  = min(200, max(1, (int)($d['limit'] ?? 50)));
    if (!$tbl) fail('table required');
    // Whitelist table name against actual tables to prevent injection
    $allowed = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array($tbl, $allowed, true)) fail('unknown table');
    $total = (int)$pdo->query("SELECT COUNT(*) FROM `" . $tbl . "`")->fetchColumn();
    $rows  = $pdo->query("SELECT * FROM `" . $tbl . "` LIMIT " . $limit . " OFFSET " . $offset)->fetchAll(PDO::FETCH_ASSOC);
    ok(['table' => $tbl, 'total' => $total, 'offset' => $offset, 'limit' => $limit, 'rows' => $rows]);
}

fail('Unknown action', 400);
