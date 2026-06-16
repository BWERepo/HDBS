<?php
// mailer.php — Shared SMTP mailer helper
// Include this in notify.php and order_confirm.php

function sendEmail($to, $subject, $html, $from_email, $from_name) {
    $smtp_host = 'smtp.mail.yahoo.com';
    $smtp_port = 587;
    $smtp_user = 'handmadedesignsbysuzi@yahoo.com';
    $smtp_pass = 'hvgcsasrvycrofeu';

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

function sendEmailWithAttachment($to, $subject, $html, $attachName, $attachContent, $attachMime, $from_email, $from_name) {
    $smtp_host = 'smtp.mail.yahoo.com';
    $smtp_port = 587;
    $smtp_user = 'handmadedesignsbysuzi@yahoo.com';
    $smtp_pass = 'hvgcsasrvycrofeu';

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
