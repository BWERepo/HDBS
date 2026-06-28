<?php
// products_csv.php — Export/import products as CSV
require_once __DIR__ . '/config.php';
cors();
$pdo = db();
requireAdmin();
// Ensure per-item shipping + coming-soon columns exist
foreach (['ship_mode' => "VARCHAR(10) NOT NULL DEFAULT 'weight'", 'ship_fixed' => "DECIMAL(10,2) NOT NULL DEFAULT 0", 'coming_soon' => "TINYINT NOT NULL DEFAULT 0"] as $col => $def) {
    if (empty($pdo->query("SHOW COLUMNS FROM products LIKE '$col'")->fetchAll())) $pdo->exec("ALTER TABLE products ADD COLUMN `$col` $def");
}
$method = $_SERVER['REQUEST_METHOD'];

// ── EXPORT (GET) ──
if ($method === 'GET') {
    $rows = $pdo->query("SELECT id, sku, name, description, price, stock, category, badge, weight, size, sell, img1, img2, img3, ship_mode, ship_fixed, coming_soon FROM products ORDER BY category, name")->fetchAll(PDO::FETCH_ASSOC);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="products_' . date('Y-m-d') . '.csv"');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['id','sku','name','description','price','stock','category','badge','weight','size','sell','img1','img2','img3','ship_mode','ship_fixed','coming_soon']);
    foreach ($rows as $r) fputcsv($out, $r);
    fclose($out);
    exit;
}

// ── IMPORT (POST) ──
if ($method === 'POST') {
    header('Content-Type: application/json');
    $mode = $_POST['mode'] ?? 'merge'; // 'merge' or 'replace'

    if (empty($_FILES['csv']['tmp_name'])) {
        echo json_encode(['success'=>false,'error'=>'No file uploaded']); exit;
    }
    $tmp = $_FILES['csv']['tmp_name'];
    $handle = fopen($tmp, 'r');
    if (!$handle) { echo json_encode(['success'=>false,'error'=>'Cannot read file']); exit; }

    $headers = fgetcsv($handle);
    if (!$headers) { echo json_encode(['success'=>false,'error'=>'Empty CSV']); exit; }
    $headers = array_map('trim', $headers);

    // Required columns
    $required = ['id','name','price','stock','category'];
    foreach ($required as $req) {
        if (!in_array($req, $headers)) {
            echo json_encode(['success'=>false,'error'=>"Missing required column: $req"]); exit;
        }
    }

    $rows = [];
    while (($row = fgetcsv($handle)) !== false) {
        if (count($row) !== count($headers)) continue;
        $rows[] = array_combine($headers, $row);
    }
    fclose($handle);

    if (empty($rows)) { echo json_encode(['success'=>false,'error'=>'No data rows found']); exit; }

    try {
        $pdo->beginTransaction();

        if ($mode === 'replace') {
            $pdo->exec("DELETE FROM products");
        }

        $stmt = $pdo->prepare("
            INSERT INTO products (id, sku, name, description, price, stock, category, badge, weight, size, sell, img1, img2, img3, ship_mode, ship_fixed, coming_soon)
            VALUES (:id, :sku, :name, :desc, :price, :stock, :cat, :badge, :weight, :size, :sell, :img1, :img2, :img3, :ship_mode, :ship_fixed, :coming_soon)
            ON DUPLICATE KEY UPDATE
                sku=:sku, name=:name, description=:desc, price=:price, stock=:stock,
                category=:cat, badge=:badge, weight=:weight, size=:size, sell=:sell,
                img1=:img1, img2=:img2, img3=:img3, ship_mode=:ship_mode, ship_fixed=:ship_fixed, coming_soon=:coming_soon
        ");

        $count = 0;
        foreach ($rows as $r) {
            $stmt->execute([
                ':id'     => trim($r['id']),
                ':sku'    => trim($r['sku'] ?? ''),
                ':name'   => trim($r['name']),
                ':desc'   => trim($r['description'] ?? ''),
                ':price'  => (float)($r['price'] ?? 0),
                ':stock'  => (int)($r['stock'] ?? 0),
                ':cat'    => trim($r['category'] ?? ''),
                ':badge'  => trim($r['badge'] ?? ''),
                ':weight' => (float)($r['weight'] ?? 0),
                ':size'   => trim($r['size'] ?? ''),
                ':sell'   => (int)($r['sell'] ?? 1),
                ':img1'   => trim($r['img1'] ?? ''),
                ':img2'   => trim($r['img2'] ?? ''),
                ':img3'   => trim($r['img3'] ?? ''),
                ':ship_mode'  => (trim($r['ship_mode'] ?? 'weight') === 'fixed') ? 'fixed' : 'weight',
                ':ship_fixed' => (float)($r['ship_fixed'] ?? 0),
                ':coming_soon' => !empty($r['coming_soon']) && trim($r['coming_soon']) !== '0' ? 1 : 0,
            ]);
            $count++;
        }

        $pdo->commit();
        echo json_encode(['success'=>true,'imported'=>$count,'mode'=>$mode]);
    } catch (Exception $e) {
        $pdo->rollBack();
        echo json_encode(['success'=>false,'error'=>$e->getMessage()]);
    }
    exit;
}

http_response_code(405);
echo json_encode(['success'=>false,'error'=>'Method not allowed']);
