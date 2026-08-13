# Handmade Designs By Suzi - daily backup
# Standalone script (no Claude Code / subscription dependency) for Windows Task Scheduler.
#
# Produces, in Z:\Backup\Websites\HDBS\Backup\:
#   <timestamp>HDBS-prod.sql     pg_dump of the production Supabase database
#   <timestamp>HDBS-staging.sql  pg_dump of the staging Supabase database
#   <timestamp>HDBS.zip          full repo zip
#
# ---------------------------------------------------------------------------
# 2026-08-12 REWRITE - now a real pg_dump. History of what this replaces:
#
# Until the 2026-08-02 Cloudflare/Supabase cutover this pulled a MySQL dump
# from api/db_backup.php on the old Hostinger site. After the cutover the same
# route was served by the Worker and began returning a JSON *data export* of
# the Supabase tables instead. Two bugs then hid each other for ten days:
# the script still validated the old MySQL header (so it logged FAILED every
# night while actually succeeding), and its catch block swallowed the error
# (so Task Scheduler reported success regardless). Both signals were wrong,
# in opposite directions.
#
# Those were fixed first, but the underlying artifact was still inadequate:
# a JSON data export carries rows only - no DDL, no RLS policies, no
# functions, no indexes, no sequences. You could repopulate a database from
# it, but not rebuild one. It also only covered 20 of the 21 tables (app_log
# was missing from the Worker's BACKUP_TABLES list).
#
# pg_dump supersedes it completely, so the JSON export is no longer taken.
# The /api/db_backup.php route and its HDBS-Backup-Token credential still
# exist and are untouched - this script simply no longer depends on them.
#
# Old <timestamp>HDBS.sql files in the archive are the previous format: MySQL
# dumps up to 2026-08-02, JSON exports from 2026-08-03. The new files carry a
# -prod / -staging suffix, so nothing collides and the archive stays readable.
#
# Passwords come from Windows Credential Manager at runtime and are passed to
# pg_dump via PGPASSWORD rather than inside a connection-string argument, so
# they never appear in the process's argv where Task Manager or `ps` could
# read them. They are never logged or written to disk.
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
$backupDir = "Z:\Backup\Websites\HDBS\Backup"
$logFile = Join-Path $backupDir "backup_hdbs.log"
$pgDump = "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -LiteralPath $logFile -Value $line
}

# Each environment's Credential Manager target and Postgres host.
$environments = @(
    @{ Name = "prod";    Target = "HDBS-Supabase-DB-Prod";    DbHost = "db.ckiyvsejstptrnwkinir.supabase.co" },
    @{ Name = "staging"; Target = "HDBS-Supabase-DB-Staging"; DbHost = "db.ukzhnizosofbkwcpuvye.supabase.co" }
)

$failures = @()
$timestamp = Get-Date -Format "yyyyMMddHHmm"

Write-Log "=== HDBS backup run starting ($timestamp) ==="

if (-not (Test-Path -LiteralPath $pgDump)) {
    Write-Log "FAILED: pg_dump not found at $pgDump"
    throw "pg_dump not found at $pgDump"
}

Import-Module CredentialManager

# --- Step 1: one pg_dump per environment ---
#
# Each is attempted independently and its failure recorded rather than thrown
# immediately, so a paused or unreachable staging database can never stop
# production from being backed up. Any failure still fails the run at the end,
# so Task Scheduler reports honestly - the whole point of the earlier fix.
foreach ($e in $environments) {
    $outFile = Join-Path $backupDir "${timestamp}HDBS-$($e.Name).sql"
    try {
        $cred = Get-StoredCredential -Target $e.Target
        if ($null -eq $cred) {
            throw "No '$($e.Target)' credential in Windows Credential Manager. Store it with New-StoredCredential (use Read-Host -AsSecureString so the password never reaches the console or shell history)."
        }

        $env:PGPASSWORD = $cred.GetNetworkCredential().Password
        try {
            & $pgDump -h $e.DbHost -p 5432 -U postgres -d postgres `
                --no-owner --no-privileges -f $outFile
            $exit = $LASTEXITCODE
        } finally {
            # Clear the password from the environment even if pg_dump throws.
            Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
            Remove-Variable cred -ErrorAction SilentlyContinue
        }
        if ($exit -ne 0) { throw "pg_dump exited with code $exit" }

        # A dump that "succeeds" but is empty or truncated is the failure mode
        # worth catching - verify the file exists and carries pg_dump's own
        # completion marker rather than trusting the exit code alone.
        if (-not (Test-Path -LiteralPath $outFile)) { throw "pg_dump reported success but wrote no file" }
        $item = Get-Item -LiteralPath $outFile
        if ($item.Length -eq 0) { throw "pg_dump wrote an empty file" }
        $tail = Get-Content -LiteralPath $outFile -Tail 5 | Out-String
        if ($tail -notmatch "PostgreSQL database dump complete") {
            throw "Dump is missing pg_dump's completion marker - it is probably truncated ($($item.Length) bytes)"
        }

        Write-Log "OK: $($e.Name) dump -> $outFile ($($item.Length) bytes)"
    } catch {
        $msg = "$($e.Name): $($_.Exception.Message)"
        Write-Log "FAILED: $msg"
        $failures += $msg
    }
}

# --- Step 2: repo zip ---
try {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $repoRoot = "Z:\Backup\Websites\HandmadeDesignsBySuzi"
    $zipOutFile = Join-Path $backupDir "${timestamp}HDBS.zip"
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
    Write-Log "OK: repo zip -> $zipOutFile ($((Get-Item -LiteralPath $zipOutFile).Length) bytes)"
} catch {
    $msg = "repo zip: $($_.Exception.Message)"
    Write-Log "FAILED: $msg"
    $failures += $msg
}

if ($failures.Count -gt 0) {
    Write-Log "=== HDBS backup run FINISHED WITH $($failures.Count) FAILURE(S) ==="
    # Non-zero exit so Task Scheduler shows the failure. Without this the run
    # looks successful no matter what, which is exactly how ten nights of
    # broken backups went unnoticed.
    throw ($failures -join "; ")
}

Write-Log "=== HDBS backup run finished OK ($timestamp) ==="

