<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
header('Content-Type: application/json');
$pdo = db();
$method = $_SERVER['REQUEST_METHOD'];
$d = json_decode(file_get_contents('php://input'), true) ?: [];
applog('tn_tax', "$method request");

function tntok($d){ echo json_encode(array_merge(['success'=>true],$d)); exit; }
function tntfail($e){ echo json_encode(['success'=>false,'error'=>$e]); exit; }
// Check table exists
try{
    $pdo->query('SELECT 1 FROM tn_sales_tax LIMIT 1');
} catch(Exception $e){
    applog('tn_tax', 'ERROR: table missing: '.$e->getMessage());
    tntfail('Table tn_sales_tax does not exist. Run add_tn_tax_table.php first. ('.$e->getMessage().')');
}

// GET — list all counties
if ($method === 'GET') {
    try {
        $rows = $pdo->query("SELECT id, county, tax_rate FROM tn_sales_tax ORDER BY county")->fetchAll(PDO::FETCH_ASSOC);
        applog('tn_tax', 'GET returned '.count($rows).' counties');
        tntok(['counties' => $rows]);
    } catch(Exception $e) {
        applog('tn_tax', 'GET ERROR: '.$e->getMessage());
        tntfail('GET error: '.$e->getMessage());
    }
}

// POST — add or update county
if ($method === 'POST') {
    $county = trim($d['county'] ?? '');
    $rate   = isset($d['tax_rate']) ? (float)$d['tax_rate'] : null;
    if (!$county || $rate === null) tntfail('Missing county or tax_rate');
    $pdo->prepare("INSERT INTO tn_sales_tax (county, tax_rate) VALUES (?, ?) ON DUPLICATE KEY UPDATE tax_rate=?")->execute([$county, $rate, $rate]);
    applog('tn_tax', "POST saved: $county = $rate");
    tntok(['county' => $county, 'tax_rate' => $rate]);
}

// DELETE — remove county
if ($method === 'DELETE') {
    $id = (int)($d['id'] ?? 0);
    if (!$id) tntfail('Missing id');
    $pdo->prepare("DELETE FROM tn_sales_tax WHERE id=?")->execute([$id]);
    applog('tn_tax', "DELETE id=$id");
    tntok(['deleted' => $id]);
}

tntfail('Method not allowed');
