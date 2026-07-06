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
    'repo'          => 'BWERepo/HDBS',
    'path'          => $root,
    'total_files'   => $totalFiles,
    'code_files'    => $codeFiles,
    'lines_of_code' => $loc,
]);
