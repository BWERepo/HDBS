<?php
// api/validate_tracking.php — Admin-only: real USPS lookup for one or more tracking numbers
// (client-side format checks already cover UPS/FedEx/Other; only USPS has a live API here).
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/usps.php';
cors();
requireAdmin();

$data    = json_decode(file_get_contents('php://input'), true) ?: [];
$carrier = trim($data['carrier'] ?? '');
$numbers = is_array($data['numbers'] ?? null) ? $data['numbers'] : [];
$numbers = array_values(array_filter(array_map('trim', $numbers)));

if ($carrier !== 'USPS') fail('Only USPS supports live validation', 400);
if (empty($numbers)) fail('No tracking numbers provided', 400);
if (!usps_configured()) {
    ok(['configured' => false, 'results' => []]);
}

$results = [];
foreach (array_slice($numbers, 0, 10) as $num) { // sane cap per request
    $results[] = array_merge(['number' => $num], usps_track_number($num));
}

ok(['configured' => true, 'results' => $results]);
