<?php
// api/products.php — Get, save, delete products

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
applog('products', "$method");
dbg('products', "REQUEST method=$method id=".($_GET['id']??'').' body='.substr(file_get_contents('php://input'),0,200));
$pdo    = db();

// GET — return all products (public)
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
            'ship_mode'  => $r['ship_mode'] ?? 'weight',
            'ship_fixed' => (float)($r['ship_fixed'] ?? 0),
            'coming_soon' => (int)($r['coming_soon'] ?? 0),
            'cogm'   => (float)($r['cogm'] ?? 0),
            'launch_date' => $r['launch_date'] ?? '2026-07-01',
        ];
    }, $rows);
    ok(['products' => $products]);
}

// POST — create or update product
if ($method === 'POST') { requireAdmin(); dbg('products','POST save product');
    $d = body();
    if (empty($d['id']) || empty($d['name'])) fail('Missing id or name');
    // Product id is used to build image filenames on disk — restrict to a safe charset (no path traversal)
    if (!preg_match('/^[A-Za-z0-9_-]+$/', $d['id'])) fail('Invalid product id', 400);

    ensureProductColumns($pdo);

    $stmt = $pdo->prepare("
        INSERT INTO products (id, sku, name, description, price, stock, category, badge, weight, size, img1, img2, img3, sell, ship_mode, ship_fixed, coming_soon, cogm, launch_date)
        VALUES (:id, :sku, :name, :desc, :price, :stock, :cat, :badge, :weight, :size, :img1, :img2, :img3, :sell, :ship_mode, :ship_fixed, :coming_soon, :cogm, :launch_date)
        ON DUPLICATE KEY UPDATE
            sku=:sku, name=:name, description=:desc, price=:price, stock=:stock,
            category=:cat, badge=:badge, weight=:weight, size=:size, img1=:img1, img2=:img2, img3=:img3, sell=:sell,
            ship_mode=:ship_mode, ship_fixed=:ship_fixed, coming_soon=:coming_soon, cogm=:cogm, launch_date=:launch_date
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
            // Cap raw base64 at ~4MB decoded
            if (strlen($m[2]) > 4 * 1024 * 1024 * 4 / 3) fail('Image too large (max 4MB)', 400);
            $bytes = base64_decode($m[2], true);
            if (!$bytes) { $saved_imgs[] = ''; continue; }
            // Validate magic bytes: JPEG = FF D8, PNG = 89 50 4E 47
            $magic = substr($bytes, 0, 4);
            $isJpeg = (substr($magic, 0, 2) === "\xFF\xD8");
            $isPng  = ($magic === "\x89PNG");
            if (!$isJpeg && !$isPng) fail('Invalid image format — only JPEG and PNG are accepted', 400);
            $ext      = $isPng ? 'png' : 'jpg';
            $filename = 'prod_' . $prod_id . '_' . $col . '.' . $ext;
            file_put_contents($upload_dir . $filename, $bytes);
            $saved_imgs[] = $upload_url . $filename;
        } else { $saved_imgs[] = ''; }
    }

    $price = (float)($d['price'] ?? 0);
    $default_cogm = $price * 0.5;
    $stmt->execute([
        ':id'     => $prod_id,
        ':sku'    => $d['sku'] ?? '',
        ':name'   => $d['name'],
        ':desc'   => $d['desc'] ?? '',
        ':price'  => $price,
        ':stock'  => (int)($d['stock'] ?? 0),
        ':cat'    => $d['cat'] ?? '',
        ':badge'  => $d['badge'] ?? '',
        ':weight' => (float)($d['weight'] ?? 0),
        ':size'   => $d['size'] ?? '',
        ':sell'   => isset($d['sell']) ? (int)$d['sell'] : 1,
        ':img1'   => $saved_imgs[0],
        ':img2'   => $saved_imgs[1],
        ':img3'   => $saved_imgs[2],
        ':ship_mode'  => (($d['ship_mode'] ?? 'weight') === 'fixed') ? 'fixed' : 'weight',
        ':ship_fixed' => (float)($d['ship_fixed'] ?? 0),
        ':coming_soon' => !empty($d['coming_soon']) ? 1 : 0,
        ':cogm' => isset($d['cogm']) ? (float)$d['cogm'] : $default_cogm,
        ':launch_date' => $d['launch_date'] ?? '2026-07-01',
    ]);
    ok(['message' => 'Product saved']);
}

// DELETE — remove product
if ($method === 'DELETE') { requireAdmin(); dbg('products','DELETE product id='.($_GET['id']??'?'));
    $d = body();
    if (empty($d['id'])) fail('Missing id');
    $stmt = $pdo->prepare("DELETE FROM products WHERE id = ?");
    $stmt->execute([$d['id']]);
    ok(['message' => 'Product deleted']);
}

fail('Method not allowed', 405);
