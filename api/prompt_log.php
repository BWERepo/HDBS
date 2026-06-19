<?php
// api/prompt_log.php — Claude prompt history log
require_once __DIR__ . '/config.php';
cors();

$pdo = db();
requireAdmin();
$pdo->exec("CREATE TABLE IF NOT EXISTS prompt_log (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    category   VARCHAR(100) NOT NULL DEFAULT '',
    prompt     TEXT NOT NULL,
    notes      TEXT NOT NULL DEFAULT ''
)");

$method = $_SERVER['REQUEST_METHOD'];
$d      = body();
$action = $d['action'] ?? '';

// List all
if ($method === 'GET') {
    $rows = $pdo->query("SELECT * FROM prompt_log ORDER BY created_at DESC")->fetchAll(PDO::FETCH_ASSOC);
    ok(['prompts' => $rows]);
}

// Create
if ($method === 'POST' && $action === 'add_prompt') {
    $prompt   = trim($d['prompt'] ?? '');
    $category = trim($d['category'] ?? '');
    $notes    = trim($d['notes'] ?? '');
    if (!$prompt) fail('Prompt text required');
    $s = $pdo->prepare("INSERT INTO prompt_log (created_at, category, prompt, notes) VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'),?,?,?)");
    $s->execute([$category, $prompt, $notes]);
    ok(['id' => $pdo->lastInsertId(), 'message' => 'Prompt saved']);
}

// Update
if ($method === 'POST' && $action === 'update_prompt') {
    $id       = (int)($d['id'] ?? 0);
    $prompt   = trim($d['prompt'] ?? '');
    $category = trim($d['category'] ?? '');
    $notes    = trim($d['notes'] ?? '');
    if (!$id) fail('Missing id');
    if (!$prompt) fail('Prompt text required');
    $s = $pdo->prepare("UPDATE prompt_log SET category=?, prompt=?, notes=? WHERE id=?");
    $s->execute([$category, $prompt, $notes, $id]);
    ok(['message' => 'Updated']);
}

// Delete
if ($method === 'POST' && $action === 'delete_prompt') {
    $id = (int)($d['id'] ?? 0);
    if (!$id) fail('Missing id');
    $pdo->prepare("DELETE FROM prompt_log WHERE id=?")->execute([$id]);
    ok(['message' => 'Deleted']);
}
