<?php
// api/db_backup.php — Database backup via email
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
cors();

$pdo = db();

// Token gate
$stored = $pdo->query("SELECT value FROM settings WHERE key_name='backup_token' LIMIT 1")->fetchColumn();
if (!$stored) {
    $stored = bin2hex(random_bytes(16));
    $pdo->prepare("INSERT INTO settings (key_name,value) VALUES ('backup_token',?) ON DUPLICATE KEY UPDATE value=?")->execute([$stored,$stored]);
}
$given = $_GET['token'] ?? ($GLOBALS['_INPUT']['token'] ?? '');
if (!$given) { $body = body(); $given = $body['token'] ?? ''; }
if (!hash_equals($stored, $given)) {
    http_response_code(403);
    echo json_encode(['success'=>false,'error'=>'Forbidden']);
    exit();
}

// Build SQL dump
$tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
$sql  = "-- Handmade Designs By Suzi — Database Backup\n";
$sql .= "-- Generated: " . date('Y-m-d H:i:s') . " EDT\n";
$sql .= "-- Tables: " . implode(', ', $tables) . "\n\n";
$sql .= "SET FOREIGN_KEY_CHECKS=0;\n\n";

foreach ($tables as $table) {
    // Table structure
    $create = $pdo->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_ASSOC);
    $sql .= "DROP TABLE IF EXISTS `$table`;\n";
    $sql .= $create['Create Table'] . ";\n\n";

    // Table data
    $rows = $pdo->query("SELECT * FROM `$table`")->fetchAll(PDO::FETCH_ASSOC);
    if ($rows) {
        $cols = '`' . implode('`,`', array_keys($rows[0])) . '`';
        $sql .= "INSERT INTO `$table` ($cols) VALUES\n";
        $vals = [];
        foreach ($rows as $row) {
            $escaped = array_map(function($v) use ($pdo) {
                return $v === null ? 'NULL' : $pdo->quote($v);
            }, array_values($row));
            $vals[] = '(' . implode(',', $escaped) . ')';
        }
        $sql .= implode(",\n", $vals) . ";\n\n";
    }
}
$sql .= "SET FOREIGN_KEY_CHECKS=1;\n";

// Email the backup
require_once dirname(__DIR__) . '/mailer.php';
$date     = date('Y-m-d');
$filename = "hdbs-backup-{$date}.sql";
$subject  = "HDBS Database Backup — {$date}";
$html     = "<p style='font-family:Arial;color:#2d2220'>Daily database backup for <strong>Handmade Designs By Suzi</strong>.</p>"
          . "<p style='font-family:Arial;color:#6b6040'>Date: {$date}<br>Tables: " . count($tables) . "<br>Size: " . number_format(strlen($sql)) . " bytes</p>"
          . "<p style='font-family:Arial;color:#a07810;font-style:italic'>Attachment: {$filename}</p>";

$result = sendEmailWithAttachment(
    'handmadedesignsbysuzi@yahoo.com',
    $subject,
    $html,
    $filename,
    $sql,
    'application/sql',
    'handmadedesignsbysuzi@yahoo.com',
    'Handmade Designs By Suzi'
);

$ok = ($result === true);
dbg('db_backup', $ok ? 'Backup emailed OK' : 'Backup email failed: '.(is_string($result)?$result:'unknown'));
ok(['sent' => $ok, 'tables' => count($tables), 'size' => strlen($sql), 'message' => $ok ? 'Backup emailed' : $result]);
