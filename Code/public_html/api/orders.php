<?php
// api/orders.php — Save, get, update, delete orders

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
applog('orders', "$method ".($_GET['id']??$_GET['status']??''));
dbg('orders', "REQUEST method=$method id=".($_GET['id']??'').' status='.($_GET['status']??'').' body='.substr(file_get_contents('php://input'),0,200));
$pdo    = db();

// GET — return all orders with items
if ($method === 'GET') { dbg('orders','GET all orders');
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
            'fee'    => (float)($o['transaction_fee'] ?? 0),
            'status' => $o['status'],
            'tax'        => (float)($o['tax_amount'] ?? 0),
            'swept_date' => $o['tax_swept_date'] ?? null,
            'carrier'    => $o['shipping_carrier'] ?? 'USPS',
            'tracking'   => $o['tracking_number'] ?? '',
            'confirm_sent'     => $o['confirm_sent_at'] ?? null,
            'square_payment_id' => $o['square_payment_id'] ?? null,
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

// POST — create new order
if ($method === 'POST') { dbg('orders','POST new order body='.substr(file_get_contents('php://input'),0,300));
    $d = body();
    if (empty($d['id']) || empty($d['total'])) fail('Missing order id or total');

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("
            INSERT INTO orders (id, customer_name, customer_email, customer_phone,
                shipping_address, total, tax_amount, transaction_fee, payment_method, status, order_date, order_type)
            VALUES (:id, :name, :email, :phone, :addr, :total, :tax, :fee, :pay, :status, :date, :order_type)
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
        ]);
        // Store shipping as a note in order_items if provided
        $shipping = (float)($d['shipping'] ?? 0);
        if ($shipping > 0) {
            $iStmt2 = $pdo->prepare("INSERT INTO order_items (order_id, product_id, product_name, price, quantity) VALUES (?, '_ship', 'Shipping', ?, 1)");
            $iStmt2->execute([$d['id'], $shipping]);
        }

        // Insert line items
        if (!empty($d['items'])) {
            $iStmt = $pdo->prepare("
                INSERT INTO order_items (order_id, product_id, product_name, price, quantity)
                VALUES (?, ?, ?, ?, ?)
            ");
            foreach ($d['items'] as $item) {
                $iStmt->execute([$d['id'], $item['id'] ?? '', $item['name'] ?? '', (float)($item['price'] ?? 0), (int)($item['q'] ?? 1)]);
            }
        }

        // Decrement stock for each product ordered
        if (!empty($d['items'])) {
            $stStmt = $pdo->prepare("UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ? AND id != '_ship'");
            foreach ($d['items'] as $item) {
                if (!empty($item['id']) && $item['id'] !== '_ship') {
                    $stStmt->execute([(int)($item['q'] ?? 1), $item['id']]);
                }
            }
        }
        $pdo->commit();
        ok(['message' => 'Order saved']);
    } catch (Exception $e) {
        $pdo->rollBack();
        fail('Failed to save order: ' . $e->getMessage(), 500);
    }
}

// PUT — update order fields (dynamic)
if ($method === 'PUT') { dbg('orders','PUT update id='.($_GET['id']??'?'));
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
if ($method === 'DELETE') { dbg('orders','DELETE id='.($_GET['id']??'?'));
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
