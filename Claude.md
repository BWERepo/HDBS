This project uses standard prompts stored in "Z:\Backup\Websites\Claude\StandardPrompts.md"

---

# 🛑 PRODUCTION IS FROZEN — Cloudflare migration in progress (since 2026-07-29)

**Do not deploy anything to production. Do not run `.\deploy.ps1` without `-staging`.**

This project is migrating from Hostinger PHP/MySQL to Cloudflare Workers + Supabase. The live site
must keep being served by the existing PHP until a deliberate cutover. Read
`docs/production-isolation.md` before touching deploy tooling, and `PROJECT_STATUS.md` for where
the migration stands.

**The "Deploy" and "Workflow Triggers" sections below are SUSPENDED for the duration.** In
particular, "a change is made to local disk → deploy that file immediately" would push to
production while the current branch is `main`. It does not apply. Specifically:

- The PHP site is **not** being modified. New work is TypeScript under `src/`, and it is excluded
  from FTP by `scripts/deploy-exclude.ps1`.
- `watch.ps1` now defaults to **staging**; `-Prod` requires typing a confirmation.
- The production Worker has **no routes** — `routes` stays commented out in `wrangler.jsonc` until
  cutover. Uncommenting it *is* the cutover.
- Version numbers now come from `version.json`, not the `major_version`/`minor_version` settings
  rows.

Remove this banner only after Hostinger is retired (Phase 10).

Also note, independent of the migration: the `regression_test.php` token that used to sit in
plaintext here was rotated 2026-08-01 (see Regression Tests section below — do not put a real
value back in this file). `staging-login.html` was deleted the same day — its Basic Auth password
turned out to be vestigial (staging's `.htaccess` deliberately overrides the hPanel Basic Auth
block to grant the whole directory access, since staging is intentionally fully public), so there
was nothing left for that file's credentials to protect.

---

# Project: Handmade Designs By Suzi

## Stack
- PHP/HTML/JavaScript SPA (storefront + admin back office)
- Hostinger shared hosting, LiteSpeed server
- MySQL with PDO (DbgPDO wrapper), settings stored as key-value in `settings` table
- FTP deploy via `deploy.ps1` using curl.exe + Invoke-RestMethod

## Key Files
- `index.php` — storefront SPA (server-rendered for the business name/SEO tags; 4 footers with `.site-version-line`)
- `api/admin.php` — central admin API (login, settings, version, logs)
- `api/config.php` — DB connection, cors(), ok(), fail(), body() helpers
- `api/products.php` — product CRUD, CSV import/export
- `api/orders.php` — order management (status updates, history)
- `api/customers.php` — customer accounts, auth, security questions
- `api/reviews.php` — product review CRUD
- `api/faqs.php` — FAQ CRUD
- `api/subscribers.php` — newsletter subscriber list
- `api/contact.php` — contact form handler
- `api/checkout.php` — order creation and initial payment handling
- `api/verify_payment.php` — Square payment verification
- `api/square_payments.php` — Square API integration
- `api/square-webhook.php` — Square webhook listener
- `api/tn_tax.php` / `api/tn_city_tax.php` — Tennessee state and city tax lookups
- `api/fetch_tax.php` — tax fetch proxy
- `api/email_log.php` — email send log
- `api/github_log.php` — GitHub commit proxy (private repo, requires `github_token` setting)
- `api/deploy_log.php` — deploy history log (POST appends, GET returns reversed)
- `api/applog.php` — general application log
- `api/products_csv.php` — CSV product import/export
- `api/tax_sweep.php` — batch tax recalculation
- `api/db_backup.php` — database backup endpoint
- `js/api.js` — `apiFetch()` helper, base URL configuration
- `js/config.js` — site-wide constants and feature flags
- `js/data.js` — in-memory state: cart, current user, product catalog, order data
- `js/store.js` — storefront logic: product listing, filtering, search, cart management
- `js/auth.js` — customer auth: login, register, security questions, password reset
- `js/ui.js` — shared UI utilities: toasts, modals, page navigation, lightbox
- `js/admin-nav.js` — nav titles map and routing; drag-and-drop nav reordering
- `js/admin-general.js` — admin dashboard, settings, version management
- `js/admin-products.js` — product management screens (CRUD, image upload, CSV)
- `js/admin-orders.js` — order management screens (list, detail, status updates)
- `js/admin-misc.js` — logs, prompts, FAQ, subscribers, reviews, other misc admin screens
- `js/table.js` / `css/table.css` — TableKit component (NEVER modify — copy from Web Utilities component source)
- `js/toolbar.js` / `css/toolbar.css` — PageToolbar component (NEVER modify — copy from Web Utilities component source)
- `js/TableKit.js` — alternate TableKit entry used by some admin screens
- `regression_test.php` — token-gated test runner (PHP, runs 461 tests)
- `deploy.ps1` — local deploy script (NOT deployed to server)
- `watch.ps1` — file watcher that auto-deploys on save during active development

