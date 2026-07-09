<?php
// api/orders.php — Save, get, update, delete orders

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
applog('orders', "$method ".($_GET['id']??$_GET['status']??''));
dbg('orders', "REQUEST method=$method id=".($_GET['id']??'').' status='.($_GET['status']??'').' body='.substr(file_get_contents('php://input'),0,200));
$pdo    = db();

// Idempotent schema: ensure payment_configuration + check_number columns exist
foreach ([
    'payment_configuration' => "ALTER TABLE orders ADD COLUMN payment_configuration VARCHAR(20) DEFAULT 'Online'",
    'check_number'          => "ALTER TABLE orders ADD COLUMN check_number VARCHAR(40) DEFAULT NULL",
    'refunded_amount'       => "ALTER TABLE orders ADD COLUMN refunded_amount DECIMAL(10,2) DEFAULT 0",
] as $col => $ddl) {
    if (empty($pdo->query("SHOW COLUMNS FROM orders LIKE '$col'")->fetchAll())) $pdo->exec($ddl);
}
// Widen tracking_number to fit multiple comma-separated tracking numbers
$trackCol = $pdo->query("SHOW COLUMNS FROM orders LIKE 'tracking_number'")->fetch();
if ($trackCol && preg_match('/varchar\((\d+)\)/i', $trackCol['Type'], $m) && (int)$m[1] < 500) {
    $pdo->exec("ALTER TABLE orders MODIFY COLUMN tracking_number VARCHAR(500) DEFAULT NULL");
}

// GET — return all orders with items
if ($method === 'GET') { requireAdmin(); dbg('orders','GET all orders');
    $orders = $pdo->query("SELECT * FROM orders ORDER BY created_at DESC")->fetchAll();
    $items  = $pdo->query("SELECT * FROM order_items")->fetchAll();

    // Group items by order_id
    $itemMap = [];
    foreach ($items as $item) {
        $itemMap[$item['order_id']][] = [
            'id'    => $item['product_id'],
            'name'  => $item['product_name'],
            'price' => (float)$item['price'],
            'q'     => (int)$item['quantity'],
        ];
    }

    $result = array_map(function($o) use ($itemMap) {
        return [
            'id'     => $o['id'],
            'date'   => $o['order_date'] ? date('n/j/Y', strtotime($o['order_date'])) : '',
            'time'   => $o['created_at'] ? (function() use ($o) {
                $dt = new DateTime($o['created_at'], new DateTimeZone('UTC'));
                $dt->setTimezone(new DateTimeZone('America/New_York'));
                return $dt->format('g:i A');
            })() : '',
            'cust'   => $o['customer_name'],
            'email'  => $o['customer_email'],
            'phone'  => $o['customer_phone'],
            'addr'   => $o['shipping_address'],
            'total'  => (float)$o['total'],
            'pay'    => $o['payment_method'],
            'order_type' => $o['order_type'] ?? 'Online',
            'payment_config' => $o['payment_configuration'] ?? 'Online',
            'check_number'   => $o['check_number'] ?? '',
            'fee'    => (float)($o['transaction_fee'] ?? 0),
            'status' => $o['status'],
            'refunded_amount' => (float)($o['refunded_amount'] ?? 0),
            'tax'        => (float)($o['tax_amount'] ?? 0),
            'swept_date' => $o['tax_swept_date'] ?? null,
            'carrier'    => $o['shipping_carrier'] ?? 'USPS',
            'tracking'   => $o['tracking_number'] ?? '',
            'confirm_sent'     => $o['confirm_sent_at'] ?? null,
            'square_payment_id' => $o['square_payment_id'] ?? null,
            'paypal_surcharge'  => (float)($o['paypal_surcharge'] ?? 0),
            'shipping_sent'=> $o['shipping_sent_at'] ?? null,
            'dispDate'   => $o['order_date'] ? date('n/j/Y', strtotime($o['order_date'])) : '',
            'items'      => isset($itemMap[$o['id']]) ? array_values(array_filter($itemMap[$o['id']], function($i){return $i['id']!=='_ship';})) : [],
            'shipping'   => (function() use ($o, $itemMap) {
                if (!isset($itemMap[$o['id']])) return 0;
                foreach ($itemMap[$o['id']] as $it) { if ($it['id']==='_ship') return (float)$it['price']; }
                return 0;
            })(),
            'subtotal'   => (function() use ($o, $itemMap) {
                if (!isset($itemMap[$o['id']])) return (float)$o['total'];
                $s=0; foreach ($itemMap[$o['id']] as $it) { if ($it['id']!=='_ship') $s+=(float)$it['price']*(int)$it['q']; }
                return $s;
            })(),
        ];
    }, $orders);

    ok(['orders' => $result]);
}

