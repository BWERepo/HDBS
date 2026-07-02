<?php
// api/refund.php — Process order refunds (cash/check ledger entry, or real Square refund for card payments)

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';
cors();
requireAdmin();

$pdo = db();

// Idempotent schema: refund ledger + cumulative refunded amount on orders
$pdo->exec("CREATE TABLE IF NOT EXISTS refunds (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(40) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    method VARCHAR(20) NOT NULL,
    square_refund_id VARCHAR(60) DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Completed',
    created_at DATETIME NOT NULL
)");
if (empty($pdo->query("SHOW COLUMNS FROM orders LIKE 'refunded_amount'")->fetchAll())) {
    $pdo->exec("ALTER TABLE orders ADD COLUMN refunded_amount DECIMAL(10,2) DEFAULT 0");
}

$method = $_SERVER['REQUEST_METHOD'];
dbg('refund', "$method ".($_GET['order_id']??''));

// GET — refund history for one order
if ($method === 'GET') {
    $oid = $_GET['order_id'] ?? '';
    if (!$oid) fail('Missing order_id');
    $stmt = $pdo->prepare("SELECT * FROM refunds WHERE order_id = ? ORDER BY created_at DESC");
    $stmt->execute([$oid]);
    ok(['refunds' => $stmt->fetchAll()]);
}

if ($method !== 'POST') fail('Method not allowed', 405);

// POST — process a refund (full or partial)
$d      = body();
$oid    = trim($d['order_id'] ?? '');
$amount = round((float)($d['amount'] ?? 0), 2);
$reason = trim($d['reason'] ?? '');

if (!$oid) fail('Missing order_id');
if ($amount <= 0) fail('Refund amount must be greater than zero');
if ($reason === '') fail('A reason is required for every refund');

$stmt = $pdo->prepare("SELECT * FROM orders WHERE id = ? LIMIT 1");
$stmt->execute([$oid]);
$order = $stmt->fetch();
if (!$order) fail('Order not found', 404);

$already   = (float)($order['refunded_amount'] ?? 0);
$remaining = round((float)$order['total'] - $already, 2);
if ($amount > $remaining + 0.005) fail('Refund amount exceeds remaining refundable balance ($'.number_format($remaining, 2).')');

$payMethod      = $order['payment_method'] ?: 'Other';
$isCard         = in_array($payMethod, ['Credit Card', 'Square'], true);
$squareRefundId = null;
$refundStatus   = 'Completed';

if ($isCard) {
    $payId = $order['square_payment_id'] ?? '';
    if (!$payId) fail('This order has no linked Square payment — cannot process an automatic card refund.');

    $secretsPath = dirname(dirname(__DIR__)) . '/secrets.php';
    if (!file_exists($secretsPath)) fail('secrets.php not found — cannot process Square refund.');
    require_once $secretsPath;
    if (!defined('SQUARE_TOKEN') || !SQUARE_TOKEN) fail('SQUARE_TOKEN not configured.');

    $sqMode  = getSetting($pdo, 'square_mode') ?: 'live';
    $baseUrl = ($sqMode === 'test') ? 'https://connect.squareupsandbox.com/v2' : 'https://connect.squareup.com/v2';

    $idempotencyKey = substr(hash('sha256', $oid.'|'.$amount.'|'.uniqid('', true)), 0, 40);
    $sqBody = [
        'idempotency_key' => $idempotencyKey,
        'amount_money'    => ['amount' => (int)round($amount * 100), 'currency' => 'USD'],
        'payment_id'      => $payId,
        'reason'          => substr($reason, 0, 190),
    ];
    $resp = sq_curl($baseUrl.'/refunds', 'POST', $sqBody, SQUARE_TOKEN);

    if (!$resp || !isset($resp['refund'])) {
        $errDetail = $resp['errors'][0]['detail'] ?? 'Unknown Square error';
        applog('REFUND-FAIL', "order=$oid amount=$amount err=".json_encode($resp));
        fail('Square refund failed: '.$errDetail);
    }
    $refund         = $resp['refund'];
    $squareRefundId = $refund['id'] ?? null;
    $refundStatus   = $refund['status'] ?? 'PENDING';
    if ($refundStatus === 'REJECTED' || $refundStatus === 'FAILED') {
        fail('Square rejected the refund (status: '.$refundStatus.').');
    }
}

$pdo->prepare("INSERT INTO refunds (order_id, amount, reason, method, square_refund_id, status, created_at) VALUES (?,?,?,?,?,?,NOW())")
    ->execute([$oid, $amount, $reason, $payMethod, $squareRefundId, $refundStatus]);

$newRefunded = round($already + $amount, 2);
$remaining   = round((float)$order['total'] - $newRefunded, 2);
$newStatus   = ($newRefunded >= (float)$order['total'] - 0.005) ? 'Refunded' : $order['status'];
$pdo->prepare("UPDATE orders SET refunded_amount = ?, status = ? WHERE id = ?")
    ->execute([$newRefunded, $newStatus, $oid]);

applog('refund', "order=$oid amount=$amount method=$payMethod square_id=".($squareRefundId ?: 'n/a'));