## Credentials & Security
- FTP credentials in `.ftp-credentials` — NEVER commit this file
- FTP: host=ftp.handmadedesignsbysuzi.com, user=u541882440.handmadedesignsbysuzi
- `regression_test.php` protected by `?token=` matching `rt_token` in settings DB
- Token rotated 2026-08-01 (was previously plaintext in this file — do not put the real value
  here again; look it up via `get_setting`/`rt_token` with a valid admin session instead)
- GitHub API: private repo BWERepo/HDBS, token stored in `github_token` setting

## API Conventions
- `apiFetch(endpoint)` in JS prepends `https://handmadedesignsbysuzi.com/api/` — pass `'products.php'` not `'api/products.php'`
- All PHP API responses use `ok([...])` or `fail('message')` from config.php helpers
- CORS is handled by `cors()` call at the top of each API endpoint

## Customer-Facing Pages (SPA routes in index.php)
- **Store** — product grid with search, category filter, sort. Clicking a product opens product detail modal with lightbox.
- **Cart / Checkout** — cart drawer slides in from right. Checkout modal handles shipping info and Square payment.
- **Contact** — contact form POSTing to `api/contact.php`
- **Custom Orders** — custom order request form
- **FAQ** — rendered from `api/faqs.php`
- **About** — static about page
- **Auth** — login and register forms, security question verification for password reset

## Admin Back-Office (SPA routes)
- Accessed via `/admin` hash route; requires session token
- **Dashboard** — quick stats (order count, revenue, product count)
- **Products** — full product CRUD with image upload, CSV import/export
- **Orders** — order list, detail view, status update, shipping info
- **Customers** — customer list, account management
- **Reviews** — product review moderation
- **FAQs** — FAQ CRUD
- **Subscribers** — newsletter list
- **Settings** — site settings (version, Square keys, SMTP, etc.)
- **Logs** — email log, deploy log, app log, GitHub log

## Palette (Gold / Brown theme — NOT the blue ETCC palette)
| Role | Color | Hex |
|---|---|---|
| Dark gold | — | `#a07810` |
| Bright gold | — | `#d4a017` |
| Dark brown | — | `#2d2220` |
| Background | White | `#ffffff` |

> Note: This site uses the gold/brown storefront palette, NOT the standard blue palette from StandardPalette.md. Do not override with blue.

