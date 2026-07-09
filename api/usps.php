<?php
// api/usps.php — Shared USPS Tracking API (v3) helpers. Same shape as api/paypal.php:
// OAuth2 client-credentials, raw cURL, credentials live in secrets.php / secrets.staging.php
// (never the browser). Unlike PayPal, USPS has no sandbox tracking data reachable with this
// app's product tier (TEM requires a separate product grant this app doesn't have) — this is
// a read-only lookup with no side effects, so both staging and prod call the real USPS API.
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/applog.php';

function usps_api_base() {
    return 'https://apis.usps.com';
}

// Returns [consumerKey, consumerSecret] from secrets.php, or ['',''] if not configured
// or still holding the placeholder value.
function usps_creds() {
    $key    = defined('USPS_CONSUMER_KEY')    ? USPS_CONSUMER_KEY    : '';
    $secret = defined('USPS_CONSUMER_SECRET') ? USPS_CONSUMER_SECRET : '';
    if (strpos($key, '_HERE') !== false || strpos($secret, '_HERE') !== false) return ['', ''];
    return [$key, $secret];
}

function usps_configured() {
    list($key, $secret) = usps_creds();
    return $key !== '' && $secret !== '';
}

// OAuth2 client-credentials token. Returns the access token string, or null on failure.
function usps_token() {
    list($key, $secret) = usps_creds();
    if (!$key || !$secret) { applog('USPS-TOKEN-FAIL', 'missing credentials'); return null; }

    $ch = curl_init(usps_api_base() . '/oauth2/v3/token');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_POST           => true,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS     => json_encode([
            'client_id'     => $key,
            'client_secret' => $secret,
            'grant_type'    => 'client_credentials',
        ]),
    ]);
    $raw    = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($err) { applog('USPS-TOKEN-FAIL', "curl=$err"); return null; }
    $j = json_decode($raw, true);
    if ($status !== 200 || empty($j['access_token'])) {
        applog('USPS-TOKEN-FAIL', "status=$status body=".substr($raw ?: '', 0, 300));
        return null;
    }
    return $j['access_token'];
}

// Looks up a single tracking number against USPS's live system.
// Returns:
//   ['ok'=>true,  'found'=>true,  'status'=>'Delivered', 'statusCategory'=>'Delivered']
//   ['ok'=>true,  'found'=>false, 'message'=>'...']              — USPS doesn't recognize the number
//   ['ok'=>false, 'error'=>'not_configured'|'auth_failed'|'network_error']
function usps_track_number($trackingNumber) {
    if (!usps_configured()) return ['ok' => false, 'error' => 'not_configured'];

    $token = usps_token();
    if (!$token) return ['ok' => false, 'error' => 'auth_failed'];

    $num = rawurlencode(trim($trackingNumber));
    $ch = curl_init(usps_api_base() . "/tracking/v3/tracking/{$num}?expand=DETAIL");
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $token],
    ]);
    $raw    = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($err) { applog('USPS-TRACK-FAIL', "curl=$err"); return ['ok' => false, 'error' => 'network_error']; }

    $j = json_decode($raw, true);
    if ($status === 200 && $j && !empty($j['trackingNumber'])) {
        return [
            'ok'             => true,
            'found'          => true,
            'status'         => $j['status'] ?? '',
            'statusCategory' => $j['statusCategory'] ?? '',
        ];
    }
    // USPS returns 4xx with an error body for unrecognized/invalid tracking numbers.
    if ($status >= 400 && $status < 500) {
        $msg = '';
        if ($j) $msg = $j['error']['message'] ?? $j['message'] ?? '';
        return ['ok' => true, 'found' => false, 'message' => $msg ?: 'Not found in USPS\'s system'];
    }
    applog('USPS-TRACK-FAIL', "status=$status body=".substr($raw ?: '', 0, 300));
    return ['ok' => false, 'error' => 'network_error'];
}
