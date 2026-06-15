<?php
// api/products.php — Get, save, delete products

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
applog('products', "$method");
dbg('products', "REQUEST method=$method id=".($_GET['id']??'').' body='.substr(file_get_contents('php://input'),0,200));
$pdo    = db();

// GET — return all products
if ($method === 'GET') { dbg('products','GET all products');
    $rows = $pdo->query("SELECT * FROM products ORDER BY created_at ASC")->fetchAll();
    $products = array_map(function($r) {
        return [
            'id'     => $r['id'],
            'name'   => $r['name'],
            'desc'   => $r['description'],
            'price'  => (float)$r['price'],
            'stock'  => (int)$r['stock'],
            'cat'    => $r['category'],
            'badge'  => $r['badge'],
            'weight' => (float)($r['weight'] ?? 0),
            'size'   => $r['size'] ?? '',
            'sell'   => (int)($r['sell'] ?? 1),
            // Return full images only - browser caches aggressively
            'imgs'   => [$r['img1'] ?? '', $r['img2'] ?? '', $r['img3'] ?? ''],
            'hasImg' => !empty($r['img1']),
            'sku'    => $r['sku'] ?? '',
        ];
    }, $rows);
    ok(['products' => $products]);
}

// POST — create or update product
if ($method === 'POST') { dbg('products','POST save product');
    $d = body();
    if (empty($d['id']) || empty($d['name'])) fail('Missing id or name');

    $stmt = $pdo->prepare("
        INSERT INTO products (id, sku, name, description, price, stock, category, badge, weight, size, img1, img2, img3, sell)
        VALUES (:id, :sku, :name, :desc, :price, :stock, :cat, :badge, :weight, :size, :img1, :img2, :img3, :sell)
        ON DUPLICATE KEY UPDATE
            sku=:sku, name=:name, description=:desc, price=:price, stock=:stock,
            category=:cat, badge=:badge, weight=:weight, size=:size, img1=:img1, img2=:img2, img3=:img3, sell=:sell
    ");
    $imgs = $d['imgs'] ?? ['', '', ''];
    $prod_id = $d['id'];
    $upload_dir = dirname(__DIR__) . '/product_images/';
    $upload_url = 'https://handmadedesignsbysuzi.com/product_images/';
    if (!is_dir($upload_dir)) mkdir($upload_dir, 0755, true);

    $saved_imgs = [];
    foreach (['img1','img2','img3'] as $i => $col) {
        $val = $imgs[$i] ?? '';
        if (empty($val)) { $saved_imgs[] = ''; continue; }
        // Already a URL — keep as-is
        if (strpos($val, 'data:image') === false) { $saved_imgs[] = $val; continue; }
        // Save base64 as file
        if (preg_match('/^data:image\/(\w+);base64,(.+)$/s', $val, $m)) {
            $ext      = strtolower($m[1]) === 'png' ? 'png' : 'jpg';
            $filename = 'prod_' . $prod_id . '_' . $col . '.' . $ext;
            $bytes    = base64_decode($m[2]);
            if ($bytes) file_put_contents($upload_dir . $filename, $bytes);
            $saved_imgs[] = $upload_url . $filename;
        } else { $saved_imgs[] = ''; }
    }

    $stmt->execute([
        ':id'     => $prod_id,
        ':sku'    => $d['sku'] ?? '',
        ':name'   => $d['name'],
        ':desc'   => $d['desc'] ?? '',
        ':price'  => (float)($d['price'] ?? 0),
        ':stock'  => (int)($d['stock'] ?? 0),
        ':cat'    => $d['cat'] ?? '',
        ':badge'  => $d['badge'] ?? '',
        ':weight' => (float)($d['weight'] ?? 0),
        ':size'   => $d['size'] ?? '',
        ':sell'   => isset($d['sell']) ? (int)$d['sell'] : 1,
        ':img1'   => $saved_imgs[0],
        ':img2'   => $saved_imgs[1],
        ':img3'   => $saved_imgs[2],
    ]);
    ok(['message' => 'Product saved']);
}

// DELETE — remove product
if ($method === 'DELETE') { dbg('products','DELETE product id='.($_GET['id']??'?'));
    $d = body();
    if (empty($d['id'])) fail('Missing id');
    $stmt = $pdo->prepare("DELETE FROM products WHERE id = ?");
    $stmt->execute([$d['id']]);
    ok(['message' => 'Product deleted']);
}

fail('Method not allowed', 405);
