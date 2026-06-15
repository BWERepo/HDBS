<?php
header('Content-Type: application/json');
require_once __DIR__ . '/api/config.php';
$pdo = db();

// Get current nav_order
$current = $pdo->query("SELECT value FROM settings WHERE key_name='nav_order' LIMIT 1")->fetchColumn();
$arr = $current ? json_decode($current, true) : [];

// Add emaillog if missing
if(!in_array('emaillog', $arr)){
    // Insert before 'logs'
    $pos = array_search('logs', $arr);
    if($pos !== false){
        array_splice($arr, $pos, 0, ['emaillog']);
    } else {
        $arr[] = 'emaillog';
    }
    $pdo->prepare("UPDATE settings SET value=? WHERE key_name='nav_order'")->execute([json_encode($arr)]);
    echo json_encode(['updated'=>true,'new_order'=>$arr,'message'=>'Delete this file now!']);
} else {
    echo json_encode(['updated'=>false,'message'=>'emaillog already in nav order','order'=>$arr]);
}
