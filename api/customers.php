<?php
// api/customers.php — Register, login, get customers, password reset

require_once __DIR__ . '/config.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
$pdo    = db();
$d      = body();
$action = $d['action'] ?? $_GET['action'] ?? '';

// GET — list all customers (admin)
if ($method === 'GET' && $action === 'list') {
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

    ok(['id' => $id, 'name' => trim(($d['fn'] ?? '') . ' ' . ($d['ln'] ?? '')), 'em' => $d['em']]);
}

// POST — login
if ($method === 'POST' && $action === 'login') {
    if (empty($d['em']) || empty($d['pw'])) fail('Email and password required');

    $stmt = $pdo->prepare("SELECT * FROM customers WHERE email = ?");
    $stmt->execute([$d['em']]);
    $cust = $stmt->fetch();

    if (!$cust || !password_verify($d['pw'], $cust['password_hash'])) fail('Incorrect email or password');

    ok([
        'id'     => $cust['id'],
        'fn'     => $cust['first_name'],
        'ln'     => $cust['last_name'],
        'name'   => trim($cust['first_name'] . ' ' . $cust['last_name']),
        'em'     => $cust['email'],
        'ph'     => $cust['phone'],
        'orders' => (int)$cust['order_count'],
        'secQ'   => $cust['sec_question'],
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

    $stmt = $pdo->prepare("SELECT id, sec_answer FROM customers WHERE email = ?");
    $stmt->execute([$d['em']]);
    $row = $stmt->fetch();
    if (!$row) fail('Account not found');
    if (strtolower(trim($d['answer'])) !== $row['sec_answer']) fail('Incorrect answer');
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

fail('Unknown action', 400);
