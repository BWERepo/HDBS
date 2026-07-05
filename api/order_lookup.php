<?php
// api/order_lookup.php — Customer order lookup (no admin).
//   action=request {email}  -> emails a private link to view orders. Response is ALWAYS generic
//                              (never reveals whether the email has orders — no enumeration).
//   action=view    {token}  -> returns the orders for the email encoded in a valid token.
// The account page uses action=view with the token issued at login; guests get a token by email.
ini_set('display_errors', 0);

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/order_token.php';
cors();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Method not allowed', 405);

$d      = body();
$action = $d['action'] ?? '';
$pdo    = db();

if ($action === 'request') {
    $email = strtolower(trim($d['email'] ?? ''));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('Please enter a valid email address.');

    // Rate limit: max 5 link requests per email per 15 min, so this can't be used to spam inboxes.
    $pdo->exec("CREATE TABLE IF NOT EXISTS order_lookup_requests (email_hash CHAR(32) PRIMARY KEY, attempts INT NOT NULL DEFAULT 0, last_at BIGINT NOT NULL DEFAULT 0)");
    $eHash = md5($email);
    $now   = time();
    $rr    = $pdo->prepare("SELECT attempts,last_at FROM order_lookup_requests WHERE email_hash=?");
    $rr->execute([$eHash]);
    $row = $rr->fetch();
    $windowOpen = $row && ($now - (int)$row['last_at']) < 900;
    if ($windowOpen && (int)$row['attempts'] >= 5) {
        // Still generic — don't reveal the rate limit either.
        ok(['message' => "If we found orders for that email, we've emailed a link to view them."]);
    }
    $attempts = $windowOpen ? (int)$row['attempts'] + 1 : 1;
    $pdo->prepare("INSERT INTO order_lookup_requests (email_hash,attempts,last_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE attempts=?,last_at=?")
        ->execute([$eHash, $attempts, $now, $attempts, $now]);

    // Only actually send if orders exist for that email — but the response is identical either way.
    $chk = $pdo->prepare("SELECT COUNT(*) FROM orders WHERE LOWER(customer_email)=?");
    $chk->execute([$email]);
    if ((int)$chk->fetchColumn() > 0) {
        $token = makeOrderToken($email, 2700); // 45 minutes
        $link  = ALLOWED_ORIGIN . '/?orders=' . urlencode($token);  // staging→staging, prod→prod
        sendOrderLookupEmail($pdo, $email, $link);
    }
    ok(['message' => "If we found orders for that email, we've emailed a link to view them."]);
}

if ($action === 'view') {
    $email = verifyOrderToken($d['token'] ?? '');
    if (!$email) fail('This link is invalid or has expired. Please request a new one.', 403);
    ok(['orders' => customerOrders($pdo, $email), 'email' => $email]);
}

fail('Unknown action');

// All orders for one email, trimmed to a customer-safe shape (only their own data).
function customerOrders($pdo, $email) {
    $stmt = $pdo->prepare("SELECT * FROM orders WHERE LOWER(customer_email)=? ORDER BY created_at DESC");
    $stmt->execute([$email]);
    $orders = $stmt->fetchAll();
    if (!$orders) return [];

    $ids = array_column($orders, 'id');
    $ph  = implode(',', array_fill(0, count($ids), '?'));
    $it  = $pdo->prepare("SELECT * FROM order_items WHERE order_id IN ($ph)");
    $it->execute($ids);
    $itemMap = [];
    foreach ($it->fetchAll() as $row) {
        $itemMap[$row['order_id']][] = ['id'=>$row['product_id'], 'name'=>$row['product_name'], 'price'=>(float)$row['price'], 'q'=>(int)$row['quantity']];
    }

    $out = [];
    foreach ($orders as $o) {
        $items    = $itemMap[$o['id']] ?? [];
        $shipping = 0;
        foreach ($items as $x) { if ($x['id'] === '_ship') $shipping = (float)$x['price']; }
        $lineItems = array_values(array_filter($items, function($x){ return $x['id'] !== '_ship'; }));
        $out[] = [
            'id'       => $o['id'],
            'date'     => $o['order_date'] ? date('n/j/Y', strtotime($o['order_date'])) : '',
            'status'   => $o['status'],
            'total'    => (float)$o['total'],
            'tax'      => (float)($o['tax_amount'] ?? 0),
            'shipping' => $shipping,
            'pay'      => $o['payment_method'],
            'carrier'  => $o['shipping_carrier'] ?? '',
            'tracking' => $o['tracking_number'] ?? '',
            'refunded' => (float)($o['refunded_amount'] ?? 0),
            'addr'     => $o['shipping_address'],
            'items'    => array_map(function($x){ return ['name'=>$x['name'], 'price'=>$x['price'], 'q'=>$x['q']]; }, $lineItems),
        ];
    }
    return $out;
}

// Emails the private view-orders link. Failures never surface (response stays generic).
function sendOrderLookupEmail($pdo, $email, $link) {
    try {
        require_once dirname(__DIR__) . '/mailer.php';
        $biz = bizName($pdo);
        $link = htmlspecialchars($link);
        $html = "<!DOCTYPE html><html><body style='margin:0;padding:20px;background:#fffdf0;font-family:Arial,sans-serif'>
<div style='max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:#2d2220;padding:22px 28px'><h1 style='color:#d4a017;margin:0;font-size:1.35rem'>{$biz}</h1></div>
  <div style='padding:28px'>
    <h2 style='color:#a07810;margin-top:0'>View your orders</h2>
    <p>Someone (hopefully you) asked to see the orders placed with this email address. Click below to view them:</p>
    <p style='text-align:center;margin:26px 0'>
      <a href='{$link}' style='background:#d4a017;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:700;display:inline-block'>View My Orders</a>
    </p>
    <p style='font-size:.85rem;color:#6b6040'>This link expires in 45 minutes. If you didn't request it, you can safely ignore this email — no one can see your orders without it.</p>
  </div>
  <div style='background:#2d2220;padding:14px 28px;text-align:center'>
    <div style='color:rgba(255,255,255,.6);font-size:.78rem'>{$biz} &bull; Knoxville, TN &bull; <a href='https://handmadedesignsbysuzi.com' style='color:#d4a017'>handmadedesignsbysuzi.com</a></div>
  </div>
</div></body></html>";
        @sendEmail([$email], 'View your ' . $biz . ' orders', $html, 'handmadedesignsbysuzi@yahoo.com', $biz);
    } catch (Exception $e) { /* never surface — response is generic */ }
}
