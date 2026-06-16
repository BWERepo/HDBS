<?php
// api/subscribers.php — Newsletter subscribe, list, delete

require_once __DIR__ . '/config.php';
cors();

$method = $_SERVER['REQUEST_METHOD'];
$pdo    = db();

// GET — list all subscribers
if ($method === 'GET') {
    $rows = $pdo->query("SELECT email, DATE_FORMAT(subscribed_at, '%m/%d/%Y') as date FROM subscribers ORDER BY subscribed_at DESC")->fetchAll();
    ok(['subscribers' => $rows]);
}

// POST — subscribe
if ($method === 'POST') {
    $d  = body();
    $em = trim($d['email'] ?? '');
    if (!$em || !filter_var($em, FILTER_VALIDATE_EMAIL)) fail('Invalid email address');

    // Check duplicate
    $check = $pdo->prepare("SELECT id FROM subscribers WHERE email = ?");
    $check->execute([$em]);
    if ($check->fetch()) fail('Already subscribed');

    $pdo->prepare("INSERT INTO subscribers (email) VALUES (?)")->execute([$em]);
    ok(['message' => 'Subscribed successfully']);
}

// DELETE — remove subscriber
if ($method === 'DELETE') {
    $d  = body();
    $em = $d['email'] ?? '';
    if (!$em) fail('Email required');
    $pdo->prepare("DELETE FROM subscribers WHERE email = ?")->execute([$em]);
    ok(['message' => 'Unsubscribed']);
}

fail('Method not allowed', 405);
