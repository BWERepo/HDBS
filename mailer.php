<?php
// mailer.php — Shared SMTP mailer helper
// Include this in notify.php and order_confirm.php

function _smtpConfig() {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    try {
        require_once __DIR__ . '/api/config.php';
        $pdo = db();
        $rows = $pdo->query("SELECT key_name, value FROM settings WHERE key_name IN ('smtp_host','smtp_port','smtp_user','smtp_pass')")->fetchAll(PDO::FETCH_KEY_PAIR);
        $cfg = [
            'host' => $rows['smtp_host'] ?? 'smtp.mail.yahoo.com',
            'port' => (int)($rows['smtp_port'] ?? 587),
            'user' => $rows['smtp_user'] ?? '',
            'pass' => $rows['smtp_pass'] ?? '',
        ];
    } catch (Exception $e) {
        $cfg = ['host'=>'smtp.mail.yahoo.com','port'=>587,'user'=>'','pass'=>''];
    }
    return $cfg;
}

// Splice the brand logo into each template's own colored header block (the div carrying the
// business name), turning it into a flex row so the logo sits beside the title/subtitle instead
// of in a separate masthead bar above everything. Templates all use one of three header
// background colors, and the header div is always the first one using them (footers reuse the
// same colors but appear later in the document), so matching only the first occurrence reliably
// finds the header across every template without depending on whether it wraps the name in an
// <h1> or a plain styled <div>, or has a subtitle line under it.
function _emailLogoHeader($html) {
    $logo = '<img src="https://handmadedesignsbysuzi.com/HDBSLogo.jpeg" alt="" '
          . 'style="height:50px;width:auto;flex-shrink:0;border:0">';
    $pattern = '/<div\s+style=([\'"])((?:(?!\1).)*?background\s*:\s*(?:#a07810|#2d2220|linear-gradient\(\s*135deg\s*,\s*#a07810\s*,\s*#d4a017\s*\))(?:(?!\1).)*)\1([^>]*)>(.*?)<\/div>/is';
    if (preg_match($pattern, $html)) {
        return preg_replace_callback($pattern, function($m) use ($logo) {
            $style = rtrim($m[2], '; ') . ';display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap';
            return '<div style=' . $m[1] . $style . $m[1] . $m[3] . '>'
                 . $logo
                 . '<div style="text-align:center">' . $m[4] . '</div>'
                 . '</div>';
        }, $html, 1);
    }
    // No matching header found (unexpected template shape) — fall back to a simple masthead bar
    // above the body so the logo still appears somewhere rather than silently vanishing.
    $fallback = '<div style="text-align:center;background:#2d2220;padding:14px 0">' . $logo . '</div>';
    if (preg_match('/<body[^>]*>/i', $html)) {
        return preg_replace('/(<body[^>]*>)/i', '$1' . $fallback, $html, 1);
    }
    return $fallback . $html;
}

// $html is BY REFERENCE: applying the logo here mutates the caller's own variable, so anything
// the caller logs to email_log afterward (or reuses) reflects the actual email that was sent,
// not the pre-logo template. Every call site passes a plain variable, so this is always safe.
// Strips CR/LF (and other control chars) so a value can't inject extra SMTP headers —
// every header-line value below (subject, from name/email, recipients, attachment name)
// is user- or order-data-derived somewhere upstream, so this is applied unconditionally.
function _noCrlf($s) { return preg_replace('/[\r\n]+/', ' ', (string)$s); }

