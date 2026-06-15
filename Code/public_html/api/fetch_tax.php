<?php
ob_start();
header('Content-Type: application/json');

function ft_ok($d)  { ob_end_clean(); $d['success']=true;  echo json_encode($d); exit; }
function ft_err($e) { ob_end_clean(); echo json_encode(['success'=>false,'error'=>$e]); exit; }

// Write log AFTER ob_start so output buffering doesn't interfere
$_ftlog = dirname(__DIR__) . '/fetch_tax_log.txt';
file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | fetch_tax.php called\n", FILE_APPEND|LOCK_EX);
dbg('fetch_tax', 'called body='.substr(file_get_contents('php://input'),0,200));

try {
    require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
    file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | config loaded\n", FILE_APPEND|LOCK_EX);
} catch(Exception $e){ ft_err('config error: '.$e->getMessage()); }

try {
    $secretsPath = dirname(dirname(__DIR__)) . '/secrets.php';
    file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | secrets path: $secretsPath exists=" . (file_exists($secretsPath)?'yes':'no') . "\n", FILE_APPEND|LOCK_EX);
    if (!file_exists($secretsPath)) ft_err('secrets not found: '.$secretsPath);
    require_once $secretsPath;
    if (!defined('SQUARE_TOKEN') || !SQUARE_TOKEN) ft_err('SQUARE_TOKEN not defined');
    file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | secrets loaded, token len=" . strlen(SQUARE_TOKEN) . "\n", FILE_APPEND|LOCK_EX);
} catch(Exception $e){ ft_err('secrets error: '.$e->getMessage()); }

try { $pdo = db(); } catch(Exception $e){ ft_err('db error: '.$e->getMessage()); }

$data      = json_decode(file_get_contents('php://input'), true) ?: [];
$order_id  = trim($data['order_id'] ?? '');
dbg('fetch_tax', "order_id=$order_id sq_pay_id=$sq_pay_id");
$sq_pay_id = trim($data['sq_payment_id'] ?? '');
file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | order_id=$order_id sq_pay_id=$sq_pay_id\n", FILE_APPEND|LOCK_EX);
if (!$order_id) ft_err('Missing order_id');

$token = SQUARE_TOKEN;
$base  = 'https://connect.squareup.com/v2';
$hdrs  = ['Square-Version: 2024-01-18', 'Authorization: Bearer '.$token, 'Content-Type: application/json'];

function ft_sq($url, $hdrs) {
    global $token;
    $body = sq_curl($url, 'GET', null, $token);
    return ['code'=> ($body!==null)?200:0, 'body'=> $body];
}

$sq_order_id = null;

// Strategy 1: use stored square_payment_id
if ($sq_pay_id) {
    $r = ft_sq($base.'/payments/'.$sq_pay_id, $hdrs);
    file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | payment lookup HTTP {$r['code']}\n", FILE_APPEND|LOCK_EX);
    $sq_order_id = $r['body']['payment']['order_id'] ?? null;
    file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | sq_order_id=$sq_order_id\n", FILE_APPEND|LOCK_EX);
}

// Strategy 2: scan recent payments by note
if (!$sq_order_id) {
    $r = ft_sq($base.'/payments?sort_order=DESC&limit=50', $hdrs);
    $count = count($r['body']['payments'] ?? []);
    file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | scan HTTP {$r['code']} count=$count\n", FILE_APPEND|LOCK_EX);
    foreach (($r['body']['payments'] ?? []) as $p) {
        if (!empty($p['note']) && strpos($p['note'], $order_id) !== false) {
            $sq_order_id = $p['order_id'] ?? null;
            if (!$sq_pay_id && !empty($p['id'])) {
                $pdo->prepare("UPDATE orders SET square_payment_id=? WHERE id=? AND (square_payment_id IS NULL OR square_payment_id='')")
                    ->execute([$p['id'], $order_id]);
            }
            file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | matched note: sq_order_id=$sq_order_id\n", FILE_APPEND|LOCK_EX);
            break;
        }
    }
}

if (!$sq_order_id) ft_err('Could not find Square order for '.$order_id);

// Fetch Square order
$r = ft_sq($base.'/orders/'.$sq_order_id, $hdrs);
$orderKeys = implode(',', array_keys($r['body']['order'] ?? []));
file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | order HTTP {$r['code']} keys=$orderKeys\n", FILE_APPEND|LOCK_EX);
file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | FULL_ORDER=" . json_encode($r['body']['order'] ?? $r['body']) . "\n", FILE_APPEND|LOCK_EX);

$order = $r['body']['order'] ?? null;
if (!$order) ft_err('Square order empty: '.$sq_order_id);

$tax = isset($order['total_tax_money']['amount'])
     ? (float)$order['total_tax_money']['amount'] / 100 : 0;

file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | tax=$tax\n", FILE_APPEND|LOCK_EX);

if ($tax <= 0) ft_err('No tax on this order ($0). Keys: '.$orderKeys);

// Use Square's total_money as the authoritative total (includes tax)
$sq_total  = isset($order['total_money']['amount']) ? round((float)$order['total_money']['amount'] / 100, 2) : 0;
file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT'." | sq_total=$sq_total tax=$tax\n", FILE_APPEND|LOCK_EX);
$pdo->prepare("UPDATE orders SET tax_amount=?, total=? WHERE id=?")->execute([$tax, $sq_total, $order_id]);
file_put_contents($_ftlog, (new DateTime('now', new DateTimeZone('America/New_York')))->format('Y-m-d g:i A') . ' EDT' . " | SAVED tax=$tax\n", FILE_APPEND|LOCK_EX);

ft_ok(['tax'=>$tax, 'total'=>$sq_total, 'sq_order_id'=>$sq_order_id]);
