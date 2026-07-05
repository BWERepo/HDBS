<?php
// api/order_token.php — Signed, self-expiring token that proves the holder controls a given
// customer email, with no session table (stateless). Same HMAC-with-DB_PASS approach as the
// order cancel-token. Used by the customer order-lookup: the account view (issued at login)
// and the guest magic link (issued to the email address only).

require_once __DIR__ . '/config.php';

// Build a token for $email valid for $ttlSeconds.
function makeOrderToken($email, $ttlSeconds) {
    $email   = strtolower(trim($email));
    $expiry  = time() + (int)$ttlSeconds;
    $payload = rtrim(strtr(base64_encode($email . '|' . $expiry), '+/', '-_'), '=');
    $sig     = substr(hash_hmac('sha256', $payload, DB_PASS), 0, 32);
    return $payload . '.' . $sig;
}

// Returns the lowercase email if the token's signature is valid and it hasn't expired; else null.
function verifyOrderToken($token) {
    $token = (string)$token;
    $dot   = strrpos($token, '.');
    if ($dot === false) return null;
    $payload  = substr($token, 0, $dot);
    $sig      = substr($token, $dot + 1);
    $expected = substr(hash_hmac('sha256', $payload, DB_PASS), 0, 32);
    if (!hash_equals($expected, $sig)) return null;
    $raw = base64_decode(strtr($payload, '-_', '+/'));
    if ($raw === false || strpos($raw, '|') === false) return null;
    list($email, $expiry) = explode('|', $raw, 2);
    if ((int)$expiry < time()) return null;
    return strtolower(trim($email));
}
