# Handmade Designs By Suzi - daily backup
# Standalone script (no Claude Code / subscription dependency) for Windows Task Scheduler.
# Produces a timestamped DB dump (.sql) and full repo zip (.zip) in Z:\Backup\Websites\HDBS\Backup\

$ErrorActionPreference = "Stop"
$logFile = "Z:\Backup\Websites\HDBS\Backup\backup_hdbs.log"

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -LiteralPath $logFile -Value $line
}

try {
    $timestamp = Get-Date -Format "yyyyMMddHHmm"

    # --- Step 1: database dump ---
    Import-Module CredentialManager
    $cred = Get-StoredCredential -Target "HDBS-Backup-Token"
    if ($null -eq $cred) {
        throw "No 'HDBS-Backup-Token' credential found in Windows Credential Manager. Store it with New-StoredCredential before retrying."
    }
    $rawToken = $cred.GetNetworkCredential().Password
    $sqlOutFile = "Z:\Backup\Websites\HDBS\Backup\${timestamp}HDBS.sql"
    $uri = "https://handmadedesignsbysuzi.com/api/db_backup.php?download=1&token=$([uri]::EscapeDataString($rawToken))"

    Invoke-WebRequest -Uri $uri -OutFile $sqlOutFile -TimeoutSec 120
    Remove-Variable rawToken, uri

    $firstLine = Get-Content -LiteralPath $sqlOutFile -TotalCount 1
    if (-not $firstLine.StartsWith("-- Handmade Designs By Suzi")) {
        throw "Database dump looks invalid (first line: $firstLine). Token may be stale, or api/db_backup.php?download=1 may not be deployed."
    }
    Write-Log "OK: DB dump written to $sqlOutFile"

    # --- Step 2: repo zip ---
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $repoRoot = "Z:\Backup\Websites\HandmadeDesignsBySuzi"
    $zipOutFile = "Z:\Backup\Websites\HDBS\Backup\${timestamp}HDBS.zip"
    if (Test-Path -LiteralPath $zipOutFile) { Remove-Item -LiteralPath $zipOutFile -Force }

    $zip = [System.IO.Compression.ZipFile]::Open($zipOutFile, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem -LiteralPath $repoRoot -Recurse -File -Force -ErrorAction SilentlyContinue |
            ForEach-Object {
                $relative = $_.FullName.Substring($repoRoot.Length + 1)
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                    $zip, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
            }
    } finally {
        $zip.Dispose()
    }
    Write-Log "OK: repo zip written to $zipOutFile"
    Write-Log "Backup run complete: $sqlOutFile, $zipOutFile"
} catch {
    Write-Log "FAILED: $($_.Exception.Message)"
}
