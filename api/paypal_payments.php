<?php
// api/paypal_payments.php — PayPal & Venmo payments report for the admin back office.
// Unlike square_payments.php (which calls Square's live Payments API), this is sourced from our
// own orders table: every PayPal/Venmo charge already stores its capture id, exact PayPal fee,
// and tax at the moment it's captured (see api/paypal_capture.php), so our DB is the
// authoritative record here — no second live API integration needed just to report on it.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/paypal.php';
cors();
requireAdmin();

$pdo = db();
ensurePaypalColumn($pdo);  // paypal_capture_id may not exist yet if no PayPal capture/refund has ever run

$begin = trim($_GET['begin'] ?? '');
$end   = trim($_GET['end'] ?? '');

$sql = "SELECT id, order_date, created_at, customer_email, payment_method, total, tax_amount,
               transaction_fee, refunded_amount, paypal_capture_id
        FROM orders
        WHERE paypal_capture_id IS NOT NULL AND paypal_capture_id != ''";
$params = [];
if ($begin) { $sql .= " AND order_date >= ?"; $params[] = $begin; }
if ($end)   { $sql .= " AND order_date <= ?"; $params[] = $end; }
$sql .= " ORDER BY created_at DESC LIMIT 500";

$stmt = $pdo->prepare($sql);
$stmt->execute($params);

$out = [];
foreach ($stmt->fetchAll() as $o) {
    $total    = (float)$o['total'];
    $fee      = (float)($o['transaction_fee'] ?? 0);
    $refunded = (float)($o['refunded_amount'] ?? 0);
    $status   = $refunded <= 0.004 ? 'COMPLETED' : ($refunded >= $total - 0.005 ? 'REFUNDED' : 'PARTIAL_REFUND');
    $out[] = [
        'id'       => $o['paypal_capture_id'],
        'order_id' => $o['id'],
        'created'  => $o['created_at'],
        'method'   => $o['payment_method'],  // 'PayPal' or 'Venmo'
        'status'   => $status,
        'amount'   => round($total, 2),
        'tax'      => round((float)($o['tax_amount'] ?? 0), 2),
        'fee'      => round($fee, 2),
        'net'      => round($total - $fee, 2),
        'refunded' => round($refunded, 2),
        'buyer'    => $o['customer_email'],
    ];
}

ok(['payments' => $out, 'mode' => pp_env(), 'count' => count($out)]);
