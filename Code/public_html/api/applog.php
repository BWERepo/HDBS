<?php
// applog.php — shared logging helper.
// Usage: applog('context', 'message');
// Usage: dbg('context', 'message');  — only writes when debug_mode=1 in settings table

if (!function_exists('applog')) {
    function applog($ctx, $msg) {
        $edt     = (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i:s A') . ' EDT';
        $logfile = defined('APP_LOG') ? APP_LOG : __DIR__ . '/../notify_log.txt';
        if (!file_exists(dirname($logfile))) $logfile = __DIR__ . '/notify_log.txt';
        file_put_contents($logfile, "$edt | $ctx | $msg\n", FILE_APPEND | LOCK_EX);
    }
}

if (!function_exists('debug_enabled')) {
    function debug_enabled() {
        static $cached = null;
        if ($cached !== null) return $cached;
        try {
            // Use a fresh PDO connection to avoid DbgPDO recursion
            $host = defined('DB_HOST') ? DB_HOST : '127.0.0.1';
            $name = defined('DB_NAME') ? DB_NAME : '';
            $user = defined('DB_USER') ? DB_USER : '';
            $pass = defined('DB_PASS') ? DB_PASS : '';
            if (!$name) { $cached = false; return false; }
            $raw = new PDO("mysql:host=$host;dbname=$name;charset=utf8mb4", $user, $pass,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $st  = $raw->prepare("SELECT value FROM settings WHERE key_name='debug_mode' LIMIT 1");
            $st->execute();
            $row = $st->fetch(PDO::FETCH_ASSOC);
            $cached = ($row && $row['value'] === '1');
        } catch (Exception $e) {
            $cached = false;
        }
        return $cached;
    }
}

if (!function_exists('_dbg_safe')) {
    function _dbg_safe() {
        return function_exists('dbg') && debug_enabled();
    }
}

if (!function_exists('dbg')) {
    function dbg($ctx, $msg) {
        if (!debug_enabled()) return;
        $edt  = (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i:s A') . ' EDT';
        $line = "$edt | DEBUG | $ctx | $msg\n";
        $candidates = [__DIR__ . '/../error_log.txt', __DIR__ . '/error_log.txt'];
        foreach ($candidates as $c) {
            if (file_exists(dirname($c))) { file_put_contents($c, $line, FILE_APPEND | LOCK_EX); return; }
        }
    }
}

if (!function_exists('sq_curl')) {
    function sq_curl($url, $method = 'GET', $body = null, $token = '') {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_HTTPHEADER     => [
                'Square-Version: 2024-01-18',
                'Authorization: Bearer ' . $token,
                'Content-Type: application/json',
            ],
            CURLOPT_CUSTOMREQUEST  => $method,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body));
        }

        if (_dbg_safe()) {
            $bl = $body ? (is_string($body) ? substr($body,0,500) : substr(json_encode($body),0,500)) : 'none';
            dbg('SQ-REQ', "$method $url body=$bl");
        }

        $raw    = curl_exec($ch);
        $err    = curl_error($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if (_dbg_safe()) {
            if ($err) {
                dbg('SQ-ERR', "curl_error=$err url=$url");
            } else {
                dbg('SQ-RESP', "status=$status url=$url body=".substr($raw?:'',0,800));
            }
        }

        if ($err || !$raw) return null;
        return json_decode($raw, true);
    }
}
