# Single source of truth for what must NEVER be uploaded to Hostinger.
#
# Dot-sourced by both deploy.ps1 and watch.ps1. It exists because those two scripts each carried
# their own hand-maintained copy of this list, and they had already drifted: watch.ps1's list was
# missing secrets.staging.php, business_logo, and .gitignore, so a save to any of those would have
# pushed them to the live server.
#
# Deleted at Phase 10 along with the rest of the FTP tooling.

# ── Legacy PHP site: files that exist locally but must not be served ──
$exclude = @(
    ".git", ".gitignore", ".gitattributes", ".ftp-credentials",
    "deploy.ps1", "watch.ps1", "backup_hdbs.ps1",
    "CLAUDE.md", "README.md", "USER_MANUAL.md",
    "node_modules", "product_images", "business_logo",
    "business_hero", "business_about", "studio_images",
    "secrets.php", "secrets.staging.php",
    "debug.php", "debug.flag", "drop_tn_tax.php", "fix_tax.php", "sq_test.php",
    "run_tests.html", "reset_nav.php", "default.php", "get_products.php"
)

# ── Cloudflare migration scaffolding ──
# The Workers/Supabase rewrite lives alongside the live PHP site until cutover. Both deploy.ps1
# and watch.ps1 walk the whole tree, so every migration path must be listed here or it gets
# FTP'd onto the live server. Remove this block only after Hostinger is retired.
$exclude += @(
    "src", "public", "supabase", "scripts", "docs", "media-mirror",
    ".output", ".wrangler", "dist",
    "wrangler.jsonc", "wrangler.json",
    "package.json", "package-lock.json", "bun.lock",
    "tsconfig.json", "vitest.config.ts", "version.json",
    ".dev.vars", "PROJECT_STATUS.md",
    "deploy-staging.log", "deploy-prod.log"
)

function Should-Exclude($path) {
    foreach ($ex in $exclude) {
        if ((Split-Path $path -Leaf) -like $ex) { return $true }
        if ($path -like "*\$ex\*") { return $true }
        if ($path -like "*/$ex/*") { return $true }
    }
    return $false
}
