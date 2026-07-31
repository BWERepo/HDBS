# HDBS — Project Status

> Working memory for the Handmade Designs By Suzi project. A brand-new session should be able to
> resume from this file alone. Newest status at the top.

---

## Current state — 2026-07-30

**Supabase projects, R2 buckets, and Resend domain still do not exist** (confirmed with the user
this session) — that remains the blocker for Phase 1's data-migration script and for wiring
`src/db.ts` to anything real. Until then, Phase 3 business logic is being written test-first
against small store interfaces (the same pattern `src/shell.ts` used for `biz_profile`), so it's
fully unit-tested today and becomes real via a one-line adapter the moment `db.ts` exists.

**`src/auth.ts` + `src/lib/password.ts` written** (admin login/logout/change-password/security-
question reset, bcrypt→PBKDF2 transparent rehash, `AdminAuthStore` interface + in-memory fake).
Ported from `api/admin.php`'s login/logout/change_password/get_sec_question/verify_sec_answer/
reset_password/save_sec_question and `api/config.php`'s validAdminToken()/requireAdmin(), minus
the legacy settings-table token fallback (dropped on purpose — see the plan's Auth section).
Found and fixed one bug this session: `recordFailure()` calls in `login()` and
`verifySecurityAnswer()` were missing the `now` argument, shifting every later parameter over so
`attemptMessage` was `undefined` — caught by 5 failing tests, not by a type error.

**`src/settings.ts` written** — ports `api/admin.php`'s `get_setting`/`set_setting`/`save_setting`
(public-key allowlist, sensitive-key blocklist, boolean/token/version auto-defaulting), same
store-interface + fake pattern. Deliberately deferred: `biz_profile`'s base64 logo/hero_image/
about_picture upload handling (`admin.php:216-291`) — that's disk-write logic with no Worker
equivalent and needs rewriting against R2, not porting verbatim, once R2 buckets exist.

`npm test`: 93/93 passing. `tsc --noEmit`: clean (also added the missing `@types/bcryptjs` dev
dependency this session).

Also untracked and not yet committed: `USER_MANUAL.md`, `backup_hdbs.ps1` (standalone Windows
Task Scheduler version of the `/BWEHDBSBackup` skill, for automated daily backups independent of
a Claude Code subscription).

**Next up, still without needing live Supabase:** more Phase 3 business logic against store
interfaces — `products.ts` (read-only catalog) is the natural next module per the plan's
dependency order (`db.ts`/cors/fail/applog → auth.ts → settings.ts → shell.ts + assets →
products.ts → …). `src/lib/cors.ts` (Hono CORS middleware) is cheap and has no store dependency,
also unblocked.

---

## Current state — 2026-07-29

**Live production is unchanged and unaffected.** `handmadedesignsbysuzi.com` is still the PHP site
on Hostinger, still deployed by `deploy.ps1` over FTP, still backed by MySQL. Nothing in the
migration has touched it.

**Active work: migrating to Cloudflare Workers + Supabase Postgres.**
Approved plan: `C:\Users\Admin\.claude\plans\z-backup-websites-handmadedesignsbysuzi-frolicking-reef.md`

**Phase: 0 complete except for user-account setup. Phase 1 schema written, not yet applied.**

All work is on branch **`cloudflare-migration`** (pushed). `main` and `dev` remain at `394f87c`,
untouched. A useful side effect: `Claude.md`'s branch rule is `dev` → staging and `main` → prod, so
on this branch the deploy tooling has **no defined target at all** — a third guard alongside the
exclude list and the freeze banner.

### Phase 1 — migrations written and grammar-validated

`supabase/migrations/0001`–`0009`, 72 statements, converted by hand from
`docs/schema-live-prod.sql`. **Not yet applied to anything** — that needs the Supabase projects.

Validated with `npm run validate:migrations`, which runs the real PostgreSQL parser
(libpg_query compiled to WASM) so migrations can be checked without Docker or a live project. It
also greps for leftover MySQL-isms (backticks, `AUTO_INCREMENT`, `TINYINT`, `DATETIME`,
`ON DUPLICATE KEY`, `ENGINE=`, `MODIFY COLUMN`). All 9 files pass.

Coverage cross-checked against the live schema: 20 tables in, 20 out, all with RLS enabled, and
exactly the two intended deltas — `prompt_log` dropped (orphaned), `order_lookup_requests` added
(never existed in prod; created anyway since it is three columns and unblocks either decision).

Conversion decisions worth knowing:
- `citext` on every email column, restoring MySQL's case-insensitive collation. On
  `customers.email` and `subscribers.email` this is load-bearing: without it the `UNIQUE` constraint
  changes meaning and `Alice@x.com` becomes a second account.
- The three boolean columns became real `boolean`. **The API layer must coerce them back to `1`/`0`
  in JSON responses** — one place, reversible, zero JS changes.
- `order_items → orders ON DELETE CASCADE` preserved — the only FK in the original schema.
- One deliberate strengthening: `studio_project_notes.project_id` gains an FK to
  `studio_inquiries` (both tables are empty, so it cannot fail on existing data).
- `reviews.status` enum → `text` + `CHECK`, so widening it later is one `ALTER`.
- `set_updated_at()` trigger replaces MySQL's `ON UPDATE current_timestamp()`, which Postgres has
  no column-level equivalent for.
- `0009` normalises the absolute image URLs to root-relative and is idempotent. It must run
  **after** the data load, not against an empty schema.

Still to write for Phase 1: the idempotent data-migration script (blocked on the Supabase
projects existing).

### Phase 2 — storefront shell, rendering real data

`index.php` lines 1-67 were the entire server-rendered surface (56 PHP echo sites, 19 distinct
values, 3 escaping contexts). Converted with a generator
(`scripts/generate-shell.mjs`) rather than by hand, because it **throws on any PHP expression it
doesn't recognise** — so the conversion is provably complete, not just eyeballed. Produced
`public/index.html` (25/25 tokens mapped, zero PHP left) plus `src/shell.ts` /
`src/lib/biz-profile.ts` to render it. 30/30 tests, tsc clean.

**Two bugs found only by actually running the Worker and curling it — not by the unit tests or
the dry-run build:**

1. Workers Static Assets serves `/` → `index.html` directly, bypassing the Worker entirely,
   unless `assets.run_worker_first: true` is set. The shell's own logic was correct; it just never
   ran. Fixed in `wrangler.jsonc`.
2. A `Response` from `env.ASSETS.fetch()` has **immutable headers** — `securityHeaders` mutating
   them directly threw on every real static asset (500, no logged exception), while every dynamic
   route was unaffected. That's why only `/js/*`, `/css/*`, and images broke. Fixed by rebuilding
   the response before setting headers.

Take the lesson forward: **`wrangler dev` + `curl`, diffed byte-for-byte against the source, is
now the standard verification step for any route work** — a dry-run build proves the config
resolves, not that the runtime behaves as assumed.

### Done

- **`deploy.ps1` guarded.** Line 84 walks the whole tree and FTPs everything not on the exclude
  list, so the new Workers stack would have been uploaded onto the live PHP server. Added a second
  `$exclude` block covering `src`, `public`, `supabase`, `scripts`, `docs`, `.output`, `.wrangler`,
  `dist`, `wrangler.jsonc`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `version.json`,
  `.dev.vars`, `PROJECT_STATUS.md`, and the deploy logs. Verified by replaying the real
  `Should-Exclude` logic against 16 migration paths (all excluded) and 11 live-site paths (all
  still deploy). **Remove that block only after Hostinger is retired.**
- **Repo scaffolded** — `package.json`, `tsconfig.json`, `wrangler.jsonc`, `vitest.config.ts`,
  `version.json`, `src/index.ts` (Hono skeleton: www→apex, security headers, `/api/health`, SPA
  catch-all), `src/types.ts` (the `Env` contract), `src/lib/{http,html-escape,security-headers}.ts`,
  `scripts/sync-assets.mjs`, `scripts/check-secret-parity.sh`.
- **Verified:** `npm test` 8/8 green, `npm run typecheck` clean, `wrangler deploy --dry-run` builds
  for **both** environments with correct bindings. Production dry-run confirms prod buckets,
  `EMAIL_MODE: live`, and **no routes** (routes stay commented out in `wrangler.jsonc` until
  Phase 9 — uncommenting them before the DNS cutover would take the storefront off Hostinger with
  no rehearsed rollback).
- **Live schema recovered** — see `docs/schema-reconciliation.md` and `docs/schema-live-prod.sql`.

- **Media rescued.** `scripts/pull-media.ps1` pulled **159/159 product images + 1 business logo**
  (48.4 MB) into `media-mirror/`, zero zero-byte files, cross-checked against the 137 distinct
  filenames the database references. `business_hero/`, `business_about/` and `studio_images/` are
  genuinely empty — the database has zero references to any of them, so those features were never
  used.
- **Production isolation enforced** — see `docs/production-isolation.md`. Closed two live hazards:
  `watch.ps1` was hardcoded to production and fires on file *creation* (it was verified not running
  during the scaffold, so nothing leaked); and `Claude.md:145` told any session to deploy every
  change immediately, which on branch `main` means production. `watch.ps1` now defaults to staging
  and `-Prod` demands a typed confirmation; `Claude.md` carries a freeze banner suspending the
  deploy conventions. `deploy.ps1` and `watch.ps1` also had **two drifted exclude lists** — now one
  shared `scripts/deploy-exclude.ps1`.

### Not done in Phase 0

- ⚠️ **13 capital-equipment receipts are still unbacked-up.** `capital_equipment` has 13 rows with
  real `.pdf`/`.jpg` filenames, but `../capital_equipment_receipts/` returned empty over FTP —
  almost certainly the FTP account being chrooted to `public_html` and refusing `../`. Same for
  `../business_documents/`. These are tax records with no other copy; they need pulling by hand via
  hPanel File Manager. **The empty FTP listing is not evidence the folders are empty — the database
  says otherwise.**
- `media-mirror/` is gitignored and not yet copied anywhere permanent, so it is currently a single
  unbacked-up copy.
- Staging MySQL schema dump and diff against production.
- Supabase projects, R2 buckets, Resend domain, Cloudflare Access — all require the user.
- See `docs/phase-0-checklist.md`.

---

## Key findings that changed the plan

Recovered the authoritative schema from the nightly production backup
(`Z:\Backup\Websites\HDBS\Backup\202607290000HDBS.sql`) rather than from the PHP source — the
source could not be trusted, because the schema is created lazily at runtime and `orders` alone
gains seven columns across five different files.

1. **`customers` has zero rows.** There are no customer accounts in production. This substantially
   deflates the biggest correctness risk in the plan (bcrypt password hashes not being verifiable
   cheaply in Workers). Transparent bcrypt→PBKDF2 rehash is still needed for the **admin** password
   and security answer, but there is no customer-lockout scenario and no mass password-reset email.
2. **`api/tn_tax.php` is dead, broken code.** It queries `tn_sales_tax`, a table that was
   deliberately dropped — `regression_test.php:339` literally asserts the table is gone. Every
   request to it fails at line 17. Do not port it. Only `api/tn_city_tax.php` is live.
3. **`prompt_log` is an orphaned table.** Its endpoint was deleted (`regression_test.php:1387`
   asserts `api/prompt_log.php` is removed) and the table was left behind. Drop it.
4. **`order_lookup_requests` has never existed in production.** It is created lazily by
   `api/order_lookup.php:24` on first use, so the guest magic-link order-lookup path has never run.
   Needs a decision: unused feature, or broken one?
5. **20 tables, not 21**, and `order_items → orders` is the only foreign key in the database
   (`ON DELETE CASCADE`). It must be preserved.
6. Only **three** boolean-shaped columns exist (`products.sell`, `products.coming_soon`,
   `studio_items.active`), so the `TINYINT(1)` → `boolean` JSON-shape risk is small and
   containable by coercing back to `1`/`0` in the API response layer.
7. The whole database is **109 KB**. Row counts are tiny (`order_items` ≤345, `email_log` ≤109,
   `tn_city_tax` 53). Data migration is not a scale problem.

Two pre-existing security items, independent of the migration:

- **`staging-login.html:61`** hardcodes the staging HTTP Basic Auth username and password in
  cleartext. It is neither gitignored nor on `deploy.ps1`'s exclude list, so it is committed to git
  *and* uploaded to the live server on every full deploy.
- **`Claude.md:57`** contains the live production `regression_test.php` token in plaintext in a
  tracked file. Rotate it.

Minor: `.htaccess:34` denies all `*.txt`, which also matches `robots.txt` — that file is very
likely returning 403 in production today. The migration fixes it incidentally.

---

## Open decisions

- **`version.json` is a placeholder at `0.1.0`.** The live version lives in the `major_version` /
  `minor_version` rows of the `settings` table and renders in four footers via
  `.site-version-line`. Before Phase 2, read the real value and set `version.json` to match, so the
  site doesn't appear to regress after cutover.
- Whether `checkout.php` (admin-gated legacy Square hosted links) is still used. Plan says drop.
- Whether guest order lookup (finding 4) is wanted at all.
- Whether `api/admin.php`'s arbitrary-SQL DB browser is dropped (plan strongly recommends dropping;
  Supabase's own SQL editor replaces it).

---

## Architecture, once migrated

Two Workers — `hdbs` (apex + `www`) and `hdbs-staging` (workers.dev, behind Cloudflare Access) —
serving a Hono app with Workers Static Assets. **Not** TanStack Start: HDBS's front end is ~9,900
lines of vanilla JS with two vendored, never-modify DOM components, and its SSR surface is just the
`{{BIZ_*}}` token substitution that `index.php` lines 1-67 do today.

Two Supabase Postgres projects (prod and staging kept separate because HDBS handles live payments
and customer PII — a deliberate deviation from BusinessWebExpress, which uses one). Two R2 buckets
per environment, split by access class: `hdbs-public` (Worker-proxied media) and `hdbs-private`
(admin-gated business docs and equipment receipts, reproducing today's above-webroot boundary).
Resend for transactional email, replacing `mailer.php`'s raw SMTP socket, which Workers cannot do.

Secret **names** are identical across both Workers; only values differ (sandbox vs live), which is
what makes `npm run check:secrets` meaningful and removes the `if ($__staging)` branches.

## Conventions

- Staging deploys happen proactively on every change. **Production requires an explicit go-ahead.**
- The user runs browser testing and the regression/smoke suite. The agent does not drive a browser
  and does not run the regression suite.
- Staging bumps the patch version; promote bumps the minor and rebuilds.
- Never redirect `wrangler` output to a path outside the repo — it trips the permission classifier.
- `wrangler`'s `[env]` inheritance does **not** merge `vars`, `r2_buckets`, or `routes`; it
  replaces them. Every binding is re-declared in the staging block on purpose.
