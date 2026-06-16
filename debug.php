<?php
// debug.php — Read/write debug mode flag (stored in debug.flag in site root)
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit(); }

$flagFile = __DIR__ . '/debug.flag';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $on = file_exists($flagFile) && trim(file_get_contents($flagFile)) === '1';
    echo json_encode(['success' => true, 'enabled' => $on]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $d = json_decode(file_get_contents('php://input'), true) ?? [];
    $val = isset($d['enabled']) ? ($d['enabled'] ? '1' : '0') : '0';
    file_put_contents($flagFile, $val);
    echo json_encode(['success' => true, 'enabled' => $val === '1']);
    exit();
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);
