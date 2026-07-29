# Watch for file changes and auto-deploy to Hostinger.
#
# Usage: .\watch.ps1           → auto-deploy to STAGING (default)
#        .\watch.ps1 -Prod     → auto-deploy to PRODUCTION (asks for confirmation first)
#
# ⚠️ THIS SCRIPT USED TO BE HARDCODED TO PRODUCTION with no staging mode at all, which meant a
# stray Ctrl+S published straight to the live storefront — and it fires on file CREATION too, so
# generated files counted. It now defaults to staging. During the Cloudflare migration the whole
# point is that production changes only at the deliberate cutover, so -Prod should essentially
# never be used.
param([switch]$Prod)

$creds = @{}
Get-Content "$PSScriptRoot\.ftp-credentials" | ForEach-Object {
    if ($_ -match "^(\w+)=(.+)$") { $creds[$Matches[1]] = $Matches[2] }
}
$ftpHost = $creds["FTP_HOST"]
$ftpUser = $creds["FTP_USER"]
$ftpPass = $creds["FTP_PASS"]
$ftpPort = $creds["FTP_PORT"]
$local   = $PSScriptRoot

if ($Prod) {
    Write-Host "WARNING: this will auto-deploy every save to PRODUCTION (handmadedesignsbysuzi.com)." -ForegroundColor Red
    $answer = Read-Host "Type PRODUCTION to confirm"
    if ($answer -cne 'PRODUCTION') { Write-Host "Aborted." -ForegroundColor Yellow; exit 1 }
    $remotePrefix = ''
    $apiBase      = "https://handmadedesignsbysuzi.com/api"
    $envName      = 'PRODUCTION'
} else {
    $remotePrefix = 'staging/'
    $apiBase      = "https://staging.handmadedesignsbysuzi.com/api"
    $envName      = 'staging'
}

# Exclusions and Should-Exclude live in one shared file so deploy.ps1 and watch.ps1 cannot drift.
# They previously had separate hand-maintained lists, and watch.ps1's was missing
# secrets.staging.php, business_logo and .gitignore.
. "$PSScriptRoot\scripts\deploy-exclude.ps1"

# Staging keeps its own .htaccess (Basic Auth + noindex) — never overwrite it
if (-not $Prod) { $exclude += '.htaccess' }

function Deploy-File($rel) {
    $localPath  = Join-Path $local $rel
    $remotePath = $remotePrefix + ($rel -replace "\\", "/")
    $url = "ftp://${ftpHost}:${ftpPort}/${remotePath}"
    Write-Host "[$([datetime]::Now.ToString('HH:mm:ss'))] Deploying $rel -> $envName ..." -ForegroundColor Cyan
    $out = & curl.exe --ftp-create-dirs -u "${ftpUser}:${ftpPass}" -T $localPath $url 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  OK" -ForegroundColor Green
        # Only production carries the site version; staging deliberately skips the bump.
        if ($Prod -and $rel -like '*regression_test.php') {
            try {
                $body = @{action='increment_minor_version'} | ConvertTo-Json -Compress
                $json = Invoke-RestMethod -Uri "$apiBase/admin.php" -Method Post -Body $body -ContentType "application/json"
                Write-Host "  Version incremented to $($json.version)" -ForegroundColor Cyan
            } catch {}
        }
    } else {
        Write-Host "  FAILED: $out" -ForegroundColor Red
    }
}

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $local
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]::LastWrite

# Debounce: track last deploy time per file
$lastDeploy = @{}
$debounceMs = 800

$onChange = {
    $path = $Event.SourceEventArgs.FullPath
    $rel  = $path.Substring($local.Length + 1)

    if (Should-Exclude $path) { return }
    if (-not (Test-Path $path -PathType Leaf)) { return }

    $now = [datetime]::UtcNow
    if ($lastDeploy.ContainsKey($rel)) {
        $elapsed = ($now - $lastDeploy[$rel]).TotalMilliseconds
        if ($elapsed -lt $debounceMs) { return }
    }
    $lastDeploy[$rel] = $now

    Deploy-File $rel
}

Register-ObjectEvent $watcher Changed -Action $onChange | Out-Null
Register-ObjectEvent $watcher Created -Action $onChange | Out-Null

$color = if ($Prod) { 'Red' } else { 'Yellow' }
Write-Host "Target: $envName" -ForegroundColor $color
Write-Host "Watching $local for changes. Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host "Excluded: $($exclude -join ', ')" -ForegroundColor DarkGray
Write-Host ""

try {
    while ($true) { Start-Sleep -Seconds 1 }
} finally {
    $watcher.EnableRaisingEvents = $false
    $watcher.Dispose()
    Get-EventSubscriber | Unregister-Event
    Write-Host "Watcher stopped." -ForegroundColor Yellow
}
