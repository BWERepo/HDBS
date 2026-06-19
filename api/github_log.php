<?php
// api/github_log.php — Fetch GitHub commit history with file counts
require_once __DIR__ . '/config.php';
cors();

$pdo = db();
requireAdmin();

function getSetting($pdo, $key) {
    $s = $pdo->prepare("SELECT value FROM settings WHERE key_name = ?");
    $s->execute([$key]);
    $r = $s->fetch();
    return $r ? $r['value'] : null;
}

$token  = getSetting($pdo, 'github_token') ?: '';
$owner  = 'C177LVR';
$repo   = 'HandmadeDesignsBySuzi';
$count  = 30;

$cacheFile = sys_get_temp_dir() . '/hdbs_github_log.json';
$cacheTTL  = 600; // 10 minutes

if (file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $cacheTTL) {
    header('Content-Type: application/json');
    echo file_get_contents($cacheFile);
    exit;
}

function ghRequest($url, $token) {
    $ch = curl_init($url);
    $headers = ['Accept: application/vnd.github+json', 'User-Agent: HandmadeDesignsBySuzi'];
    if ($token) $headers[] = 'Authorization: Bearer ' . $token;
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$code, json_decode($body, true)];
}

// Fetch commit list
[$code, $commits] = ghRequest(
    "https://api.github.com/repos/$owner/$repo/commits?per_page=$count",
    $token
);

if ($code !== 200 || !is_array($commits)) {
    http_response_code(502);
    echo json_encode(['error' => 'GitHub API error', 'code' => $code]);
    exit;
}

// Fetch file counts in parallel via curl_multi
$mh      = curl_multi_init();
$handles = [];
foreach ($commits as $i => $c) {
    $sha = $c['sha'];
    $ch  = curl_init("https://api.github.com/repos/$owner/$repo/commits/$sha");
    $headers = ['Accept: application/vnd.github+json', 'User-Agent: HandmadeDesignsBySuzi'];
    if ($token) $headers[] = 'Authorization: Bearer ' . $token;
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    curl_multi_add_handle($mh, $ch);
    $handles[$i] = $ch;
}

$running = null;
do { curl_multi_exec($mh, $running); curl_multi_select($mh); } while ($running > 0);

$details = [];
foreach ($handles as $i => $ch) {
    $body = curl_multi_getcontent($ch);
    $d    = json_decode($body, true);
    $details[$i] = $d;
    curl_multi_remove_handle($mh, $ch);
}
curl_multi_close($mh);

// Build result
$results = [];
foreach ($commits as $i => $c) {
    $d     = $details[$i] ?? [];
    $files = isset($d['files']) ? count($d['files']) : null;
    $msg   = trim($c['commit']['message'] ?? '');
    // First line only for display
    $lines = explode("\n", $msg);
    $results[] = [
        'sha'     => substr($c['sha'], 0, 7),
        'date'    => $c['commit']['author']['date'] ?? '',
        'message' => $lines[0],
        'files'   => $files,
        'url'     => $c['html_url'] ?? '',
    ];
}

$out = json_encode(['commits' => $results]);
file_put_contents($cacheFile, $out);
header('Content-Type: application/json');
echo $out;
