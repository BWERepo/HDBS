<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
cors();
$pdo = db();
$method = $_SERVER['REQUEST_METHOD'];
dbg('email_log', "REQUEST method=$method");

// GET — return email log with optional filters
if($method === 'GET'){
    $where = '1=1';
    $params = [];
    if(!empty($_GET['order_id'])){ $where .= ' AND order_id=?'; $params[] = $_GET['order_id']; }
    if(!empty($_GET['type'])){ $where .= ' AND email_type=?'; $params[] = $_GET['type']; }
    $rows = $pdo->prepare("SELECT * FROM email_log WHERE {$where} ORDER BY sent_at DESC LIMIT 500");
    $rows->execute($params);
    $logs = $rows->fetchAll();
dbg('email_log', 'GET returning '.count($logs).' rows');
ok(['logs' => $logs]);
}

// POST — log a sent email
if($method === 'POST'){
    $d = body();
    $stmt = $pdo->prepare("INSERT INTO email_log (sent_at, email_type, sent_to, order_id, subject, status, error_msg)
        VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'), :type, :to, :order_id, :subject, :status, :error)");
    $stmt->execute([
        ':type'     => $d['email_type'] ?? 'unknown',
        ':to'       => $d['sent_to'] ?? '',
        ':order_id' => $d['order_id'] ?? '',
        ':subject'  => $d['subject'] ?? '',
        ':status'   => $d['status'] ?? 'sent',
        ':error'    => $d['error_msg'] ?? null,
    ]);
    dbg('email_log', 'POST logged email type='.($d['email_type']??'?').' to='.($d['sent_to']??'?').' order='.($d['order_id']??'?'));
ok(['message' => 'Logged']);
}

// DELETE — clear all email log entries
if($method === 'DELETE'){
    dbg('email_log','DELETE clearing all log entries');
    $pdo->exec('DELETE FROM email_log');
    ok(['message' => 'Email log cleared']);
}

fail('Method not allowed', 405);
