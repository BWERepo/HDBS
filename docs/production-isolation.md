# Production isolation contract

**The rule: `handmadedesignsbysuzi.com` continues to be served entirely by the Hostinger PHP site,
with its MySQL database, until the deliberate Phase 9 cutover. Nothing in Phases 0–8 changes what
a customer sees or where an order lands.**

This document enumerates every way production could be touched, and what stops it. Anything not
on this list should be treated as unaudited.

---

## What makes production reachable at all

Production is a function of exactly four things. Until the cutover, all four keep their current
values:

| | Today | Changes at |
|---|---|---|
| DNS for `handmadedesignsbysuzi.com` | Hostinger nameservers → Hostinger IP | Phase 9 |
| The files under `public_html/` | Uploaded by `deploy.ps1` over FTP | never (we stop deploying PHP) |
| The database | MySQL `u541882440_hdbs_data` at `127.0.0.1` | Phase 9 |
| Square / PayPal webhook targets | `handmadedesignsbysuzi.com/api/...` | Phase 9 |

Everything built in Phases 0–8 is off to one side of all four.

---

## Guards in place

### 1. Neither deploy script can upload the migration stack

`deploy.ps1` and `watch.ps1` both walk the entire repo tree, so every new file was a candidate for
upload. Both now dot-source a single exclusion list, `scripts/deploy-exclude.ps1`, covering `src`,
`public`, `supabase`, `scripts`, `docs`, `media-mirror`, `.wrangler`, `.output`, `dist`,
`package.json`, `wrangler.jsonc`, `tsconfig.json`, `vitest.config.ts`, `version.json`,
`.dev.vars`, and `PROJECT_STATUS.md`.

**Verified** by replaying the real `Should-Exclude` against 15 migration paths, 9 secret/media
paths, and 12 live-site paths: all migration and secret paths excluded, all live paths still
deployable.

> They previously kept **two separate hand-maintained lists that had already drifted** —
> `watch.ps1`'s was missing `secrets.staging.php`, `business_logo`, and `.gitignore`, so saving any
> of those would have pushed them live. One shared file removes that whole failure class.

### 2. `watch.ps1` no longer defaults to production

It was hardcoded to production with no staging mode, and it fires on file **creation** as well as
modification — so generating files in the repo while it ran would have published them. It now
defaults to staging, and `-Prod` requires typing `PRODUCTION` at a confirmation prompt. The
version-bump POST is likewise production-only.

*It was confirmed not running while the scaffold was created; nothing leaked.*

### 3. The production Worker has no routes

`routes` is commented out in `wrangler.jsonc`. Deploying `hdbs` is therefore inert — it exists only
at its `workers.dev` hostname and no customer traffic can reach it. Verified by dry-run.
**Uncommenting those two lines is the cutover.** Nothing else in the repo does it implicitly.

### 4. The live PHP is not being modified

The port writes *new* TypeScript. No PHP file is edited, so there is nothing to deploy even by
accident. The PHP stays in the repo as the rollback reference until Phase 10.

### 5. Staging can't send real email or take real money

`EMAIL_MODE=sink` on `hdbs-staging` renders and logs the email but never calls Resend — an
explicit mechanism replacing today's fail-by-accident blank SMTP password. Payment credentials are
per-Worker with identical *names* and sandbox *values* on staging, so a staging code path
physically cannot reach live Square or PayPal.

---

## Operations that touch production, and why they're safe

These are unavoidable, and all are read-only:

| Operation | Direction | Risk |
|---|---|---|
| `scripts/pull-media.ps1` | FTP **GET** only | None — downloads only, never `-T`. Re-runnable |
| Reading `Z:\Backup\Websites\HDBS\Backup\*.sql` | local file read | None |
| Data-migration script reading prod endpoints | HTTP GET with an admin token | Read-only. Note `api/deploy_log.php` and others carry per-IP rate limits; pace bulk reads |
| phpMyAdmin schema export | read | None |

**No write to the production database, filesystem, or FTP occurs at any point before Phase 9.**

---

## Things that could still bite — not yet guarded

Honest list of what remains:

1. **Resend DNS records at Hostinger.** Adding DKIM/SPF for `mail.handmadedesignsbysuzi.com` is
   additive and safe. **Do not touch the apex SPF/MX records** — that is how you break Suzi's
   existing mailbox before the migration even starts. Only add records for the `mail.` subdomain.
2. **Adding the zone to Cloudflare (Phase 9 step 2).** Safe *only* while the registrar still points
   at Hostinger nameservers. Adding a zone does not move traffic; changing nameservers does.
3. **A future session running `.\deploy.ps1` with no arguments.** Still a full production deploy of
   the PHP site. It won't ship migration files, but it will re-upload PHP. During the migration
   there is no reason to run it at all.
4. **`Claude.md` instructs agents to deploy every change immediately** and to check
   `git branch --show-current` first. That convention predates the migration and now conflicts with
   it. Worth updating `Claude.md` so a future session doesn't follow it into a production deploy.
5. **Phase 8 uses live payment credentials on the routeless production Worker**, including a real
   $1 card transaction. That is real money by design, user-driven, and refunded immediately — but
   it is the first point at which anything real happens.
6. **`regression_test.php` makes live HTTP calls to its own endpoints.** Running it against
   production exercises production. That's status quo, and it stays the user's call to run.

---

## One-way doors

Only three actions in the whole migration are hard to undo. Everything else is reversible by doing
nothing.

1. **Losing the media.** `product_images/`, `business_logo/`, `business_hero/`, `business_about/`,
   `studio_images/` exist *only* on the Hostinger server — they are on the deploy exclude list and
   have never been uploaded from the repo. Mitigated by pulling them in Phase 0 and keeping a
   permanent local mirror.
2. **The nameserver change** (Phase 9 step 7). Mitigated by lowering TTLs to 300s a full 48h first,
   so repointing back at the Hostinger IP is a minutes-long fix.
3. **Cancelling the Hostinger plan.** Do not, for at least 60 days after cutover — it is the only
   rollback target, and **Suzi's mailbox may live on it**. Check before cancelling.

Orders placed on the Worker after cutover exist only in Postgres, which is why Phase 9 uses a short
read-only freeze rather than letting both systems take orders.
