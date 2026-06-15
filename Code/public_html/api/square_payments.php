<?php
ob_start();
header('Content-Type: application/json');

function sq_ok($d){ ob_end_clean(); $d['success']=true; echo json_encode($d); exit; }
function sq_fail($e){ ob_end_clean(); echo json_encode(array('success'=>false,'error'=>$e)); exit; }

try {
    require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
} catch(Exception $e){ sq_fail('config error: '.$e->getMessage()); }

try {
    $pdo = db();
} catch(Exception $e){ sq_fail('db error: '.$e->getMessage()); }

try {
    $secretsPath = dirname(dirname(__DIR__)) . '/secrets.php';
    if(!file_exists($secretsPath)) sq_fail('secrets.php not found at: '.$secretsPath);
    require_once $secretsPath;
} catch(Exception $e){ sq_fail('secrets error: '.$e->getMessage()); }

if(!defined('SQUARE_TOKEN') || !SQUARE_TOKEN) sq_fail('SQUARE_TOKEN not defined in secrets.php');
if(!function_exists('curl_init')) sq_fail('cURL not available.');

$modeRow = $pdo->query("SELECT value FROM settings WHERE key_name='square_mode' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$mode    = ($modeRow && $modeRow['value']==='test') ? 'test' : 'live';
$token   = SQUARE_TOKEN;
$baseUrl = ($mode==='test') ? 'https://connect.squareupsandbox.com/v2' : 'https://connect.squareup.com/v2';

// Action: backfill transaction fees from Square for orders missing them
$_postBody = json_decode(file_get_contents('php://input'), true) ?: [];
$_postAction = isset($_postBody['action']) ? $_postBody['action'] : (isset($_POST['action']) ? $_POST['action'] : '');
dbg('square_payments', "REQUEST mode=$mode action=$_postAction begin=".($_GET['begin']??'').' end='.($_GET['end']??'').' cursor='.($_GET['cursor']??''));
if ($_postAction === 'backfill_fees') { dbg('square_payments','backfill_fees started orders_count='.count($orders??[]));
    $locationId = defined('SQUARE_LOCATION_ID') ? SQUARE_LOCATION_ID : '';
    $diag = [];
    $diag[] = 'mode='.$mode.' locationId='.($locationId?'set':'MISSING').' baseUrl='.$baseUrl;
    // Get all Credit Card/Square orders with fee = 0
    $orders = $pdo->query("SELECT id, order_date FROM orders WHERE (payment_method='Credit Card' OR payment_method='Square') AND (transaction_fee IS NULL OR transaction_fee=0) ORDER BY order_date DESC LIMIT 100")->fetchAll(PDO::FETCH_ASSOC);
    $diag[] = 'orders_to_check='.count($orders);
    $updated = 0; $skipped = 0; $errors = []; $unmatched = [];
    foreach ($orders as $ord) {
        $begin = date('Y-m-d', strtotime($ord['order_date'].' -30 days')).'T00:00:00Z';
        $end   = date('Y-m-d', strtotime($ord['order_date'].' +30 days')).'T23:59:59Z';
        $url = $baseUrl.'/payments?limit=100&location_id='.$locationId.'&begin_time='.urlencode($begin).'&end_time='.urlencode($end);
        $diag[] = 'order='.$ord['id'].' date='.$ord['order_date'].' url='.$url;
        $data    = sq_curl($url, 'GET', null, $token);
        $curlErr = ($data === null) ? 'cURL/network error' : '';
        $payCount = !empty($data['payments']) ? count($data['payments']) : 0;
        $diag[] = '  curl_err='.($curlErr?$curlErr:'none').' payments_returned='.$payCount;
        if ($curlErr) { $errors[] = $ord['id'].': curl '.$curlErr; $skipped++; continue; }
        if (!empty($data['errors'])) { $errors[] = $ord['id'].': sq '.json_encode($data['errors']); $skipped++; continue; }
        $matched = null;
        if (!empty($data['payments'])) {
            foreach ($data['payments'] as $p) {
                $note = isset($p['note']) ? $p['note'] : '';
                $diag[] = '    payment='.$p['id'].' status='.$p['status'].' note='.substr($note,0,40);
                if (strpos($note, $ord['id']) !== false && ($p['status']==='COMPLETED'||$p['status']==='APPROVED')) {
                    $matched = $p; break;
                }
            }
        }
        if (!$matched) { $diag[] = '  NO MATCH for '.$ord['id']; $skipped++; $unmatched[] = $ord['id']; continue; }
        $fee = 0;
        if (isset($matched['processing_fee']) && is_array($matched['processing_fee']))
            foreach ($matched['processing_fee'] as $f)
                if (isset($f['amount_money']['amount'])) $fee += (float)$f['amount_money']['amount']/100;
        $diag[] = '  matched='.$matched['id'].' raw_fee='.$fee;
        if (abs($fee) < 0.001) {
            $amt = isset($matched['amount_money']['amount']) ? (float)$matched['amount_money']['amount']/100 : 0;
            $fee = round($amt * 0.026 + 0.10, 2);
            $diag[] = '  estimated_fee='.$fee;
        }
        $fee = round(abs($fee), 2);
        $pdo->prepare('UPDATE orders SET transaction_fee=? WHERE id=?')->execute([$fee, $ord['id']]);
        $diag[] = '  UPDATED '.$ord['id'].' fee='.$fee;
        $updated++;
    }
    sq_ok(['updated'=>$updated,'skipped'=>$skipped,'total'=>count($orders),'errors'=>$errors,'diag'=>$diag,'unmatched'=>$unmatched]);
}


$begin  = isset($_GET['begin'])  ? $_GET['begin']  : '';
$end    = isset($_GET['end'])    ? $_GET['end']    : '';
$cursor = isset($_GET['cursor']) ? $_GET['cursor'] : '';

$params = array('location_id'=>'LJP687TQBTWTA','sort_order'=>'DESC','limit'=>50);
if($begin)  $params['begin_time'] = $begin.'T00:00:00Z';
if($end)    $params['end_time']   = $end.'T23:59:59Z';
if($cursor) $params['cursor']     = $cursor;

$url = $baseUrl.'/payments?'.http_build_query($params);

$_sqResult = sq_curl($url, 'GET', null, $token);
$curlErr   = ($_sqResult === null) ? 'cURL/network error' : '';
$status    = ($curlErr) ? 0 : 200;
$resp      = $_sqResult ? json_encode($_sqResult) : null;
$data      = $_sqResult;

if($curlErr) sq_fail('cURL error: '.$curlErr);
if(!$resp)   sq_fail('Empty response from Square.');

if($data===null) sq_fail('No response from Square.');
if($status===401 || $status===403){
    sq_fail('Square authorization error — your token needs PAYMENTS_READ permission. In Square Developer Dashboard: select your app → OAuth → enable PAYMENTS_READ scope → regenerate token → update secrets.php.');
} elseif($status!==200){
    $msg = isset($data['errors'][0]['detail']) ? $data['errors'][0]['detail'] : 'HTTP '.$status;
    sq_fail('Square error ('.$status.'): '.$msg);
}

$payments = isset($data['payments']) ? $data['payments'] : array();
// Batch-fetch all order tax in one request instead of one per payment
$orderIds = array_values(array_filter(array_map(function($p){ return isset($p['order_id']) ? $p['order_id'] : ''; }, $payments)));
$taxByOrderId = [];
if (!empty($orderIds)) {
    $bData = sq_curl($baseUrl.'/orders/batch-retrieve', 'POST',
        ['location_id'=>'LJP687TQBTWTA','order_ids'=>$orderIds], $token);
    if (!empty($bData['orders'])) {
        foreach ($bData['orders'] as $o) {
            $taxByOrderId[$o['id']] = isset($o['total_tax_money']['amount'])
                ? (float)$o['total_tax_money']['amount'] / 100
                : 0;
        }
    }
}

$out = array();
foreach($payments as $p){
    $amt = isset($p['total_money']['amount']) ? (float)$p['total_money']['amount']/100 : 0;
    $tax = isset($p['order_id']) ? ($taxByOrderId[$p['order_id']] ?? 0) : 0;
    $tip = isset($p['tip_money']['amount'])       ? (float)$p['tip_money']['amount']/100       : 0;
    $fee = 0;
    if(isset($p['processing_fee'])&&is_array($p['processing_fee']))
        foreach($p['processing_fee'] as $f)
            if(isset($f['amount_money']['amount']))
                $fee += (float)$f['amount_money']['amount']/100;
    // Square returns $0 fee until next-day settlement — estimate if zero
    $feeEstimated = false;
    if(abs($fee) < 0.001 && $amt > 0 && isset($p['status']) && $p['status']==='COMPLETED'){
        $fee = round($amt * 0.026 + 0.10, 2);
        $feeEstimated = true;
    }
    $out[] = array(
        'id'           => isset($p['id'])          ? $p['id']          : '',
        'created'      => isset($p['created_at'])  ? $p['created_at']  : '',
        'status'       => isset($p['status'])      ? $p['status']      : '',
        'amount'       => round($amt,2),
        'tax'          => round($tax,2),
        'tip'          => round($tip,2),
        'fee'          => round(abs($fee),2),
        'fee_estimated'=> $feeEstimated,
        'net'          => round($amt-abs($fee),2),
        'note'      => isset($p['note'])        ? $p['note']        : '',
        'card_brand'=> isset($p['card_details']['card']['card_brand']) ? $p['card_details']['card']['card_brand'] : '',
        'last4'     => isset($p['card_details']['card']['last_4'])     ? $p['card_details']['card']['last_4']     : '',
        'buyer'     => isset($p['buyer_email_address'])                ? $p['buyer_email_address']                : '',
    );
}

dbg('square_payments','returning '.count($out).' payments');
sq_ok(array('payments'=>$out,'cursor'=>isset($data['cursor'])?$data['cursor']:null,'mode'=>$mode,'count'=>count($out)));