$emailResult = sendRefundEmail($pdo, $order, $amount, $reason, $payMethod, $squareRefundId, $newRefunded, $remaining);

ok([
    'message'          => 'Refund processed',
    'refunded_amount'  => $newRefunded,
    'remaining'        => $remaining,
    'status'           => $newStatus,
    'square_refund_id' => $squareRefundId,
    'email_sent'       => $emailResult === true,
]);

// Sends the customer a refund confirmation email; failures here never block the refund itself.
function sendRefundEmail($pdo, $order, $amount, $reason, $payMethod, $squareRefundId, $newRefunded, $remaining) {
    $customerEmail = trim($order['customer_email'] ?? '');
    if (!$customerEmail) return false;

    try {
        require_once dirname(__DIR__) . '/mailer.php';

        $bizName  = bizName($pdo);
        $bizEmail = 'handmadedesignsbysuzi@yahoo.com';
        $bizUrl   = 'https://handmadedesignsbysuzi.com';
        try {
            $raw = getSetting($pdo, 'biz_profile');
            $biz = $raw ? json_decode($raw, true) : null;
            if (!empty($biz['email'])) $bizEmail = $biz['email'];
            if (!empty($biz['website_url'])) $bizUrl = $biz['website_url'];
        } catch (Exception $e) { /* keep fallback */ }
        $bizUrlDisplay = preg_replace('#^https?://#', '', rtrim($bizUrl, '/'));

        $oid       = $order['id'];
        $firstName = htmlspecialchars(explode(' ', trim($order['customer_name'] ?? ''))[0] ?? '');
        $isCard    = in_array($payMethod, ['Credit Card', 'Square'], true);
        $viaLine   = $isCard
            ? 'Refunded to your original card'.($squareRefundId ? ' (Square ref: '.htmlspecialchars($squareRefundId).')' : '')
            : 'Refunded via '.htmlspecialchars($payMethod);
        $balanceLine = $remaining > 0.004
            ? "<div style='margin-top:6px;color:#6b6040;font-size:.85rem'>Remaining order balance: \$".number_format($remaining, 2)."</div>"
            : "<div style='margin-top:6px;color:#2e7d32;font-size:.85rem'>This completes the refund for this order.</div>";

        $subject = "Refund Processed — Order #{$oid}";
        $html = "<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:20px;background:#fffdf0;font-family:Arial,sans-serif'>
<div style='max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:#a07810;padding:28px;text-align:center'>
    <h1 style='color:#fff;margin:0;font-size:1.4rem'>{$bizName}</h1>
    <p style='color:#fdf3d0;margin:.4rem 0 0;font-size:.9rem'>Refund Confirmation</p>
  </div>
  <div style='padding:28px'>
    <p>Hi {$firstName},</p>
    <p>We've processed a refund for your order.</p>
    <div style='background:#fffdf0;border-radius:8px;padding:16px;margin:20px 0;border:1px solid #e8e0b8'>
      <div style='font-size:.7rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:6px'>Order</div>
      <div style='margin-bottom:14px'><strong>#{$oid}</strong></div>
      <div style='font-size:.7rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:6px'>Refund Amount</div>
      <div style='margin-bottom:14px;font-size:1.3rem;font-weight:700;color:#a07810'>\$".number_format($amount, 2)."</div>
      <div style='font-size:.7rem;font-weight:700;text-transform:uppercase;color:#a07810;margin-bottom:6px'>Reason</div>
      <div style='margin-bottom:14px'>".htmlspecialchars($reason)."</div>
      <div style='font-size:.85rem;color:#2d2220'>{$viaLine}</div>
      {$balanceLine}
    </div>
    <p style='color:#6b6040'>If you have any questions about this refund, just reply to this email.</p>
    <p><em style='color:#a07810'>— Susan &#127864;</em></p>
    <div style='margin-top:20px;padding-top:16px;border-top:1px solid #e8e0b8;font-size:.8rem;color:#6b6040;text-align:center'>
      <div>Website: <a href='{$bizUrl}' style='color:#a07810;text-decoration:underline'>{$bizUrlDisplay}</a></div>
      <div>Email: <a href='mailto:{$bizEmail}' style='color:#a07810;text-decoration:underline'>{$bizEmail}</a></div>
    </div>
  </div>
</div></body></html>";

        $result = sendEmail([$customerEmail, $bizEmail], $subject, $html, $bizEmail, $bizName);
        try {
            $pdo->prepare("INSERT INTO email_log (sent_at,email_type,sent_to,order_id,subject,status,email_body) VALUES (CONVERT_TZ(NOW(),'+00:00','-04:00'),?,?,?,?,?,?)")
                ->execute(['Refund Notification', $customerEmail, $oid, $subject, $result === true ? 'sent' : 'failed', $html]);
        } catch (Exception $e) { /* logging failure shouldn't block the refund */ }
        return $result;
    } catch (Exception $e) {
        applog('REFUND-EMAIL-FAIL', 'order='.$order['id'].' err='.$e->getMessage());
        return false;
    }
}
