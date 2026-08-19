# Handmade Designs By Suzi - daily backup
# Standalone script (no Claude Code / subscription dependency) for Windows Task Scheduler.
#
# Produces, in Z:\Backup\Websites\HDBS\Backup\:
#   <timestamp>HDBS-prod.sql     pg_dump of the production schema (hdbs_prod)
#   <timestamp>HDBS-staging.sql  pg_dump of the staging schema (hdbs_staging)
#   <timestamp>HDBS.zip          full repo zip
#
# ---------------------------------------------------------------------------
# 2026-08-19 FIX - pointed at the wrong project since the 2026-08-13 DR move.
#
# The 2026-08-12 rewrite (see below) pointed this script at two separate
# Supabase projects (ckiyvsejstptrnwkinir for prod, ukzhnizosofbkwcpuvye for
# staging) - correct at the time. The very next day's DR migration moved both
# HDBS environments into ONE shared Supabase project also used by Business
# Web Express (qrsydsglkgampabirejz), as separate schemas (hdbs_prod,
# hdbs_staging) rather than separate projects - confirmed live against
# wrangler.jsonc's SUPABASE_DB_SCHEMA vars. This script was never updated to
# match, so every nightly run between 2026-08-13 and this fix was silently
# dumping the old, abandoned, no-longer-written-to databases instead of the
# real live one. Found while updating the /BWEHDBSBackup Claude Code skill,
# which had the same stale assumption.
#
# Now dumps by schema (-n) from the one shared project/host instead of by
# separate project/host, and uses the same Postgres credential
# BWE-Supabase-DB already uses (same project, same postgres superuser, same
# password - there's only one to store) rather than two separate
# HDBS-specific credentials that would just duplicate it.
#
# ---------------------------------------------------------------------------
# 2026-08-12 REWRITE - became a real pg_dump. History of what this replaces:
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
# The password comes from Windows Credential Manager at runtime and is
# passed to pg_dump inside the connection string built just-in-time, never
# hardcoded, logged, or written to disk.
# ---------------------------------------------------------------------------

$ErrorActionPreference = "Stop"
$backupDir = "Z:\Backup\Websites\HDBS\Backup"
$logFile = Join-Path $backupDir "backup_hdbs.log"
$pgDump = "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe"

function Write-Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -LiteralPath $logFile -Value $line
}

# Both HDBS environments now live in ONE shared Supabase project (also used by
# Business Web Express) as separate schemas, not separate projects - see the
# 2026-08-19 note above. One host, one credential; only the schema differs.
$dbHost = "db.qrsydsglkgampabirejz.supabase.co"
$credTarget = "BWE-Supabase-DB"
$schemas = @(
    @{ Name = "prod";    Schema = "hdbs_prod" },
    @{ Name = "staging"; Schema = "hdbs_staging" }
)

$failures = @()
$timestamp = Get-Date -Format "yyyyMMddHHmm"

Write-Log "=== HDBS backup run starting ($timestamp) ==="

if (-not (Test-Path -LiteralPath $pgDump)) {
    Write-Log "FAILED: pg_dump not found at $pgDump"
    throw "pg_dump not found at $pgDump"
}

Import-Module CredentialManager

$cred = Get-StoredCredential -Target $credTarget
if ($null -eq $cred) {
    $msg = "No '$credTarget' credential in Windows Credential Manager. This is the shared Postgres credential /BWEBackup also depends on - store it with New-StoredCredential (use Read-Host -AsSecureString so the password never reaches the console or shell history)."
    Write-Log "FAILED: $msg"
    throw $msg
}
$env:PGPASSWORD = $cred.GetNetworkCredential().Password
Remove-Variable cred

# --- Steps 1 & 2: one pg_dump per schema, same shared host/credential ---
#
# Each is attempted independently and its failure recorded rather than thrown
# immediately, so a paused or unreachable staging schema can never stop
# production from being backed up. Any failure still fails the run at the end,
# so Task Scheduler reports honestly - the whole point of the earlier fix.
try {
    foreach ($s in $schemas) {
        $outFile = Join-Path $backupDir "${timestamp}HDBS-$($s.Name).sql"
        try {
            & $pgDump -h $dbHost -p 5432 -U postgres -d postgres -n $s.Schema `
                --no-owner --no-privileges -f $outFile
            if ($LASTEXITCODE -ne 0) { throw "pg_dump exited with code $LASTEXITCODE" }

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

            Write-Log "OK: $($s.Name) dump (schema $($s.Schema)) -> $outFile ($($item.Length) bytes)"
        } catch {
            $msg = "$($s.Name): $($_.Exception.Message)"
            Write-Log "FAILED: $msg"
            $failures += $msg
        }
    }
} finally {
    # Clear the password from the environment no matter how the loop above exits.
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

# --- Step 3: repo zip ---
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

