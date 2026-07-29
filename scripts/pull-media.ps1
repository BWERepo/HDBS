# Pull the admin-uploaded media down from Hostinger into ./media-mirror/.
#
# WHY THIS IS THE MOST IMPORTANT SCRIPT IN THE MIGRATION:
# product_images/ and business_logo/ are on deploy.ps1's exclude list (line 31), which means they
# have never been uploaded FROM the repo — they only ever arrived via the admin UI writing to the
# server's filesystem (api/products.php:64, api/admin.php:232/260/286, api/studio.php:136).
# The Hostinger server holds the ONLY copy. If DNS is cut over, or the plan lapses, before this
# runs, the images are gone and there is no recovery.
#
# Run it EARLY (Phase 0), and again immediately before cutover to catch anything Suzi uploaded in
# the interim. It is safe to re-run: it only downloads.
#
# Usage:  .\scripts\pull-media.ps1              (download + verify)
#         .\scripts\pull-media.ps1 -VerifyOnly  (re-check an existing mirror, no download)

param([switch]$VerifyOnly)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $repo 'media-mirror'

$creds = @{}
Get-Content "$repo\.ftp-credentials" | ForEach-Object {
    if ($_ -match "^(\w+)=(.+)$") { $creds[$Matches[1]] = $Matches[2] }
}
$ftpHost = $creds["FTP_HOST"]; $ftpUser = $creds["FTP_USER"]
$ftpPass = $creds["FTP_PASS"]; $ftpPort = $creds["FTP_PORT"]

# Remote directories to mirror. The last two live ABOVE the webroot alongside secrets.php —
# that is a deliberate security boundary (business docs and equipment receipts are admin-only),
# and it is reproduced in R2 by the separate hdbs-private bucket.
# Directory names verified against the actual write sites in the PHP, not guessed:
#   api/products.php:64   -> product_images/
#   api/admin.php:232     -> business_logo/
#   api/admin.php:260     -> business_hero/
#   api/admin.php:286     -> business_about/
#   api/studio.php:134    -> studio_images/
#   api/business_docs.php:12       -> ../business_documents/          (above webroot)
#   api/capital_equipment.php:27   -> ../capital_equipment_receipts/  (above webroot)
$dirs = @(
    @{ remote = 'product_images'; local = 'product_images' },
    @{ remote = 'business_logo';  local = 'business_logo'  },
    @{ remote = 'business_hero';  local = 'business_hero'  },
    @{ remote = 'business_about'; local = 'business_about' },
    @{ remote = 'studio_images';  local = 'studio_images'  },
    @{ remote = '../business_documents';         local = 'business_documents'         },
    @{ remote = '../capital_equipment_receipts'; local = 'capital_equipment_receipts' }
)

function Get-RemoteListing($remoteDir) {
    $url = "ftp://${ftpHost}:${ftpPort}/${remoteDir}/"
    $out = & curl.exe -s --list-only -u "${ftpUser}:${ftpPass}" $url 2>&1
    if ($LASTEXITCODE -ne 0) { return @() }
    return @($out | Where-Object { $_ -and $_ -ne '.' -and $_ -ne '..' })
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
$summary = @()

foreach ($d in $dirs) {
    $localDir = Join-Path $dest $d.local
    $files = Get-RemoteListing $d.remote

    if ($files.Count -eq 0) {
        Write-Host "$($d.remote): empty or not present on server" -ForegroundColor DarkYellow
        $summary += [pscustomobject]@{ Dir = $d.local; Remote = 0; Local = 0; Status = 'absent/empty' }
        continue
    }

    Write-Host "$($d.remote): $($files.Count) file(s) on server" -ForegroundColor Cyan
    if (-not $VerifyOnly) {
        New-Item -ItemType Directory -Force -Path $localDir | Out-Null
        $i = 0
        foreach ($f in $files) {
            $i++
            Write-Progress -Activity "Pulling $($d.remote)" -Status "$i / $($files.Count): $f" `
                           -PercentComplete (($i / $files.Count) * 100)
            $url = "ftp://${ftpHost}:${ftpPort}/$($d.remote)/$f"
            & curl.exe -s -u "${ftpUser}:${ftpPass}" -o (Join-Path $localDir $f) $url 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { Write-Host "  FAILED: $f" -ForegroundColor Red }
        }
        Write-Progress -Activity "Pulling $($d.remote)" -Completed
    }

    $localCount = if (Test-Path $localDir) { @(Get-ChildItem $localDir -File).Count } else { 0 }
    $status = if ($localCount -eq $files.Count) { 'OK' } else { 'MISMATCH' }
    $summary += [pscustomobject]@{ Dir = $d.local; Remote = $files.Count; Local = $localCount; Status = $status }
}

Write-Host "`n=== Mirror summary ===" -ForegroundColor Yellow
$summary | Format-Table -AutoSize

# Zero-byte files are the failure mode curl produces on a partial transfer, and they look fine
# in a count-only check. Catch them explicitly.
$empty = Get-ChildItem $dest -Recurse -File | Where-Object { $_.Length -eq 0 }
if ($empty) {
    # Keep this string pure ASCII: Windows PowerShell 5.1 reads .ps1 as ANSI when there is no BOM,
    # so a multi-byte character inside a string breaks the parser.
    Write-Host "WARNING: $($empty.Count) zero-byte file(s) - re-run to repair:" -ForegroundColor Red
    $empty | Select-Object -First 20 | ForEach-Object { "    $($_.FullName.Substring($dest.Length+1))" }
} else {
    Write-Host "No zero-byte files." -ForegroundColor Green
}

$total = @(Get-ChildItem $dest -Recurse -File).Count
$mb = [math]::Round((Get-ChildItem $dest -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "`nMirror: $total file(s), $mb MB at $dest" -ForegroundColor Green
Write-Host "NEXT: cross-check against the DB with scripts\verify-media.ps1 before uploading to R2." -ForegroundColor Yellow
