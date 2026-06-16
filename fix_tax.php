<?php
// fix_tax.php — One-shot tool: fetch and save tax for all paid orders with $0 tax
// DELETE THIS FILE after use.
require_once __DIR__ . '/api/config.php';
$secretsPath = dirname(__DIR__) . '/secrets.php';
require_once $secretsPath;

$pdo   = db();
$token = SQUARE_TOKEN;
$base  = 'https://connect.squareup.com/v2';
$hdrs  = ['Square-Version: 2024-01-18', 'Authorization: Bearer '.$token, 'Content-Type: application/json'];

function sq($url, $hdrs){
    $ch = curl_init($url);
    curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>10,CURLOPT_HTTPHEADER=>$hdrs]);
    $r = curl_exec($ch); curl_close($ch);
    return $r ? json_decode($r,true) : null;
}

// Get all paid orders with no tax
$orders = $pdo->query("SELECT id, square_payment_id FROM orders WHERE status='Paid' AND (tax_amount IS NULL OR tax_amount=0)")->fetchAll();

// Also load recent Square payments once (to match by note)
$sqPay = sq($base.'/payments?sort_order=DESC&limit=50&location_id=LJP687TQBTWTA', $hdrs);
$payments = $sqPay['payments'] ?? [];

echo "<pre style='font-family:monospace;font-size:13px;padding:20px'>";
echo "Orders with \$0 tax: ".count($orders)."\n\n";

foreach($orders as $o){
    $oid       = $o['id'];
    $sq_pay_id = $o['square_payment_id'];
    $sq_order_id = null;

    // Strategy 1: use stored square_payment_id
    if($sq_pay_id){
        $pd = sq($base.'/payments/'.$sq_pay_id, $hdrs);
        $sq_order_id = $pd['payment']['order_id'] ?? null;
        echo "$oid | sq_pay_id=$sq_pay_id | sq_order_id=".($sq_order_id?:'NOT FOUND')."\n";
    } else {
        // Strategy 2: scan payments by note
        foreach($payments as $p){
            if(!empty($p['note']) && strpos($p['note'],$oid)!==false){
                $sq_order_id = $p['order_id'] ?? null;
                $sq_pay_id   = $p['id'];
                echo "$oid | found by note | sq_pay=$sq_pay_id | sq_order=".($sq_order_id?:'null')."\n";
                break;
            }
        }
        if(!$sq_order_id) { echo "$oid | NOT FOUND in Square payments\n"; continue; }
    }

    if(!$sq_order_id){ echo "$oid | no sq_order_id, skipping\n"; continue; }

    // Fetch the Square order
    $od = sq($base.'/orders/'.$sq_order_id, $hdrs);
    echo "$oid | SQ ORDER KEYS: ".implode(', ', array_keys($od['order']??[]))."\n";

    $tax = isset($od['order']['total_tax_money']['amount'])
         ? (float)$od['order']['total_tax_money']['amount']/100 : 0;

    echo "$oid | tax=\$$tax\n";

    if($tax > 0){
        $pdo->prepare("UPDATE orders SET tax_amount=?, square_payment_id=COALESCE(NULLIF(square_payment_id,''),?) WHERE id=?")
            ->execute([$tax, $sq_pay_id, $oid]);
        echo "$oid | ✓ SAVED tax=\$$tax\n";
    } else {
        // Dump the full order so we can see where tax actually is
        echo "$oid | tax=0, full order dump:\n".json_encode($od['order']??$od, JSON_PRETTY_PRINT)."\n";
    }
    echo "\n";
}
echo "Done.\n</pre>";
