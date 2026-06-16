<?php
header('Content-Type: application/json');
require_once '/home/u541882440/domains/handmadedesignsbysuzi.com/public_html/api/config.php';
$pdo = db();
$prods = $pdo->query("SELECT id, sku, name, description, category, price FROM products ORDER BY category, name")->fetchAll(PDO::FETCH_ASSOC);
echo json_encode($prods, JSON_PRETTY_PRINT);
