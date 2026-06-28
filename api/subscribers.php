<?php
// api/subscribers.php — Newsletter subscribe, list, delete

require_once __DIR__ . '/config.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
$pdo    = db();

// GET — list all subscribers (admin)
if ($method === 'GET') {
    requireAdmin();
    $rows = $pdo->query("SELECT email, DATE_FORMAT(subscribed_at, '%m/%d/%Y') as date FROM subscribers ORDER BY subscribed_at DESC")->fetchAll();
    ok(['subscribers' => $rows]);
}

// POST — subscribe
if ($method === 'POST') {
    // Per-IP rate limit: 5 subscribe attempts per 15 minutes
    (function() use ($pdo) {
        $ip  = $_SERVER['REMOTE_ADDR'] ?? '';
        $key = md5('sub_' . $ip);
        $now = time();
        $pdo->exec("CREATE TABLE IF NOT EXISTS rate_limits (
            key_hash CHAR(32) PRIMARY KEY,
            attempts INT NOT NULL DEFAULT 0,
            last_at  INT NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $row = $pdo->prepare("SELECT attempts, last_at FROM rate_limits WHERE key_hash = ?");
        $row->execute([$key]);
        $row = $row->fetch() ?: ['attempts' => 0, 'last_at' => 0];
        if ($row['attempts'] >= 5 && ($now - $row['last_at']) < 900) {
            $mins = (int)ceil((900 - ($now - $row['last_at'])) / 60);
            fail("Too many requests. Try again in {$mins} minute" . ($mins === 1 ? '' : 's') . '.', 429);
        }
        if ($row['attempts'] >= 5) {
            $pdo->prepare("INSERT INTO rate_limits (key_hash,attempts,last_at) VALUES (?,1,?) ON DUPLICATE KEY UPDATE attempts=1,last_at=?")->execute([$key,$now,$now]);
        } else {
            $new = $row['attempts'] + 1;
            $pdo->prepare("INSERT INTO rate_limits (key_hash,attempts,last_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE attempts=?,last_at=?")->execute([$key,$new,$now,$new,$now]);
        }
    })();

    $d  = body();
    $em = trim($d['email'] ?? '');
    if (!$em || !filter_var($em, FILTER_VALIDATE_EMAIL)) fail('Invalid email address');
    $source = trim($d['source'] ?? ''); // e.g. "Coming Soon: <product>" — records why they signed up

    // Ensure optional source column exists
    if (empty($pdo->query("SHOW COLUMNS FROM subscribers LIKE 'source'")->fetchAll())) $pdo->exec("ALTER TABLE subscribers ADD COLUMN source VARCHAR(160) NULL");

    // Check duplicate
    $check = $pdo->prepare("SELECT id FROM subscribers WHERE email = ?");
    $check->execute([$em]);
    if ($check->fetch()) {
        if ($source !== '') $pdo->prepare("UPDATE subscribers SET source = ? WHERE email = ? AND (source IS NULL OR source = '')")->execute([$source, $em]);
        fail('Already subscribed');
    }

    $pdo->prepare("INSERT INTO subscribers (email, source) VALUES (?, ?)")->execute([$em, $source !== '' ? $source : null]);
    ok(['message' => 'Subscribed successfully']);
}

// DELETE — remove subscriber
if ($method === 'DELETE') {
    requireAdmin();
    $d  = body();
    $em = $d['email'] ?? '';
    if (!$em) fail('Email required');
    $pdo->prepare("DELETE FROM subscribers WHERE email = ?")->execute([$em]);
    ok(['message' => 'Unsubscribed']);
}

fail('Method not allowed', 405);