function sendEmail($to, $subject, &$html, $from_email, $from_name) {
    $to = is_array($to) ? array_map('_noCrlf', $to) : _noCrlf($to);
    $subject   = _noCrlf($subject);
    $from_email = _noCrlf($from_email);
    $from_name  = _noCrlf($from_name);
    $html = _emailLogoHeader($html);
    $c = _smtpConfig();
    $smtp_host = $c['host'];
    $smtp_port = $c['port'];
    $smtp_user = $c['user'];
    $smtp_pass = $c['pass'];

    // Log to debug
    $log_prefix = date('Y-m-d g:i A', strtotime('now')) . ' EDT';

    $sock = @fsockopen($smtp_host, $smtp_port, $errno, $errstr, 15);
    if (!$sock) {
        // Port 587 failed, try 465 SSL
        $sock = @fsockopen("ssl://{$smtp_host}", 465, $errno2, $errstr2, 15);
        if (!$sock) return "Cannot connect: 587={$errstr}, 465={$errstr2}";
    }
    stream_set_timeout($sock, 15);

    function smtp_read($sock) {
        $resp = '';
        while ($line = fgets($sock, 512)) {
            $resp .= $line;
            if (strlen($line) >= 4 && $line[3] === ' ') break;
        }
        return trim($resp);
    }

    smtp_read($sock); // banner
    fputs($sock, "EHLO handmadedesignsbysuzi.com\r\n");
    $ehlo = smtp_read($sock);

    // STARTTLS if supported
    if (strpos($ehlo, 'STARTTLS') !== false) {
        fputs($sock, "STARTTLS\r\n");
        $r = smtp_read($sock);
        if (substr($r, 0, 3) === '220') {
            stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
            fputs($sock, "EHLO handmadedesignsbysuzi.com\r\n");
            smtp_read($sock);
        }
    }

    // AUTH
    fputs($sock, "AUTH LOGIN\r\n");
    $r = smtp_read($sock);
    if (substr($r, 0, 3) !== '334') { fclose($sock); return "AUTH failed: {$r}"; }

    fputs($sock, base64_encode($smtp_user) . "\r\n");
    $r = smtp_read($sock);
    if (substr($r, 0, 3) !== '334') { fclose($sock); return "User rejected: {$r}"; }

    fputs($sock, base64_encode($smtp_pass) . "\r\n");
    $r = smtp_read($sock);
    if (substr($r, 0, 3) !== '235') { fclose($sock); return "Password rejected: {$r}"; }

    // Send
    fputs($sock, "MAIL FROM:<{$from_email}>\r\n");
    $r = smtp_read($sock);
    if (substr($r, 0, 1) !== '2') { fclose($sock); return "MAIL FROM rejected: {$r}"; }

    foreach ((array)$to as $recipient) {
        fputs($sock, "RCPT TO:<{$recipient}>\r\n");
        smtp_read($sock);
    }

    fputs($sock, "DATA\r\n");
    $r = smtp_read($sock);
    if (substr($r, 0, 3) !== '354') { fclose($sock); return "DATA rejected: {$r}"; }

    $to_str = is_array($to) ? implode(', ', $to) : $to;
    $msg  = "From: =?UTF-8?B?" . base64_encode($from_name) . "?= <{$from_email}>\r\n";
    $msg .= "To: {$to_str}\r\n";
    $msg .= "Subject: {$subject}\r\n";
    $msg .= "MIME-Version: 1.0\r\n";
    $msg .= "Content-Type: text/html; charset=UTF-8\r\n";
    $msg .= "Content-Transfer-Encoding: base64\r\n\r\n";
    $msg .= chunk_split(base64_encode($html));
    $msg .= "\r\n.\r\n";

    fputs($sock, $msg);
    $r = smtp_read($sock);
    fputs($sock, "QUIT\r\n");
    fclose($sock);

    if (substr($r, 0, 1) !== '2') return "Message rejected: {$r}";
    return true;
}

