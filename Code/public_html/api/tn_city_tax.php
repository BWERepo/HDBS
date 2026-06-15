<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
require_once __DIR__ . '/applog.php';
header('Content-Type: application/json');
$pdo = db();
$method = $_SERVER['REQUEST_METHOD'];
$d = json_decode(file_get_contents('php://input'), true) ?: [];
applog('tn_city_tax', "$method request");

function ctok($d){ echo json_encode(array_merge(['success'=>true],$d)); exit; }
function ctfail($e){ echo json_encode(['success'=>false,'error'=>$e]); exit; }

try { $pdo->query('SELECT 1 FROM tn_city_tax LIMIT 1'); }
catch(Exception $e){ applog('tn_city_tax','ERROR: table missing: '.$e->getMessage()); ctfail('Run add_tn_city_tax.php first. ('.$e->getMessage().')'); }

if ($method === 'GET') {
    try {
        $search = trim($_GET['search'] ?? '');
        if ($search) {
            $stmt = $pdo->prepare("SELECT id, city, county, tax_rate FROM tn_city_tax WHERE city LIKE ? OR county LIKE ? ORDER BY city");
            $stmt->execute(["%$search%", "%$search%"]);
        } else {
            $stmt = $pdo->query("SELECT id, city, county, tax_rate FROM tn_city_tax ORDER BY city");
        }
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        applog('tn_city_tax', 'GET returned '.count($rows).' cities'.($search?" (search: $search)":''));
        ctok(['cities' => $rows]);
    } catch(Exception $e) { applog('tn_city_tax','GET ERROR: '.$e->getMessage()); ctfail($e->getMessage()); }
}

if ($method === 'POST') {
    $city   = trim($d['city'] ?? '');
    $county = trim($d['county'] ?? '');
    $rate   = isset($d['tax_rate']) ? (float)$d['tax_rate'] : null;
    if (!$city || !$county || $rate === null) ctfail('Missing city, county, or tax_rate');
    try {
        $pdo->prepare("INSERT INTO tn_city_tax (city, county, tax_rate) VALUES (?,?,?) ON DUPLICATE KEY UPDATE county=?, tax_rate=?")->execute([$city,$county,$rate,$county,$rate]);
        applog('tn_city_tax', "POST saved: $city / $county = $rate");
        ctok(['city'=>$city,'county'=>$county,'tax_rate'=>$rate]);
    } catch(Exception $e) { ctfail($e->getMessage()); }
}

if ($method === 'DELETE') {
    $id = (int)($d['id'] ?? 0);
    if (!$id) ctfail('Missing id');
    $pdo->prepare("DELETE FROM tn_city_tax WHERE id=?")->execute([$id]);
    applog('tn_city_tax', "DELETE id=$id");
    ctok(['deleted'=>$id]);
}

ctfail('Method not allowed');
