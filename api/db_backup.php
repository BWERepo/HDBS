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

// Local-tooling path: return the raw dump as a downloadable response instead
// of emailing it. Added for /BWEHDBSBackup (modeled on BWEBackup, which pulls
// a local .sql file straight from pg_dump) — this project has no direct DB
// host exposed to run mysqldump from outside Hostinger, so this endpoint is
// the only way to get the dump text at all. Kept separate from the cron path
// below: the daily cron never passes this flag, so the inbox backup keeps
// flowing exactly as before, and an on-demand ?download=1 run doesn't also
// fire off an extra email every time someone pulls a local copy.
if (($_GET['download'] ?? '') === '1') {
    $date = date('Y-m-d');
    header('Content-Type: application/sql; charset=utf-8');
    header('Content-Disposition: attachment; filename="hdbs-backup-' . $date . '.sql"');
    header('Content-Length: ' . strlen($sql));
    echo $sql;
    dbg('db_backup', 'Backup downloaded directly (no email sent), ' . strlen($sql) . ' bytes');
    exit();
}

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

// Log to email_log (every outbound email is recorded; body omitted — attachment is large)
try {
    $pdo->prepare("INSERT INTO email_log (sent_at,email_type,sent_to,order_id,subject,status,email_body) VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'),?,?,?,?,?,?)")
        ->execute(['DB Backup', 'handmadedesignsbysuzi@yahoo.com', '', $subject, $ok?'sent':'failed', $html]);
} catch (Exception $e) {}

ok(['sent' => $ok, 'tables' => count($tables), 'size' => strlen($sql), 'message' => $ok ? 'Backup emailed' : $result]);