// $html is BY REFERENCE — see sendEmail() above for why.
function sendEmailWithAttachment($to, $subject, &$html, $attachName, $attachContent, $attachMime, $from_email, $from_name) {
    $to = is_array($to) ? array_map('_noCrlf', $to) : _noCrlf($to);
    $subject    = _noCrlf($subject);
    $from_email = _noCrlf($from_email);
    $from_name  = _noCrlf($from_name);
    $attachName = _noCrlf($attachName);
    $html = _emailLogoHeader($html);
    $c = _smtpConfig();
    $smtp_host = $c['host'];
    $smtp_port = $c['port'];
    $smtp_user = $c['user'];
    $smtp_pass = $c['pass'];

    $sock = @fsockopen($smtp_host, $smtp_port, $errno, $errstr, 15);
    if (!$sock) {
        $sock = @fsockopen("ssl://{$smtp_host}", 465, $errno2, $errstr2, 15);
        if (!$sock) return "Cannot connect: 587={$errstr}, 465={$errstr2}";
    }
    stream_set_timeout($sock, 15);

    function smtp_read2($sock) {
        $resp = '';
        while ($line = fgets($sock, 512)) {
            $resp .= $line;
            if (strlen($line) >= 4 && $line[3] === ' ') break;
        }
        return trim($resp);
    }

    smtp_read2($sock);
    fputs($sock, "EHLO handmadedesignsbysuzi.com\r\n");
    $ehlo = smtp_read2($sock);

    if (strpos($ehlo, 'STARTTLS') !== false) {
        fputs($sock, "STARTTLS\r\n");
        $r = smtp_read2($sock);
        if (substr($r, 0, 3) === '220') {
            stream_socket_enable_crypto($sock, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
            fputs($sock, "EHLO handmadedesignsbysuzi.com\r\n");
            smtp_read2($sock);
        }
    }

    fputs($sock, "AUTH LOGIN\r\n");
    $r = smtp_read2($sock);
    if (substr($r, 0, 3) !== '334') { fclose($sock); return "AUTH failed: {$r}"; }
    fputs($sock, base64_encode($smtp_user) . "\r\n");
    $r = smtp_read2($sock);
    if (substr($r, 0, 3) !== '334') { fclose($sock); return "User rejected: {$r}"; }
    fputs($sock, base64_encode($smtp_pass) . "\r\n");
    $r = smtp_read2($sock);
    if (substr($r, 0, 3) !== '235') { fclose($sock); return "Password rejected: {$r}"; }

    fputs($sock, "MAIL FROM:<{$from_email}>\r\n");
    $r = smtp_read2($sock);
    if (substr($r, 0, 1) !== '2') { fclose($sock); return "MAIL FROM rejected: {$r}"; }

    foreach ((array)$to as $recipient) {
        fputs($sock, "RCPT TO:<{$recipient}>\r\n");
        smtp_read2($sock);
    }

    fputs($sock, "DATA\r\n");
    $r = smtp_read2($sock);
    if (substr($r, 0, 3) !== '354') { fclose($sock); return "DATA rejected: {$r}"; }

    $boundary = '----=_Part_' . md5(uniqid());
    $to_str   = is_array($to) ? implode(', ', $to) : $to;

    $msg  = "From: =?UTF-8?B?" . base64_encode($from_name) . "?= <{$from_email}>\r\n";
    $msg .= "To: {$to_str}\r\n";
    $msg .= "Subject: {$subject}\r\n";
    $msg .= "MIME-Version: 1.0\r\n";
    $msg .= "Content-Type: multipart/mixed; boundary=\"{$boundary}\"\r\n\r\n";

    // HTML body part
    $msg .= "--{$boundary}\r\n";
    $msg .= "Content-Type: text/html; charset=UTF-8\r\n";
    $msg .= "Content-Transfer-Encoding: base64\r\n\r\n";
    $msg .= chunk_split(base64_encode($html)) . "\r\n";

    // Attachment part
    $msg .= "--{$boundary}\r\n";
    $msg .= "Content-Type: {$attachMime}; name=\"{$attachName}\"\r\n";
    $msg .= "Content-Disposition: attachment; filename=\"{$attachName}\"\r\n";
    $msg .= "Content-Transfer-Encoding: base64\r\n\r\n";
    $msg .= chunk_split(base64_encode($attachContent)) . "\r\n";

    $msg .= "--{$boundary}--\r\n";
    $msg .= "\r\n.\r\n";

    fputs($sock, $msg);
    $r = smtp_read2($sock);
    fputs($sock, "QUIT\r\n");
    fclose($sock);

    if (substr($r, 0, 1) !== '2') return "Message rejected: {$r}";
    return true;
}
