<?php
// api/square-webhook.php — Auto-updates order status when Square payment completes

require_once __DIR__ . '/config.php';

// ── Verify Square signature ──
$signature_key = 'FjK9QJMJbxQI9tht0ZaPyQ';
$callback_url  = 'https://handmadedesignsbysuzi.com/api/square-webhook.php';

$payload   = file_get_contents('php://input');
$sq_sig    = $_SERVER['HTTP_X_SQUARE_HMACSHA256_SIGNATURE'] ?? '';

if ($sq_sig) {
    $expected = base64_encode(hash_hmac('sha256', $callback_url . $payload, $signature_key, true));
    if (!hash_equals($expected, $sq_sig)) {
        http_response_code(403);
        exit('Invalid signature');
    }
}

$event = json_decode($payload, true);
if (empty($event['type'])) {
    http_response_code(400);
    exit('Missing event type');
}

// Only handle payment.updated where status is COMPLETED
if ($event['type'] === 'payment.updated') {
    $payment = $event['data']['object']['payment'] ?? null;

    if ($payment && $payment['status'] === 'COMPLETED') {
        $pdo = db();

        // Extract order ID from the note (we pass "Order ORD-XXXX" as the line item name)
        $order_id = null;

        // Try all possible note fields Square might return
        $note_fields = [
            $payment['note'] ?? '',
            $payment['payment_note'] ?? '',
            $event['data']['object']['payment']['note'] ?? '',
        ];
        foreach ($note_fields as $note_val) {
            if (!empty($note_val) && preg_match('/Order\s+([\w\-]+)/i', $note_val, $m)) {
                $order_id = $m[1];
                break;
            }
        }
        // Try Square order line items via Orders API
        if (!$order_id && !empty($event['data']['object']['payment']['order_id'])) {
            $sq_order_id = $event['data']['object']['payment']['order_id'];
            // Search our orders table for a match by amount
            $amount_cents = $payment['amount_money']['amount'] ?? 0;
            $amount_dollars = $amount_cents / 100;
            $stmt = $pdo->prepare("SELECT id FROM orders WHERE ABS(total - ?) < 0.01 AND status NOT IN ('Paid','Cancelled') ORDER BY created_at DESC LIMIT 1");
            $stmt->execute([$amount_dollars]);
            $row = $stmt->fetch();
            if ($row) $order_id = $row['id'];
        }

        // Try line items if note didn't have it
        if (!$order_id && !empty($payment['order_id'])) {
            // Look up via Square order ID if stored
            $stmt = $pdo->prepare("SELECT id FROM orders WHERE square_payment_id = ?");
            $stmt->execute([$payment['order_id']]);
            $row = $stmt->fetch();
            if ($row) $order_id = $row['id'];
        }

        if ($order_id) {
            // Update order status to Paid and store Square payment ID
            // Extract tax from Square payment
            $tax_cents = $payment['total_tax_money']['amount'] ?? 0;
            $tax_dollars = $tax_cents / 100;
            $stmt = $pdo->prepare("UPDATE orders SET status = 'Paid', square_payment_id = ?, tax_amount = ? WHERE id = ? AND status != 'Paid'");
            $stmt->execute([$payment['id'], $tax_dollars, $order_id]);

            $dt = new DateTime('now', new DateTimeZone('America/New_York'));
            $log = $dt->format('Y-m-d g:i A') . ' EDT' . " | PAID | Order: {$order_id} | Square: {$payment['id']}\n";
        } else {
            $dt = new DateTime('now', new DateTimeZone('America/New_York'));
            $log = $dt->format('Y-m-d g:i A') . ' EDT' . " | COMPLETED but no order ID found | Square: {$payment['id']} | Note: " . ($payment['note'] ?? 'none') . "\n";
        }

        file_put_contents(__DIR__ . '/../webhook_log.txt', $log, FILE_APPEND | LOCK_EX);
    }
}

http_response_code(200);
echo 'OK';
