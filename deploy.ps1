# Deploy to Hostinger via FTP
# Usage: .\deploy.ps1 path/to/file.php    (deploy single file)
#        .\deploy.ps1                      (deploy all files)

$creds = @{}
Get-Content "$PSScriptRoot\.ftp-credentials" | ForEach-Object {
    if ($_ -match "^(\w+)=(.+)$") { $creds[$Matches[1]] = $Matches[2] }
}
$ftpHost  = $creds["FTP_HOST"]
$ftpUser  = $creds["FTP_USER"]
$ftpPass  = $creds["FTP_PASS"]
$ftpPort  = $creds["FTP_PORT"]
$local    = $PSScriptRoot
$apiBase  = "https://handmadedesignsbysuzi.com/api"

$exclude = @(".git",".ftp-credentials","deploy.ps1","CLAUDE.md","README.md","node_modules","product_images","secrets.php")

function Should-Exclude($path) {
    foreach ($ex in $exclude) {
        if ((Split-Path $path -Leaf) -like $ex) { return $true }
        if ($path -like "*\$ex\*") { return $true }
    }
    return $false
}

function Deploy-File($rel) {
    $localPath = Join-Path $local $rel
    $remotePath = ($rel -replace "\\", "/")
    $url = "ftp://${ftpHost}:${ftpPort}/${remotePath}"
    Write-Host "Uploading $rel ..." -ForegroundColor Cyan
    $out = & curl.exe --ftp-create-dirs -u "${ftpUser}:${ftpPass}" -T $localPath $url 2>&1
    if ($LASTEXITCODE -eq 0) { Write-Host "  OK" -ForegroundColor Green }
    else { Write-Host "  FAILED: $out" -ForegroundColor Red }
}

function Log-Deploy($fileList, $mode) {
    try {
        $normalized = @($fileList | ForEach-Object { $_ -replace '\\','/' })
        $body = @{ files = $normalized; count = $normalized.Count; mode = $mode } | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri "$apiBase/deploy_log.php" -Method Post -Body $body -ContentType "application/json" | Out-Null
    } catch {}
}

# Single file mode
if ($args.Count -gt 0) {
    Deploy-File $args[0]
    Log-Deploy @($args[0]) 'single'
    exit
}

# Full deploy
Write-Host "Deploying all files to $ftpHost ..." -ForegroundColor Yellow
$files = Get-ChildItem -Path $local -Recurse -File | Where-Object { -not (Should-Exclude $_.FullName) }
$i = 0
$deployed = @()
foreach ($file in $files) {
    $i++
    $rel = $file.FullName.Substring($local.Length + 1)
    Write-Progress -Activity "Deploying" -Status "$i of $($files.Count): $rel" -PercentComplete (($i/$files.Count)*100)
    Deploy-File $rel
    $deployed += $rel
}
Log-Deploy $deployed 'full'
Write-Host "Deploy complete." -ForegroundColor Green
