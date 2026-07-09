<?php
// api/repo_stats.php — Live repo stats for the Change History header.
// Scans the live deployment directory: total files, code-file count,
// lines of code, and the deployment (server) path. Admin-gated.
require_once __DIR__ . '/config.php';
cors();
$pdo = db();
requireAdmin();

$root     = dirname(__DIR__); // public_html — the deployment root
$codeExt  = ['php', 'js', 'css', 'html'];
$skipDirs = ['.git', 'node_modules'];

// GitHub Repo is admin-editable (Developer > Settings > Environment card), stored as "owner/repo"
$repoName = 'BWERepo/HDBS';
$devEnvRaw = getSetting($pdo, 'dev_env');
if ($devEnvRaw) {
    $devEnv = json_decode($devEnvRaw, true);
    if (!empty($devEnv['github_repo'])) $repoName = $devEnv['github_repo'];
}

$totalFiles = 0;
$codeFiles  = 0;
$loc        = 0;

try {
    $dirIt  = new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS);
    $filter = new RecursiveCallbackFilterIterator($dirIt, function ($current) use ($skipDirs) {
        if ($current->isDir() && in_array($current->getFilename(), $skipDirs, true)) return false;
        return true;
    });
    $rii = new RecursiveIteratorIterator($filter, RecursiveIteratorIterator::LEAVES_ONLY);
    foreach ($rii as $file) {
        if (!$file->isFile()) continue;
        $totalFiles++;
        if (in_array(strtolower($file->getExtension()), $codeExt, true)) {
            $codeFiles++;
            $h = @fopen($file->getPathname(), 'r');
            if ($h) {
                while (fgets($h) !== false) { $loc++; }
                fclose($h);
            }
        }
    }
} catch (Exception $e) {
    fail('Scan error: ' . $e->getMessage(), 500);
}

ok([
    'repo'          => $repoName,
    'path'          => $root,
    'total_files'   => $totalFiles,
    'code_files'    => $codeFiles,
    'lines_of_code' => $loc,
]);