// POST — create new order (public; admin token allows any status, guests locked to Awaiting Payment)
if ($method === 'POST') { dbg('orders','POST new order body='.substr(file_get_contents('php://input'),0,300));
    $d = body();
    if (empty($d['id']) || empty($d['total'])) fail('Missing order id or total');
    $isAdmin = isAdminRequest();

    // Rate limit: 15 order creations per IP per hour (guests only — admins are trusted and
    // may be entering multiple in-person sales). Stock is decremented on creation, before any
    // payment, so an unthrottled endpoint here is an inventory-exhaustion DoS vector.
    if (!$isAdmin) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS customer_login_attempts (
            email_hash CHAR(32) PRIMARY KEY,
            attempts   INT NOT NULL DEFAULT 0,
            last_at    INT NOT NULL DEFAULT 0
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
        $ordHash = md5('order_ip_' . ($_SERVER['REMOTE_ADDR'] ?? ''));
        $now     = time();
        $ordRow  = $pdo->prepare("SELECT attempts, last_at FROM customer_login_attempts WHERE email_hash = ?");
        $ordRow->execute([$ordHash]);
        $ordRow  = $ordRow->fetch() ?: ['attempts' => 0, 'last_at' => 0];
        if ($ordRow['attempts'] >= 15 && ($now - $ordRow['last_at']) < 3600) {
            fail('Too many orders from this network. Please try again later.');
        }
        if ($ordRow['attempts'] >= 15) { $ordRow['attempts'] = 0; }
        $pdo->prepare("INSERT INTO customer_login_attempts (email_hash,attempts,last_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE attempts=?,last_at=?")
            ->execute([$ordHash, $ordRow['attempts'] + 1, $now, $ordRow['attempts'] + 1, $now]);
    }

    // Reclaim stock from stale unpaid orders (2h+) so repeated abandoned-order creation can't
    // permanently drain inventory — same restore-stock logic used for failed/canceled payments
    // in verify_payment.php and customers.php:cancel_order.
    try {
        $staleCutoff = date('Y-m-d H:i:s', time() - 7200);
        $stale = $pdo->prepare("SELECT id FROM orders WHERE status='Awaiting Payment' AND order_date < ?");
        $stale->execute([$staleCutoff]);
        foreach ($stale->fetchAll(PDO::FETCH_COLUMN) as $staleId) {
            $itemRows = $pdo->prepare("SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id != '_ship'");
            $itemRows->execute([$staleId]);
            $restoreStmt = $pdo->prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
            foreach ($itemRows->fetchAll(PDO::FETCH_ASSOC) as $it) {
                $restoreStmt->execute([(int)$it['quantity'], $it['product_id']]);
            }
            $pdo->prepare("UPDATE orders SET status='Cancelled' WHERE id = ? AND status='Awaiting Payment'")->execute([$staleId]);
        }
    } catch (Exception $e) {}
    // Storefront in-person cash/check sales are paid on the spot, so they keep their 'Paid' status
    // and get a confirmation emailed + logged. Keyed on the storefront 'source' marker (not on the
    // admin token) so it still works when an admin places a test order while logged into the panel.
    $isInPersonPaid = (($d['source'] ?? '') === 'storefront')
        && (($d['payment_config'] ?? '') === 'InPerson')
        && in_array($d['pay'] ?? '', ['Cash', 'Check'], true);
    if (!$isAdmin && !$isInPersonPaid) $d['status'] = 'Awaiting Payment'; // guests cannot set arbitrary status

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("
            INSERT INTO orders (id, customer_name, customer_email, customer_phone,
                shipping_address, total, tax_amount, transaction_fee, payment_method, status, order_date, order_type,
                payment_configuration, check_number)
            VALUES (:id, :name, :email, :phone, :addr, :total, :tax, :fee, :pay, :status, :date, :order_type,
                :payment_config, :check_number)
        ");
        $stmt->execute([
            ':id'    => $d['id'],
            ':name'  => $d['cust'] ?? '',
            ':email' => $d['email'] ?? '',
            ':phone' => $d['phone'] ?? '',
            ':addr'  => $d['addr'] ?? '',
            ':total' => (float)$d['total'],
            ':pay'   => $d['pay'] ?? 'Credit Card',
        ':order_type' => $d['order_type'] ?? 'Online',
        ':fee'        => (float)($d['fee'] ?? 0),
            ':status'=> $d['status'] ?? 'Awaiting Payment',
            ':date'  => $d['date'] ?? date('Y-m-d H:i:s'),
            ':tax'   => (float)($d['tax'] ?? 0),
            ':payment_config' => $d['payment_config'] ?? 'Online',
            ':check_number'   => $d['check_number'] ?? null,
        ]);
        // Store shipping as a note in order_items if provided
        $shipping = (float)($d['shipping'] ?? 0);
        if ($shipping > 0) {
            $iStmt2 = $pdo->prepare("INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES (?, '_ship', 'Shipping', ?, 1)");
            $iStmt2->execute([$d['id'], $shipping]);
        }

        // Insert line items. For guests, price/name are looked up from the real product
        // record and the client-supplied price is ignored entirely, so an order can't be
        // paid for below the actual catalog price. Admins are trusted and keep the ability
        // to override price per line (e.g. phone-order discounts via the Manual Order form),
        // same trust boundary already used for order status above.
        if (!empty($d['items'])) {
            $iStmt   = $pdo->prepare("
                INSERT INTO order_items (order_id, product_id, product_name, price, quantity)
                VALUES (?, ?, ?, ?, ?)
            ");
            $lookup  = $pdo->prepare("SELECT name, price FROM products WHERE id = ? LIMIT 1");
            $stStmt  = $pdo->prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?");
            foreach ($d['items'] as $item) {
                $pid = $item['id'] ?? '';
                if ($pid === '' || $pid === '_ship') continue;
                $qty = (int)($item['q'] ?? 1);
                $lookup->execute([$pid]);
                $prod = $lookup->fetch();
                if (!$prod) throw new Exception('Unknown product: ' . $pid);
                $name  = $prod['name'];
                $price = $isAdmin ? (float)($item['price'] ?? $prod['price']) : (float)$prod['price'];
                $iStmt->execute([$d['id'], $pid, $name, $price, $qty]);
                // Decrement stock atomically — WHERE stock >= qty prevents overselling
                $stStmt->execute([$qty, $pid, $qty]);
                if ($stStmt->rowCount() === 0) {
                    throw new Exception('Item is out of stock: ' . $name);
                }
            }
        }
        $pdo->commit();
        // In-person cash/check storefront orders are complete on submission — send + log the
        // customer confirmation server-side so it doesn't depend on the browser/cached JS.
        if ($isInPersonPaid) {
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $host   = $_SERVER['HTTP_HOST'] ?? 'handmadedesignsbysuzi.com';
            $ch = curl_init($scheme . '://' . $host . '/send_confirm.php');
            curl_setopt_array($ch, [
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => json_encode(['order_id' => $d['id']]),
                CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 20,
            ]);
            curl_exec($ch);
            curl_close($ch);
        }
        // Return a cancel token so only the order creator can cancel it
        $cancelToken = substr(hash_hmac('sha256', $d['id'], DB_PASS), 0, 24);
        ok(['message' => 'Order saved', 'cancel_token' => $cancelToken]);
    } catch (Exception $e) {
        $pdo->rollBack();
        fail('Failed to save order: ' . $e->getMessage(), 500);
    }
}

// PUT — update order fields (dynamic)
if ($method === 'PUT') { requireAdmin(); dbg('orders','PUT update id='.($_GET['id']??'?'));
    $d = body();
    if (empty($d['id'])) fail('Missing id');
    if (array_key_exists('swept_date', $d)) {
        $sd = !empty($d['swept_date']) ? $d['swept_date'] : null;
        $pdo->prepare("UPDATE orders SET tax_swept_date = ? WHERE id = ?")->execute([$sd, $d['id']]);
    }
    $sets = []; $vals = [];
    if (isset($d['status']))   { $sets[] = 'status = ?';            $vals[] = $d['status']; }
    if (isset($d['pay']))      { $sets[] = 'payment_method = ?';    $vals[] = $d['pay']; }
    if (isset($d['order_type'])) { $sets[] = 'order_type = ?';       $vals[] = $d['order_type']; }
    if (isset($d['payment_config'])) { $sets[] = 'payment_configuration = ?'; $vals[] = $d['payment_config']; }
    if (isset($d['check_number']))   { $sets[] = 'check_number = ?';          $vals[] = $d['check_number']; }
    if (isset($d['fee']))        { $sets[] = 'transaction_fee = ?';  $vals[] = (float)$d['fee']; }
    if (isset($d['cust']))     { $sets[] = 'customer_name = ?';     $vals[] = $d['cust']; }
    if (isset($d['email']))    { $sets[] = 'customer_email = ?';    $vals[] = $d['email']; }
    if (isset($d['phone']))    { $sets[] = 'customer_phone = ?';    $vals[] = $d['phone']; }
    if (isset($d['addr']))     { $sets[] = 'shipping_address = ?';  $vals[] = $d['addr']; }
    if (isset($d['total']))    { $sets[] = 'total = ?';             $vals[] = (float)$d['total']; }
    if (isset($d['tax']))      { $sets[] = 'tax_amount = ?';        $vals[] = (float)$d['tax']; }
    if (isset($d['carrier']))  { $sets[] = 'shipping_carrier = ?';  $vals[] = $d['carrier']; }
    if (isset($d['tracking'])) { $sets[] = 'tracking_number = ?';   $vals[] = $d['tracking']; }
    if (!empty($sets)) {
        $vals[] = $d['id'];
        $pdo->prepare('UPDATE orders SET '.implode(', ',$sets).' WHERE id = ?')->execute($vals);
    }
    ok(['message' => 'Order updated']);
}

// DELETE — delete one or all orders
if ($method === 'DELETE') { requireAdmin(); dbg('orders','DELETE id='.($_GET['id']??'?'));
    $d = body();
    if (!empty($d['delete_all'])) {
        $pdo->exec("DELETE FROM order_items");
        $pdo->exec("DELETE FROM orders");
        ok(['message' => 'All orders deleted']);
    } elseif (!empty($d['id'])) {
        $stmt = $pdo->prepare("DELETE FROM orders WHERE id = ?");
        $stmt->execute([$d['id']]);
        ok(['message' => 'Order deleted']);
    } else {
        fail('Missing id or delete_all flag');
    }
}

fail('Method not allowed', 405);
