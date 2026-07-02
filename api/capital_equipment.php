<?php
// api/capital_equipment.php — Business capital equipment ledger (date purchased, price,
// description, plus an optional receipt image/PDF stored outside the webroot)

require_once __DIR__ . '/config.php';
cors();
$pdo = db();
requireAdmin();

$pdo->exec("CREATE TABLE IF NOT EXISTS capital_equipment (
    id INT AUTO_INCREMENT PRIMARY KEY,
    description TEXT NOT NULL,
    purchase_date DATE NOT NULL,
    purchase_price DECIMAL(10,2) NOT NULL,
    receipt_filename VARCHAR(255) DEFAULT NULL,
    receipt_orig_name VARCHAR(255) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
foreach (['receipt_filename' => "VARCHAR(255) DEFAULT NULL", 'receipt_orig_name' => "VARCHAR(255) DEFAULT NULL"] as $col => $def) {
    if (empty($pdo->query("SHOW COLUMNS FROM capital_equipment LIKE '$col'")->fetchAll())) {
        $pdo->exec("ALTER TABLE capital_equipment ADD COLUMN `$col` $def");
    }
}

// Receipts are sensitive purchase records, so — like business_docs.php — they're stored
// outside the webroot and only ever served back through this admin-gated endpoint.
$storeDir = dirname(dirname(__DIR__)) . '/capital_equipment_receipts/';
if (!is_dir($storeDir)) mkdir($storeDir, 0755, true);

$method = $_SERVER['REQUEST_METHOD'];
$d      = body();
$action = $d['action'] ?? '';

// POST action: upload/replace the receipt for an item
if ($method === 'POST' && $action === 'upload_receipt') {
    $id = (int)($d['id'] ?? 0);
    if (!$id) fail('Missing id');
    $data = $d['data'] ?? '';
    if (!preg_match('/^data:([\w\/+.-]+);base64,(.+)$/s', $data, $m)) fail('Invalid file data', 400);
    $bytes = base64_decode($m[2], true);
    if (!$bytes) fail('Could not decode file', 400);
    if (strlen($bytes) > 5 * 1024 * 1024) fail('File too large (max 5MB)', 400);

    // Validate by magic bytes, not the client-reported mime type
    $magic4 = substr($bytes, 0, 4);
    $isPdf  = (substr($bytes, 0, 4) === '%PDF');
    $isJpeg = (substr($magic4, 0, 2) === "\xFF\xD8");
    $isPng  = ($magic4 === "\x89PNG");
    if (!$isPdf && !$isJpeg && !$isPng) fail('Only PDF, JPG, or PNG files are accepted', 400);
    $ext = $isPdf ? 'pdf' : ($isPng ? 'png' : 'jpg');

    $stmt = $pdo->prepare("SELECT receipt_filename FROM capital_equipment WHERE id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) fail('Item not found', 404);
    if (!empty($row['receipt_filename'])) {
        $old = $storeDir . $row['receipt_filename'];
        if (is_file($old)) @unlink($old);
    }

    $filename = 'receipt_' . $id . '_' . time() . '.' . $ext;
    file_put_contents($storeDir . $filename, $bytes);
    $origName = trim($d['filename'] ?? 'receipt');
    $pdo->prepare("UPDATE capital_equipment SET receipt_filename=?, receipt_orig_name=? WHERE id=?")
        ->execute([$filename, $origName, $id]);
    ok(['message' => 'Receipt uploaded']);
}

// POST action: stream the receipt file back
if ($method === 'POST' && $action === 'download_receipt') {
    $id = (int)($d['id'] ?? 0);
    if (!$id) fail('Missing id');
    $stmt = $pdo->prepare("SELECT receipt_filename, receipt_orig_name FROM capital_equipment WHERE id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row || empty($row['receipt_filename'])) fail('No receipt on file', 404);
    $path = $storeDir . $row['receipt_filename'];
    if (!is_file($path)) fail('File not found', 404);
    $ext  = strtolower(pathinfo($row['receipt_filename'], PATHINFO_EXTENSION));
    $mime = $ext === 'pdf' ? 'application/pdf' : ($ext === 'png' ? 'image/png' : 'image/jpeg');
    header('Content-Type: ' . $mime);
    header('Content-Disposition: attachment; filename="' . basename($row['receipt_orig_name'] ?: $row['receipt_filename']) . '"');
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit();
}

// POST action: remove the receipt from an item (item itself stays)
if ($method === 'POST' && $action === 'delete_receipt') {
    $id = (int)($d['id'] ?? 0);
    if (!$id) fail('Missing id');
    $stmt = $pdo->prepare("SELECT receipt_filename FROM capital_equipment WHERE id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if ($row && !empty($row['receipt_filename'])) {
        $path = $storeDir . $row['receipt_filename'];
        if (is_file($path)) @unlink($path);
    }
    $pdo->prepare("UPDATE capital_equipment SET receipt_filename=NULL, receipt_orig_name=NULL WHERE id=?")->execute([$id]);
    ok(['message' => 'Receipt removed']);
}

// GET — list all items, most recently purchased first
if ($method === 'GET') {
    $rows = $pdo->query("SELECT * FROM capital_equipment ORDER BY purchase_date DESC, id DESC")->fetchAll();
    ok(['items' => array_map(function($r) {
        return [
            'id'                => (int)$r['id'],
            'description'       => $r['description'],
            'purchase_date'     => $r['purchase_date'],
            'purchase_price'    => (float)$r['purchase_price'],
            'has_receipt'       => !empty($r['receipt_filename']),
            'receipt_orig_name' => $r['receipt_orig_name'] ?? '',
        ];
    }, $rows)]);
}

// POST — add new item
if ($method === 'POST') {
    $desc  = trim($d['description'] ?? '');
    $date  = trim($d['purchase_date'] ?? '');
    $price = (float)($d['purchase_price'] ?? 0);
    if (!$desc || !$date || $price <= 0) fail('Description, purchase date, and a price greater than zero are required');
    $pdo->prepare("INSERT INTO capital_equipment (description, purchase_date, purchase_price) VALUES (?,?,?)")
        ->execute([$desc, $date, $price]);
    ok(['message' => 'Item added', 'id' => (int)$pdo->lastInsertId()]);
}

// PUT — update existing item
if ($method === 'PUT') {
    $id    = (int)($d['id'] ?? 0);
    $desc  = trim($d['description'] ?? '');
    $date  = trim($d['purchase_date'] ?? '');
    $price = (float)($d['purchase_price'] ?? 0);
    if (!$id || !$desc || !$date || $price <= 0) fail('Missing fields');
    $pdo->prepare("UPDATE capital_equipment SET description=?, purchase_date=?, purchase_price=? WHERE id=?")
        ->execute([$desc, $date, $price, $id]);
    ok(['message' => 'Item updated']);
}

// DELETE — remove item (and its receipt file, if any)
if ($method === 'DELETE') {
    $id = (int)($d['id'] ?? 0);
    if (!$id) fail('Missing id');
    $stmt = $pdo->prepare("SELECT receipt_filename FROM capital_equipment WHERE id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if ($row && !empty($row['receipt_filename'])) {
        $path = $storeDir . $row['receipt_filename'];
        if (is_file($path)) @unlink($path);
    }
    $pdo->prepare("DELETE FROM capital_equipment WHERE id=?")->execute([$id]);
    ok(['message' => 'Item deleted']);
}

fail('Method not allowed', 405);
