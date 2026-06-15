<?php
require_once __DIR__ . '/config.php';
header('Content-Type: application/json');

function ts_ok($d){
    $d['success'] = true;
    echo json_encode($d);
    exit;
}
function ts_fail($e){
    echo json_encode(array('success'=>false,'error'=>$e));
    exit;
}
function ts_body(){
    $raw = file_get_contents('php://input');
    if(!$raw) return array();
    $d = json_decode($raw, true);
    return $d ? $d : array();
}

require_once __DIR__ . '/applog.php';
dbg('tax_sweep','REQUEST method='.($_SERVER['REQUEST_METHOD']??'?').' action='.($_GET['action']??'?'));
try {
    $pdo    = db();
    $method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
    $action = isset($_GET['action']) ? $_GET['action'] : '';

    // Check tax_sweeps table
    $chk = $pdo->query("SHOW TABLES LIKE 'tax_sweeps'")->fetchAll(PDO::FETCH_COLUMN);
    if(empty($chk)) ts_fail('tax_sweeps table missing');

    // Check tax_swept_date column
    $cols = $pdo->query("SHOW COLUMNS FROM orders LIKE 'tax_swept_date'")->fetchAll(PDO::FETCH_COLUMN);
    $hasDateCol = !empty($cols);

    // GET history
    if($method === 'GET' && $action === 'history'){
        $rows = $pdo->query("SELECT * FROM tax_sweeps ORDER BY sweep_date DESC, id DESC")->fetchAll(PDO::FETCH_ASSOC);
        ts_ok(array('sweeps' => $rows));
    }

    // GET pending
    if($method === 'GET'){
        $sql = "SELECT id, order_date, tax_amount FROM orders WHERE tax_amount > 0 AND (tax_swept_date IS NULL OR tax_swept_date = '') ORDER BY order_date ASC";
        $rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);

        if(empty($rows)){
            ts_ok(array('pending'=>false,'message'=>'No unswept tax orders found.'));
        }

        $count    = count($rows);
        $totalTax = 0;
        $orderIds = array();
        foreach($rows as $r){
            $totalTax += (float)$r['tax_amount'];
            $orderIds[] = $r['id'];
        }

        // Build order details array for display
        $orderDetails = array();
        foreach($rows as $r){
            $orderDetails[] = array(
                'id'       => $r['id'],
                'date'     => $r['order_date'],
                'tax'      => round((float)$r['tax_amount'], 2),
            );
        }
        ts_ok(array(
            'pending'       => true,
            'count'         => $count,
            'total_tax'     => round($totalTax, 2),
            'date_from'     => $rows[0]['order_date'],
            'date_to'       => $rows[$count-1]['order_date'],
            'order_ids'     => $orderIds,
            'order_details' => $orderDetails,
        ));
    }

    // POST sweep
    if($method === 'POST'){
        $d = ts_body();
        if(empty($d['order_ids']) || !is_array($d['order_ids'])){
            ts_fail('Missing order_ids');
        }

        $count    = isset($d['count'])     ? (int)$d['count']     : count($d['order_ids']);
        $totalTax = isset($d['total_tax']) ? (float)$d['total_tax'] : 0;
        $dateFrom = isset($d['date_from']) ? $d['date_from'] : '';
        $dateTo   = isset($d['date_to'])   ? $d['date_to']   : '';
        $now      = date('Y-m-d H:i:s');
        $today    = date('Y-m-d');

        $ids = $d['order_ids'];
        $orderIdsJson = json_encode($ids);
        // Store order details (id+tax) if provided
        $orderDetailsJson = isset($d['order_details']) ? json_encode($d['order_details']) : null;
        // Check if order_details column exists
        $hasDCol = !empty($pdo->query("SHOW COLUMNS FROM tax_sweeps LIKE 'order_details'")->fetchAll());
        if($hasDCol){
            $ins = $pdo->prepare("INSERT INTO tax_sweeps (sweep_date, period_from, period_to, order_count, total_tax, order_ids, order_details) VALUES (?,?,?,?,?,?,?)");
            $ins->execute(array($today, $dateFrom, $dateTo, $count, $totalTax, $orderIdsJson, $orderDetailsJson));
        } else {
            $ins = $pdo->prepare("INSERT INTO tax_sweeps (sweep_date, period_from, period_to, order_count, total_tax, order_ids) VALUES (?,?,?,?,?,?)");
            $ins->execute(array($today, $dateFrom, $dateTo, $count, $totalTax, $orderIdsJson));
        }
        $sweepId = $pdo->lastInsertId();

        $ids = $d['order_ids'];
        $ph  = implode(',', array_fill(0, count($ids), '?'));

        $params = array_merge(array($now), $ids);
        $pdo->prepare("UPDATE orders SET tax_swept_date = ? WHERE id IN ($ph)")->execute($params);

        ts_ok(array('sweep_id'=>$sweepId,'updated'=>count($ids),'sweep_date'=>$today));
    }

// PUT — edit sweep record
if($method === 'PUT'){
    $d = ts_body();
    if(empty($d['id'])) ts_fail('Missing id');
    $sets=[]; $vals=[];
    if(isset($d['sweep_date'])) { $sets[]='sweep_date=?';  $vals[]=$d['sweep_date']; }
    if(isset($d['total_tax']))  { $sets[]='total_tax=?';   $vals[]=(float)$d['total_tax']; }
    if(isset($d['order_count'])){ $sets[]='order_count=?'; $vals[]=(int)$d['order_count']; }
    if(empty($sets)) ts_fail('Nothing to update');
    $vals[]=(int)$d['id'];
    $pdo->prepare('UPDATE tax_sweeps SET '.implode(',',$sets).' WHERE id=?')->execute($vals);
    ts_ok(array('updated'=>true));
}

// DELETE — remove sweep record
if($method === 'DELETE'){
    $d = ts_body();
    if(empty($d['id'])) ts_fail('Missing id');
    $pdo->prepare('DELETE FROM tax_sweeps WHERE id=?')->execute(array((int)$d['id']));
    ts_ok(array('deleted'=>true));
}

ts_fail('Method not allowed');

} catch(Exception $e){
    ts_fail('Server error: ' . $e->getMessage());
}
