<?php
// api/faqs.php — FAQ management

require_once __DIR__ . '/config.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
$pdo    = db();
$d      = body();

// Ensure table exists
$pdo->exec("CREATE TABLE IF NOT EXISTS faqs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

// GET — return all FAQs ordered
if ($method === 'GET') {
    $rows = $pdo->query("SELECT * FROM faqs ORDER BY sort_order ASC, id ASC")->fetchAll();
    ok(['faqs' => array_map(function($r) {
        return [
            'id'         => (int)$r['id'],
            'question'   => $r['question'],
            'answer'     => $r['answer'],
            'sort_order' => (int)$r['sort_order'],
        ];
    }, $rows)]);
}

// POST — add new FAQ or reorder
if ($method === 'POST') {
    if (isset($d['action']) && $d['action'] === 'reorder') {
        $ids = $d['order'] ?? [];
        $stmt = $pdo->prepare("UPDATE faqs SET sort_order=? WHERE id=?");
        foreach ($ids as $i => $id) {
            $stmt->execute([$i, (int)$id]);
        }
        ok(['message' => 'Order saved']);
    }
    $q = trim($d['question'] ?? '');
    $a = trim($d['answer']   ?? '');
    if (!$q || !$a) fail('Question and answer are required');
    $sort = (int)($d['sort_order'] ?? 0);
    $pdo->prepare("INSERT INTO faqs (question, answer, sort_order) VALUES (?,?,?)")->execute([$q, $a, $sort]);
    ok(['message' => 'FAQ added']);
}

// PUT — update existing FAQ
if ($method === 'PUT') {
    $id = (int)($d['id'] ?? 0);
    $q  = trim($d['question'] ?? '');
    $a  = trim($d['answer']   ?? '');
    if (!$id || !$q || !$a) fail('Missing fields');
    $pdo->prepare("UPDATE faqs SET question=?, answer=? WHERE id=?")->execute([$q, $a, $id]);
    ok(['message' => 'FAQ updated']);
}

// DELETE — remove FAQ
if ($method === 'DELETE') {
    $id = (int)($d['id'] ?? 0);
    if (!$id) fail('Missing id');
    $pdo->prepare("DELETE FROM faqs WHERE id=?")->execute([$id]);
    ok(['message' => 'FAQ deleted']);
}

fail('Method not allowed', 405);
