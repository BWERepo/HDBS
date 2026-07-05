<?php
// api/customers.php — Register, login, get customers, password reset

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/order_token.php';  // issues the order-view token on login/register
cors();

$method = $_SERVER['REQUEST_METHOD'];
$pdo    = db();
$d      = body();
$action = $d['action'] ?? $_GET['action'] ?? '';

// GET — list all customers (admin)
if ($method === 'GET' && $action === 'list') {
    requireAdmin();
    $rows = $pdo->query("SELECT id, first_name, last_name, email, phone, order_count, joined_at FROM customers ORDER BY joined_at DESC")->fetchAll();
    $custs = array_map(function($r) {
        return [
            'id'     => $r['id'],
            'fn'     => $r['first_name'],
            'ln'     => $r['last_name'],
            'name'   => trim($r['first_name'] . ' ' . $r['last_name']),
            'em'     => $r['email'],
            'ph'     => $r['phone'],
            'orders' => (int)$r['order_count'],
            'joined' => date('n/j/Y', strtotime($r['joined_at'])),
        ];
    }, $rows);
    ok(['customers' => $custs]);
}

// POST — register
if ($method === 'POST' && $action === 'register') {
    if (empty($d['em']) || empty($d['pw'])) fail('Email and password required');
    if (strlen($d['pw']) < 6) fail('Password must be at least 6 characters');

    // Check duplicate
    $check = $pdo->prepare("SELECT id FROM customers WHERE email = ?");
    $check->execute([$d['em']]);
    if ($check->fetch()) fail('Email already registered');

    $id   = 'C' . time() . rand(100, 999);
    $hash = password_hash($d['pw'], PASSWORD_DEFAULT);
    $stmt = $pdo->prepare("
        INSERT INTO customers (id, first_name, last_name, email, password_hash, phone, sec_question, sec_answer)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([
        $id,
        $d['fn'] ?? '',
        $d['ln'] ?? '',
        $d['em'],
        $hash,
        $d['ph'] ?? '',
        $d['secQ'] ?? '',
        strtolower(trim($d['secA'] ?? '')),
    ]);

    ok(['id' => $id, 'name' => trim(($d['fn'] ?? '') . ' ' . ($d['ln'] ?? '')), 'em' => $d['em'],
        'orders_token' => makeOrderToken($d['em'], 86400)]);
}

// POST — login
if ($method === 'POST' && $action === 'login') {
    if (empty($d['em']) || empty($d['pw'])) fail('Email and password required');

    // Rate limit: 10 attempts per email, 15-minute lockout
    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_login_attempts (
        email_hash CHAR(32) PRIMARY KEY,
        attempts   INT NOT NULL DEFAULT 0,
        last_at    INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $eHash = md5(strtolower(trim($d['em'])));
    $now   = time();
    $aRow  = $pdo->prepare("SELECT attempts, last_at FROM customer_login_attempts WHERE email_hash = ?");
    $aRow->execute([$eHash]);
    $aRow  = $aRow->fetch() ?: ['attempts' => 0, 'last_at' => 0];
    if ($aRow['attempts'] >= 10 && ($now - $aRow['last_at']) < 900) {
        $mins = (int)ceil((900 - ($now - $aRow['last_at'])) / 60);
        fail("Too many failed attempts. Try again in {$mins} minute" . ($mins === 1 ? '' : 's') . '.');
    }
    if ($aRow['attempts'] >= 10) {
        $pdo->prepare("INSERT INTO customer_login_attempts (email_hash,attempts,last_at) VALUES (?,0,0) ON DUPLICATE KEY UPDATE attempts=0,last_at=0")->execute([$eHash]);
        $aRow = ['attempts' => 0, 'last_at' => 0];
    }

    $stmt = $pdo->prepare("SELECT * FROM customers WHERE email = ?");
    $stmt->execute([$d['em']]);
    $cust = $stmt->fetch();

    if (!$cust || !password_verify($d['pw'], $cust['password_hash'])) {
        $newAttempts = $aRow['attempts'] + 1;
        $pdo->prepare("INSERT INTO customer_login_attempts (email_hash,attempts,last_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE attempts=?,last_at=?")->execute([$eHash,$newAttempts,$now,$newAttempts,$now]);
        fail('Incorrect email or password');
    }
    // Success — clear attempts
    $pdo->prepare("INSERT INTO customer_login_attempts (email_hash,attempts,last_at) VALUES (?,0,0) ON DUPLICATE KEY UPDATE attempts=0,last_at=0")->execute([$eHash]);

    ok([
        'id'     => $cust['id'],
        'fn'     => $cust['first_name'],
        'ln'     => $cust['last_name'],
        'name'   => trim($cust['first_name'] . ' ' . $cust['last_name']),
        'em'     => $cust['email'],
        'ph'     => $cust['phone'],
        'orders' => (int)$cust['order_count'],
        'secQ'   => $cust['sec_question'],
        'orders_token' => makeOrderToken($cust['email'], 86400),  // 24h token for the account order view
    ]);
}

// POST — get security question for password reset
if ($method === 'POST' && $action === 'get_sec_question') {
    if (empty($d['em'])) fail('Email required');
    $stmt = $pdo->prepare("SELECT sec_question FROM customers WHERE email = ?");
    $stmt->execute([$d['em']]);
    $row = $stmt->fetch();
    if (!$row) fail('No account found with that email');
    if (empty($row['sec_question'])) fail('No security question set for this account');
    ok(['question' => $row['sec_question']]);
}

// POST — verify security answer and reset password
if ($method === 'POST' && $action === 'reset_password') {
    if (empty($d['em']) || empty($d['answer']) || empty($d['new_pw'])) fail('Missing fields');

    // Rate limit: 5 attempts per email, 15-minute lockout (separate key from login)
    $pdo->exec("CREATE TABLE IF NOT EXISTS customer_login_attempts (
        email_hash CHAR(32) PRIMARY KEY,
        attempts   INT NOT NULL DEFAULT 0,
        last_at    INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $rHash = md5('reset_' . strtolower(trim($d['em'])));
    $now   = time();
    $rRow  = $pdo->prepare("SELECT attempts, last_at FROM customer_login_attempts WHERE email_hash = ?");
    $rRow->execute([$rHash]);
    $rRow  = $rRow->fetch() ?: ['attempts' => 0, 'last_at' => 0];
    if ($rRow['attempts'] >= 5 && ($now - $rRow['last_at']) < 900) {
        $mins = (int)ceil((900 - ($now - $rRow['last_at'])) / 60);
        fail("Too many failed attempts. Try again in {$mins} minute" . ($mins === 1 ? '' : 's') . '.');
    }
    if ($rRow['attempts'] >= 5) {
        $pdo->prepare("INSERT INTO customer_login_attempts (email_hash,attempts,last_at) VALUES (?,0,0) ON DUPLICATE KEY UPDATE attempts=0,last_at=0")->execute([$rHash]);
        $rRow = ['attempts' => 0, 'last_at' => 0];
    }

    $stmt = $pdo->prepare("SELECT id, sec_answer FROM customers WHERE email = ?");
    $stmt->execute([$d['em']]);
    $row = $stmt->fetch();
    if (!$row) fail('Account not found');
    if (strtolower(trim($d['answer'])) !== $row['sec_answer']) {
        $newAttempts = $rRow['attempts'] + 1;
        $pdo->prepare("INSERT INTO customer_login_attempts (email_hash,attempts,last_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE attempts=?,last_at=?")->execute([$rHash,$newAttempts,$now,$newAttempts,$now]);
        fail('Incorrect answer');
    }
    $pdo->prepare("INSERT INTO customer_login_attempts (email_hash,attempts,last_at) VALUES (?,0,0) ON DUPLICATE KEY UPDATE attempts=0,last_at=0")->execute([$rHash]);
    if (strlen($d['new_pw']) < 6) fail('Password must be at least 6 characters');

    $hash = password_hash($d['new_pw'], PASSWORD_DEFAULT);
    $upd  = $pdo->prepare("UPDATE customers SET password_hash = ? WHERE id = ?");
    $upd->execute([$hash, $row['id']]);
    ok(['message' => 'Password reset successfully']);
}

// POST — change password (logged in)
if ($method === 'POST' && $action === 'change_password') {
    if (empty($d['id']) || empty($d['old_pw']) || empty($d['new_pw'])) fail('Missing fields');

    $stmt = $pdo->prepare("SELECT password_hash FROM customers WHERE id = ?");
    $stmt->execute([$d['id']]);
    $row = $stmt->fetch();
    if (!$row || !password_verify($d['old_pw'], $row['password_hash'])) fail('Current password incorrect');

    $hash = password_hash($d['new_pw'], PASSWORD_DEFAULT);
    $pdo->prepare("UPDATE customers SET password_hash = ? WHERE id = ?")->execute([$hash, $d['id']]);
    ok(['message' => 'Password updated']);
}

// POST — increment order count
if ($method === 'POST' && $action === 'inc_orders') {
    if (empty($d['em'])) fail('Email required');
    $pdo->prepare("UPDATE customers SET order_count = order_count + 1 WHERE email = ?")->execute([$d['em']]);
    ok();
}

// POST — admin: add customer
if ($method === 'POST' && $action === 'add_customer') {
    requireAdmin();
    if (empty($d['em'])) fail('Email required');
    $check = $pdo->prepare("SELECT id FROM customers WHERE email = ?");
    $check->execute([$d['em']]);
    if ($check->fetch()) fail('Email already registered');
    $id   = 'C' . time() . rand(100, 999);
    $hash = password_hash($d['pw'] ?? 'TempPass1!', PASSWORD_DEFAULT);
    $stmt = $pdo->prepare("INSERT INTO customers (id, first_name, last_name, email, password_hash, phone) VALUES (?,?,?,?,?,?)");
    $stmt->execute([$id, $d['fn'] ?? '', $d['ln'] ?? '', $d['em'], $hash, $d['ph'] ?? '']);
    ok(['id' => $id, 'message' => 'Customer added']);
}

// POST — admin: update customer
if ($method === 'POST' && $action === 'update_customer') {
    requireAdmin();
    $id = $d['id'] ?? '';
    if (!$id) fail('Missing id');
    $stmt = $pdo->prepare("UPDATE customers SET first_name=?, last_name=?, email=?, phone=? WHERE id=?");
    $stmt->execute([$d['fn'] ?? '', $d['ln'] ?? '', $d['em'] ?? '', $d['ph'] ?? '', $id]);
    ok(['message' => 'Customer updated']);
}

// POST — admin: delete customer
if ($method === 'POST' && $action === 'delete_customer') {
    requireAdmin();
    $id = $d['id'] ?? '';
    if (!$id) fail('Missing id');
    $pdo->prepare("DELETE FROM customers WHERE id = ?")->execute([$id]);
    ok(['message' => 'Customer deleted']);
}

// POST — cancel order (public; requires cancel_token issued at order creation)
if ($method === 'POST' && $action === 'cancel_order') {
    $order_id     = trim($d['order_id']     ?? '');
    $cancel_token = trim($d['cancel_token'] ?? '');
    if (!$order_id)     fail('Missing order_id');
    if (!$cancel_token) fail('Missing cancel token', 403);
    $expected = substr(hash_hmac('sha256', $order_id, DB_PASS), 0, 24);
    if (!hash_equals($expected, $cancel_token)) fail('Invalid cancel token', 403);
    $stmt = $pdo->prepare("SELECT id, status FROM orders WHERE id = ? LIMIT 1");
    $stmt->execute([$order_id]);
    $order = $stmt->fetch();
    if (!$order) fail('Order not found');
    if ($order['status'] !== 'Awaiting Payment') fail('Cannot cancel this order');
    // Restore stock for all items
    $items = $pdo->prepare("SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id != '_ship'");
    $items->execute([$order_id]);
    $restoreStmt = $pdo->prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
    foreach ($items->fetchAll() as $it) {
        $restoreStmt->execute([(int)$it['quantity'], $it['product_id']]);
    }
    $pdo->prepare("UPDATE orders SET status = 'Cancelled' WHERE id = ?")->execute([$order_id]);
    ok(['message' => 'Order cancelled']);
}

fail('Unknown action', 400);
