# Deploy to Hostinger via FTP
# Usage: .\deploy.ps1 path/to/file.php          (deploy single file to PRODUCTION)
#        .\deploy.ps1                           (deploy all files to PRODUCTION)
#        .\deploy.ps1 -staging path/to/file     (deploy single file to STAGING subdomain)
#        .\deploy.ps1 -staging                  (deploy all files to STAGING)
param(
    [switch]$staging,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Files
)

$creds = @{}
Get-Content "$PSScriptRoot\.ftp-credentials" | ForEach-Object {
    if ($_ -match "^(\w+)=(.+)$") { $creds[$Matches[1]] = $Matches[2] }
}
$ftpHost  = $creds["FTP_HOST"]
$ftpUser  = $creds["FTP_USER"]
$ftpPass  = $creds["FTP_PASS"]
$ftpPort  = $creds["FTP_PORT"]
$local    = $PSScriptRoot

# ── Environment routing ── (staging is a subfolder of the same public_html)
$Environment = if ($staging) { 'staging' } else { 'prod' }
if ($Environment -eq 'staging') {
    $remotePrefix = 'staging/'
    $apiBase      = 'https://staging.handmadedesignsbysuzi.com/api'
} else {
    $remotePrefix = ''
    $apiBase      = 'https://handmadedesignsbysuzi.com/api'
}

$exclude = @(".git",".gitignore",".gitattributes",".ftp-credentials","deploy.ps1","watch.ps1","CLAUDE.md","README.md","node_modules","product_images","business_logo","secrets.php","secrets.staging.php","debug.php","debug.flag","drop_tn_tax.php","fix_tax.php","sq_test.php","run_tests.html","reset_nav.php","default.php","get_products.php")
# Staging keeps its own .htaccess (Basic Auth + noindex) — never overwrite it from a deploy
if ($Environment -eq 'staging') { $exclude += '.htaccess' }

function Should-Exclude($path) {
    foreach ($ex in $exclude) {
        if ((Split-Path $path -Leaf) -like $ex) { return $true }
        if ($path -like "*\$ex\*") { return $true }
    }
    return $false
}

function Deploy-File($rel) {
    $localPath = Join-Path $local $rel
    $remotePath = $remotePrefix + ($rel -replace "\\", "/")
    $url = "ftp://${ftpHost}:${ftpPort}/${remotePath}"
    Write-Host "Uploading $rel -> $remotePath ..." -ForegroundColor Cyan
    $out = & curl.exe --ftp-create-dirs -u "${ftpUser}:${ftpPass}" -T $localPath $url 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Host "  OK" -ForegroundColor Green }
    else { Write-Host "  FAILED: $out" -ForegroundColor Red }
}

function Delete-FtpFile($rel) {
    $remotePath = $remotePrefix + ($rel -replace "\\", "/")
    $url = "ftp://${ftpHost}:${ftpPort}/${remotePath}"
    Write-Host "Deleting $rel ..." -ForegroundColor Yellow
    $out = & curl.exe -u "${ftpUser}:${ftpPass}" -Q "DELE $remotePath" $url 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Host "  OK" -ForegroundColor Green }
    else { Write-Host "  FAILED (may not exist): $out" -ForegroundColor DarkYellow }
}

function Log-Deploy($fileList, $mode) {
    try {
        $normalized = @($fileList | ForEach-Object { $_ -replace '\\','/' })
        $body = @{ files = $normalized; count = $normalized.Count; mode = $mode } | ConvertTo-Json -Compress
        $resp = Invoke-RestMethod -Uri "$apiBase/deploy_log.php" -Method Post -Body $body -ContentType "application/json"
        if ($resp.version) {
            Write-Host "  Version at deploy: $($resp.version)" -ForegroundColor DarkGray
        }
    } catch {}
}

Write-Host "Target: $Environment" -ForegroundColor Magenta

# Single / explicit file mode
if ($Files -and $Files.Count -gt 0) {
    foreach ($f in $Files) { Deploy-File $f }
    Log-Deploy $Files 'single'
    exit
}

# Full deploy
Write-Host "Deploying all files to $ftpHost ($Environment) ..." -ForegroundColor Yellow
$srcFiles = Get-ChildItem -Path $local -Recurse -File | Where-Object { -not (Should-Exclude $_.FullName) }
$i = 0
$deployed = @()
foreach ($file in $srcFiles) {
    $i++
    $rel = $file.FullName.Substring($local.Length + 1)
    Write-Progress -Activity "Deploying" -Status "$i of $($srcFiles.Count): $rel" -PercentComplete (($i/$srcFiles.Count)*100)
    Deploy-File $rel
    $deployed += $rel
}
Log-Deploy $deployed 'full'
Write-Host "Deploy complete ($Environment)." -ForegroundColor Green
