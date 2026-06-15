<?php
// drop_tn_tax.php — Drops tn_sales_tax table. DELETE after running.
require_once __DIR__ . '/api/config.php';
$pdo = db();
try {
    $pdo->exec("DROP TABLE IF EXISTS tn_sales_tax");
    echo "✓ Table tn_sales_tax dropped. Delete this file.";
} catch(Exception $e) {
    echo "Error: " . $e->getMessage();
}
