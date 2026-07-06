<?php
// api/github_log.php — Fetch GitHub commit history with file counts
require_once __DIR__ . '/config.php';
cors();

$pdo = db();
requireAdmin();

// getSetting defined in config.php

$token  = getSetting($pdo, 'github_token') ?: '';
$owner   = 'BWERepo';
$repo    = 'HDBS';
$perPage = 100;

$cacheFile = sys_get_temp_dir() . '/hdbs_github_log.json';
$cacheTTL  = 600; // 10 minutes
$noCache   = !empty($_GET['refresh']); // Refresh button bypasses the cache

if (!$noCache && file_exists($cacheFile) && (time() - filemtime($cacheFile)) < $cacheTTL) {
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

// Fetch the full commit list, paginating until exhausted
$commits = [];
$page    = 1;
do {
    [$code, $batch] = ghRequest(
        "https://api.github.com/repos/$owner/$repo/commits?per_page=$perPage&page=$page",
        $token
    );
    if ($code !== 200 || !is_array($batch)) {
        if ($page === 1) {
            http_response_code(502);
            echo json_encode(['error' => 'GitHub API error', 'code' => $code]);
            exit;
        }
        break; // partial failure on a later page — keep what we have
    }
    $commits = array_merge($commits, $batch);
    $page++;
    if (count($batch) < $perPage) break; // last page reached
} while ($page <= 50); // safety cap: 5000 commits

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
    $results[] = [
        'sha'     => substr($c['sha'], 0, 7),
        'date'    => $c['commit']['author']['date'] ?? '',
        'message' => $msg,
        'files'   => $files,
        'url'     => $c['html_url'] ?? '',
    ];
}

// Total commit count — read the Link header's rel="last" page from a per_page=1 request
function ghTotalCommits($owner, $repo, $token) {
    $ch = curl_init("https://api.github.com/repos/$owner/$repo/commits?per_page=1");
    $headers = ['Accept: application/vnd.github+json', 'User-Agent: HandmadeDesignsBySuzi'];
    if ($token) $headers[] = 'Authorization: Bearer ' . $token;
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 10,
        CURLOPT_HEADER         => true,
        CURLOPT_NOBODY         => false,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    $resp  = curl_exec($ch);
    $hsize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    if ($resp === false) return null;
    $hdr = substr($resp, 0, $hsize);
    if (preg_match('/[?&]page=(\d+)>;\s*rel="last"/', $hdr, $m)) return (int)$m[1];
    return null; // single page → fall back on client side
}
$totalCommits = ghTotalCommits($owner, $repo, $token);

$out = json_encode(['commits' => $results, 'total_commits' => $totalCommits]);
file_put_contents($cacheFile, $out);
header('Content-Type: application/json');
echo $out;
