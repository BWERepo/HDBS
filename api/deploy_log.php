<?php
// api/deploy_log.php — Record and retrieve deployment history
require_once __DIR__ . '/config.php';
cors();

$logFile = dirname(__DIR__) . '/deploy.log';
$method  = $_SERVER['REQUEST_METHOD'];
$d       = body();

if ($method === 'POST') {
    // deploy.ps1/watch.ps1 call this with no admin token (auth is out-of-band: only someone
    // with the FTP credentials can deploy in the first place), so this can't be requireAdmin()-
    // gated without breaking the deploy pipeline. Rate limit instead, to stop an unauthenticated
    // caller from spamming forged log entries or repeatedly forcing the version-bump debounce.
    $pdo = db();
    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_login_attempts (
        email_hash CHAR(32) PRIMARY KEY,
        attempts   INT NOT NULL DEFAULT 0,
        last_at    INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $dlHash = md5('deploy_log_ip_' . ($_SERVER['REMOTE_ADDR'] ?? ''));
    $dlNow  = time();
    $dlRow  = $pdo->prepare("SELECT attempts, last_at FROM customer_login_attempts WHERE email_hash = ?");
    $dlRow->execute([$dlHash]);
    $dlRow  = $dlRow->fetch() ?: ['attempts' => 0, 'last_at' => 0];
    if ($dlRow['attempts'] >= 30 && ($dlNow - $dlRow['last_at']) < 3600) {
        fail('Too many requests.', 429);
    }
    if ($dlRow['attempts'] >= 30) { $dlRow['attempts'] = 0; }
    $pdo->prepare("INSERT INTO customer_login_attempts (email_hash,attempts,last_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE attempts=?,last_at=?")
        ->execute([$dlHash, $dlRow['attempts'] + 1, $dlNow, $dlRow['attempts'] + 1, $dlNow]);

    $files = $d['files'] ?? [];
    if (!is_array($files)) fail('Invalid files', 400);
    $count = (int)($d['count'] ?? count($files));
    $mode  = $d['mode'] ?? 'single';
    if (!in_array($mode, ['single', 'full'])) $mode = 'single';
    // Cap entry size and log file size to prevent disk fill
    $files = array_slice(array_map('strval', $files), 0, 500);
    if (file_exists($logFile) && filesize($logFile) > 512 * 1024) {
        // Trim to last 200 lines
        $lines = file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        file_put_contents($logFile, implode("\n", array_slice($lines, -200)) . "\n");
    }
    // Auto-bump the minor version on PRODUCTION deploys only. Staging is deliberately left
    // untouched so active-dev staging deploys (incl. watch.ps1 auto-deploy) don't inflate the
    // version. Debounced via version_updated_at (300s) so several deploy calls inside one
    // checkpoint window bump the minor once, not once per call. $__staging comes from config.php.
    if (empty($__staging)) {
        try {
            $lastTs = ($la = getSetting($pdo, 'version_updated_at')) ? strtotime($la) : 0;
            if (time() - $lastTs > 300) {
                $minNow = (int)(getSetting($pdo, 'minor_version') ?? 0);
                setSetting($pdo, 'minor_version', (string)($minNow + 1));
                setSetting($pdo, 'version_updated_at', date('c'));
            }
        } catch (Exception $e) {}
    }
    // Capture the current site version so each deploy records the version it produced
    $version = '';
    try {
        $maj = getSetting($pdo, 'major_version');
        $min = getSetting($pdo, 'minor_version');
        if ($maj !== null || $min !== null) $version = ($maj !== null ? $maj : '0') . '.' . ($min !== null ? $min : '0');
    } catch (Exception $e) {}
    $entry = json_encode(['ts' => date('c'), 'count' => $count, 'mode' => $mode, 'version' => $version, 'files' => array_values($files)]);
    file_put_contents($logFile, $entry . "\n", FILE_APPEND | LOCK_EX);
    ok(['message' => 'Logged', 'version' => $version]);
}

if ($method === 'GET') {
    requireAdmin();
    $entries = [];
    if (file_exists($logFile)) {
        foreach (file($logFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            $r = json_decode($line, true);
            if ($r) $entries[] = $r;
        }
    }
    // Most recent first
    $entries = array_reverse($entries);
    ok(['deploys' => $entries]);
}
