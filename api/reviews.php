<?php
// api/reviews.php — Customer reviews: submit, list approved, admin manage

require_once __DIR__ . '/config.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
$pdo    = db();
$d      = body();

// Ensure table exists
$pdo->exec("CREATE TABLE IF NOT EXISTS reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    product_name VARCHAR(255),
    rating INT DEFAULT 5,
    review_text TEXT NOT NULL,
    status ENUM('pending','approved') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

// GET — return approved reviews (or all for admin)
if ($method === 'GET') {
    $admin = isset($_GET['admin']) && $_GET['admin'] === '1';
    if ($admin) {
        $rows = $pdo->query("SELECT * FROM reviews ORDER BY created_at DESC")->fetchAll();
    } else {
        $rows = $pdo->query("SELECT * FROM reviews WHERE status='approved' ORDER BY created_at DESC")->fetchAll();
    }
    ok(['reviews' => array_map(function($r) {
        return [
            'id'            => (int)$r['id'],
            'customer_name' => $r['customer_name'],
            'product_name'  => $r['product_name'],
            'rating'        => (int)$r['rating'],
            'review_text'   => $r['review_text'],
            'status'        => $r['status'],
            'created_at'    => $r['created_at'],
        ];
    }, $rows)]);
}

// POST — submit a new review (pending)
if ($method === 'POST') {
    $name   = trim($d['customer_name'] ?? '');
    $prod   = trim($d['product_name']  ?? '');
    $rating = max(1, min(5, (int)($d['rating'] ?? 5)));
    $text   = trim($d['review_text']   ?? '');

    if (!$name || !$text) fail('Name and review text are required');
    if (strlen($text) < 10) fail('Review is too short');

    $stmt = $pdo->prepare("INSERT INTO reviews (customer_name, product_name, rating, review_text) VALUES (?,?,?,?)");
    $stmt->execute([$name, $prod, $rating, $text]);
    ok(['message' => 'Review submitted — thank you!']);
}

// PUT — approve a review (admin)
if ($method === 'PUT') {
    $id     = (int)($d['id'] ?? 0);
    $status = $d['status'] ?? 'approved';
    if (!$id) fail('Missing review id');
    $pdo->prepare("UPDATE reviews SET status=? WHERE id=?")->execute([$status, $id]);
    ok(['message' => 'Review updated']);
}

// DELETE — remove a review (admin)
if ($method === 'DELETE') {
    $id = (int)($d['id'] ?? 0);
    if (!$id) fail('Missing review id');
    $pdo->prepare("DELETE FROM reviews WHERE id=?")->execute([$id]);
    ok(['message' => 'Review deleted']);
}

fail('Method not allowed', 405);