## Site Version
- Stored as `major_version` and `minor_version` in settings table
- Displayed in all 4 footers via `.site-version-line` div (opacity 0.5)
- **Auto-bump on PRODUCTION deploys**: `api/deploy_log.php` increments `minor_version` on every prod deploy (staging is skipped via `$__staging` so active-dev deploys don't inflate it). Debounced 300s so a multi-call checkpoint bumps the minor once. `version_updated_at` is stamped on each bump.
- Major version and any explicit override are still set manually via the Settings → Version card (also used to set a specific number, e.g. a major bump).

## Admin Nav
- Nested JSON stored in `nav_order` setting
- Folders: 🛍️ Shop, 🔧 Developer (collapse state in localStorage `hdbs_nav_folders`)
- Drag-and-drop reordering across folders and root

## Payment Integration
- Square Payments SDK integrated via CDN in index.php
- Payment flow: Square Card component → tokenize → POST to `api/checkout.php` → POST to `api/verify_payment.php`
- Square API keys stored in `square_app_id`, `square_location_id`, `square_access_token` settings
- `api/square-webhook.php` handles async payment status callbacks from Square

## Regression Tests
- Run: `curl "https://handmadedesignsbysuzi.com/regression_test.php?token=<rt_token>"` — look up the
  current `rt_token` via an authenticated `get_setting` call rather than hardcoding it here
- Only run on an explicit "test" command (not after every change, not on checkpoint). On a test command: update the tests first, then run. See Workflow Triggers.

## Deploy
- **Branch determines target**: on `dev` branch, deploy with `-staging` (→ https://staging.handmadedesignsbysuzi.com); on `main` branch, deploy without it (→ https://handmadedesignsbysuzi.com). Check `git branch --show-current` before every deploy.
- Single file to staging: `.\deploy.ps1 -staging path/to/file.php`
- Single file to prod: `.\deploy.ps1 path/to/file.php`
- Full deploy: add `-staging` for staging, omit for prod
- Staging keeps its own `.htaccess` (Basic Auth + noindex) — never deployed there, even in a full deploy
- Each deploy logs to deploy history with the version it produced. Prod deploys auto-bump `minor_version` (see Site Version); staging deploys do not.
- Use `Invoke-RestMethod` for JSON POSTs in deploy.ps1 (curl.exe has PS 5.1 quoting issues)
- `watch.ps1` runs during active dev to auto-deploy on file save
- Always explicitly report which files were deployed and when, and to which environment (per StandardPrompts rule)
- **Deploy immediately after every local change** — do not batch or wait for a checkpoint (see Workflow Triggers). Use `-staging` while on `dev`.
- **If you edit `regression_test.php`, deploy it immediately too** — even mid-task, not just on a "test" command.

## GitHub
- Private repo: BWERepo/HDBS
- GitHub token stored in `github_token` DB setting (not in `.ftp-credentials`)
- `api/github_log.php` proxies GitHub API calls so the token never reaches the browser

## Development Rules (from StandardPrompts)
- Read component readme files before touching TableKit or PageToolbar
- Never modify `js/table.js`, `js/TableKit.js`, `css/table.css`, `js/toolbar.js`, `css/toolbar.css` — copy updates from Web Utilities source
- Before coding, identify affected files and possible side effects
- After changes, provide a regression test checklist
- Protect existing working features — preserve functionality unless explicitly asked to change it
- Do not delete or rewrite large sections unless necessary

## Workflow Triggers
Three distinct triggers, each with one action:
- **A change is made to local disk** → deploy that file immediately (`.\deploy.ps1 -staging <path>` while on `dev`, `.\deploy.ps1 <path>` while on `main`), confirm it's live, and show the site URL for the environment actually deployed to. Do NOT wait for a checkpoint.
- **"test" command** → update `regression_test.php` to cover new functionality, deploy it to staging, then the user runs it, then show the test URL (without token). Claude never runs the suite itself.
- **"checkpoint" command** → show the target branch + staged changes and confirm, then: commit on the current branch → push to GitHub → promote to production (merge `dev`→`main`, push `main`, deploy the changed files to prod via `deploy.ps1` — no `-staging`). The prod deploy auto-bumps `minor_version` (no manual version write needed); only ask for a version if the user wants a major bump or a specific override, which is then set via the Settings → Version card. Does NOT run the regression suite.
