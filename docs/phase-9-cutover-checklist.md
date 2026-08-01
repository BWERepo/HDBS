# Phase 9 cutover checklist — bringing production up to where staging already is

This is **not** "uncomment two lines and go." A readiness audit run 2026-08-01 found production is
still running the Phase 0 scaffold — one deploy, no data, no R2 buckets, almost no secrets — while
every session since Phase 1 has only ever touched staging. This checklist is the second migration
that has to happen before the two-line DNS/routes flip in `docs/production-isolation.md` is safe.

Items marked 👤 need you (account access, credentials, a browser, or a go/no-go decision). Items
marked 🤖 I can run once the 👤 item it depends on is done. **Nothing here touches DNS or
`wrangler.jsonc`'s commented-out `routes` block** — that stays the very last step, separately
confirmed, per `docs/production-isolation.md`'s one-way-door warning.

---

## Current state (audited 2026-08-01, not assumed)

| | Staging | Production |
|---|---|---|
| Last code deploy | Continuous, every session | **2026-08-01T12:31:33 — Phase 0 scaffold, never since** |
| R2 buckets | Created, private, real product/logo media loaded (159+1 files) | ✅ Same — created 2026-08-01, private, 159 product images + 1 logo loaded and verified |
| Supabase schema | migrations `0001`-`0011` | ✅ `0001`-`0011`, all applied and confirmed live 2026-08-01 |
| Supabase data | Real prod snapshot loaded (`scripts/migrate-data.mjs`, Phase 1) | ✅ Real snapshot loaded 2026-08-01, verified row-for-row against all 12 tables |
| Secrets present | Same 7 names as production, sandbox values | ✅ `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_TOKEN_SECRET`, `SMOKE_TOKEN`, `SQUARE_TOKEN`, `SQUARE_LOCATION_ID`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` — Square/PayPal verified genuinely live against Square's/PayPal's own production APIs, 2026-08-01 |
| Missing on *both* | `SQUARE_APP_ID` (likely vestigial, see step 5), `SQUARE_WEBHOOK_SIG_KEY` (needs live DNS, step 8), `USPS_CONSUMER_KEY`/`_SECRET`, `RESEND_API_KEY` | (same) |
| `npm run check:secrets` | — | ✅ Name-parity passes as of 2026-08-01 (was failing at audit time) |

Confirmed via `npx wrangler deployments list`, `npx wrangler r2 bucket list`, `npx wrangler secret
list` (both Workers), `bash scripts/check-secret-parity.sh`, and this file's own Phase 1/2 history
— not inferred.

---

## 1. ✅ Bring production Supabase's schema current — DONE for schema, `0009` still held back

**Completed 2026-08-01.** Confirmed fresh (not the stale Phase 2 note) via a read-only diagnostic:
production had the base schema (`0001`-`0008`, tables existed) but zero rows anywhere — not even
`settings` — and neither `app_log` (`0011`) nor the stock-adjustment functions (`0010`) existed.

Ran `0010_stock_adjustment_functions.sql` and `0011_app_log.sql` against production
(`ckiyvsejstptrnwkinir`) via the SQL editor. Re-verified afterward, not just trusted the success
toast: `has_app_log_table=1`, `has_stock_functions=1`.

⚠️ `0009_normalize_image_urls.sql` is **deliberately still not run** — it's a data normalizer, not
a schema change, and its own header says it must run after real data is loaded (step 2 below), not
against an empty schema. Run it as the last step of step 2, not here.

---

## 2. ✅ Load real data into production Supabase — DONE

**Completed 2026-08-01.** `scripts/migrate-data.mjs` had never been run with `--write --allow-prod`
before this. Dry-run against the freshest backup (`202608010000HDBS.sql`, today's) matched Phase 1's
original staging counts exactly, so the parser was trusted to write for real.

The user ran `--write --allow-prod` themselves in their own terminal — the production
`SUPABASE_SERVICE_ROLE_KEY` never passed through chat, same rule as every other secret this
migration has handled. Verified independently afterward (not just the script's own printed
summary) via a fresh count query against all 12 tables in the production SQL editor: 63 settings,
47 products, 2 orders, 4 order_items, 1 refund, 1 review, 11 faqs, 7 email_log, 2 subscribers,
52 tn_city_tax, 17 studio_items, 13 capital_equipment — exact match to the dry-run preview.

Then ran `0009_normalize_image_urls.sql` (held back until now) against production. Re-verified with
a targeted query rather than trusting the "no rows returned" success message: zero products,
zero `studio_items`, and zero `biz_profile` settings rows still contain an absolute
`handmadedesignsbysuzi.com`/`staging.handmadedesignsbysuzi.com` URL; all 47 products now have
root-relative `/product_images/...` paths.

**Production Supabase is now schema- and data-complete** (migrations `0001`-`0011`, all run against
the real project, all independently re-verified). What's NOT yet in production: the media files
themselves (step 4 — R2 is still empty) and live payment/API credentials (step 5).

---

## 3. ✅ Provision production R2 buckets — DONE

**Completed 2026-08-01.** Created explicitly rather than waiting for an implicit first-deploy
provision: `npx wrangler r2 bucket create hdbs-public` / `hdbs-private`. Names match
`wrangler.jsonc`'s existing `r2_buckets` bindings for production, so no config change needed.

Confirmed neither is publicly accessible: `npx wrangler r2 bucket dev-url get <name>` reports
"Public access via the r2.dev URL is disabled" for both — matching `hdbs-public-staging`/
`hdbs-private-staging`'s same private-by-default state, and matching the requirement that
`hdbs-public` is only ever served *through* the Worker (so the existing `/product_images/...` URL
shape survives) and `hdbs-private` stays admin-gated.

Buckets were empty until step 4 — see below.

---

## 4. ✅ Migrate real media into production R2 — DONE for what's rescuable

**Completed 2026-08-01.** Built `scripts/push-media-to-r2.mjs` — walks `media-mirror/`'s
subdirectories and shells out to `wrangler r2 object put --remote` per file, matching the exact
bucket/prefix layout `src/routes/media.ts` and `src/business.ts` already expect
(`product_images/`, `business_logo/`, `business_hero/`, `business_about/`, `studio_images/` →
public bucket; `capital_equipment_receipts/`, `business_documents/` → private bucket). Supports
`--staging` to target the `-staging` buckets and a dry-run-by-default / `--write` gate, same
pattern as `migrate-data.mjs`.

One real bug caught before trusting it at scale: the first full run used
`execFileSync(..., { shell: true })` with an argument array, which Node flags as a genuine
injection-risk pattern (args aren't escaped in that combination) — surfaced as a deprecation
warning, not a functional failure that run. Fixed by switching to `execSync` with one manually
quoted command string (the injection risk doesn't actually apply here, since every argument comes
from this script's own fixed bucket names or `fs.readdirSync()` over `media-mirror/`, never user
input — but using the tool built for that pattern is still the right call). Verified the fix with
a full re-run before trusting the original run's result.

**Result: 159 product images + 1 business logo uploaded to BOTH `hdbs-public` (production) and
`hdbs-public-staging`** (staging's bucket previously only had a handful of images from this
session's live admin-UI testing — now has the full real catalog too), spot-checked byte-for-byte
identical to the local file via `wrangler r2 object get`. Zero failures on either run.

**What's still not migrated, because it was never rescued from Hostinger in the first place**
(this is `docs/phase-0-checklist.md`'s own long-standing gap, not something this step introduced):
`business_hero/`, `business_about/`, `studio_images/` (confirmed empty/unreferenced in production
per Phase 0), and — the real gap — `capital_equipment_receipts/` (13 real receipt files) and
`business_documents/` (resale certificate, business license), which Phase 0's own checklist
flagged as needing a manual hPanel File Manager download (FTP couldn't reach above the webroot).
**Still worth doing before cutover** if those documents matter for tax/compliance records, but it's
a manual step for the account owner, not something this script can close.

- 👤 Re-run `scripts/pull-media.ps1` against the *current* live Hostinger site once more, close to
  cutover, to catch anything Suzi has uploaded since Phase 0 (idempotent, safe to repeat) — then
  re-run `node scripts/push-media-to-r2.mjs --write` to sync any new files.
- 👤 If the capital-equipment receipts / business documents matter: pull them via hPanel File
  Manager (per `docs/phase-0-checklist.md` step 1's remaining-gap section), drop them into
  `media-mirror/capital_equipment_receipts/` and `media-mirror/business_documents/`, then run this
  script again — it will pick them up automatically once those directories exist.

---

## 5. 🟡 Live payment/API credentials for production — Square + PayPal done, rest outstanding

**These must be LIVE credentials, not the sandbox ones set on staging this session.** Square Sandbox
and PayPal Sandbox tokens must never reach the production Worker — `check-secret-parity.sh`'s whole
point is identical secret *names*, deliberately different *values*.

- ✅ **Square — done 2026-08-01.** Live `SQUARE_TOKEN` + `SQUARE_LOCATION_ID` set on production.
  Verified for real, not just accepted at face value: called `GET
  https://connect.squareup.com/v2/locations` (the live host, not sandbox) directly with the token,
  which returned a real business — "Handmade Designs By Suzi", Knoxville TN, `MOBILE` type,
  `id: LJP687TQBTWTA` — matching the location id given, confirming both values are genuinely live
  and paired correctly.
  - ⚠️ Found in passing: `SQUARE_APP_ID` (an `Env` field, expected by `check-secret-parity.sh`) is
    never actually read anywhere in `src/` — the real app id the storefront's Web Payments SDK uses
    comes from the `settings` table's `square_app_id` row (already migrated with real data in step
    2), not this secret. Likely vestigial. Worth removing from `src/types.ts`/the parity script's
    `EXPECTED` list rather than chasing a value for a secret nothing reads — flagged, not fixed,
    since removing declared-but-unused config is a separate small cleanup from this checklist.
  - Still outstanding: the **production webhook subscription**, pointed at
    `https://handmadedesignsbysuzi.com/api/square-webhook.php` for `SQUARE_WEBHOOK_SIG_KEY` — can
    only be created once DNS cutover (step 8) is live, so this is the one secret that comes *after*
    cutover, not before. Creates a brief window where the webhook backstop isn't configured; the
    plan already accepts an initial short read-only order freeze (per
    `docs/production-isolation.md`'s one-way-doors section) which covers this.
- ✅ **PayPal — done 2026-08-01.** Live `PAYPAL_CLIENT_ID` + `PAYPAL_SECRET` set on production.
  Verified for real: requested a live OAuth token from `https://api-m.paypal.com/v1/oauth2/token`
  (the live host) with these credentials — got a real token back with a real `app_id`
  (`APP-5TH15273DV406260E`), confirming the pair is genuinely live and correctly matched, not a
  sandbox pair or a typo'd secret.
- ✅ **`ORDER_TOKEN_SECRET`/`SMOKE_TOKEN` — done 2026-08-01.** Both self-generated (32 random bytes
  each, no external account needed) — separate values on staging vs. production, never reused
  across environments, per `docs/phase-0-checklist.md` step 6's explicit warning. `SMOKE_TOKEN`
  additionally rotates the plaintext value that was sitting in `Claude.md:57` — worth deleting that
  stale value from `Claude.md` now that the real one lives only in Cloudflare's secret store.
- 👤 `RESEND_API_KEY` + verified sending domain (`mail.handmadedesignsbysuzi.com`) — still not set.
  Without this, production would silently run `EMAIL_MODE=sink` forever and no real order
  confirmation would ever reach a customer. `wrangler.jsonc`'s production `vars.EMAIL_MODE` is
  already `"live"`; this key is the only thing missing to make that setting do anything.
- 👤 USPS `CONSUMER_KEY`/`CONSUMER_SECRET`, if shipment tracking should work at cutover (currently
  unset on both Workers — always a lower-priority deferred item, still true here).
- 🤖 `bash scripts/check-secret-parity.sh` — **now reports name-parity between staging and
  production** (re-run 2026-08-01 to confirm). Remaining "MISSING from hdbs" items are exactly the
  four above (`SQUARE_APP_ID`, `SQUARE_WEBHOOK_SIG_KEY`, both USPS keys, `RESEND_API_KEY`), not a
  parity bug.

---

## 6. 🤖 First real production deploy

- 🤖 `npx wrangler deploy` (no `--env` — deploys to `hdbs`, still routeless, still unreachable from
  the real domain per `wrangler.jsonc`'s comment).
- 🤖 Verify against the `workers.dev` hostname only, exactly like every staging verification this
  whole migration has done: `GET /api/health`, `GET /api/products.php` (real catalog now, not
  empty), `POST /api/admin.php` login with the **real production admin password** (migrated in
  Phase 1, never written down — same gap noted in the Phase 3 product-image milestone).
- 👤 A full walkthrough in a browser against the `workers.dev` URL — storefront loads, cart works,
  a real `$1`-or-less live Square charge (refunded immediately after) — mirrors what
  `docs/production-isolation.md`'s "things that could still bite" section already calls out as
  "the first point at which anything real happens." This is the production equivalent of the
  Square/PayPal sandbox verification already done on staging this session.

---

## 7. 👤 Two security fixes carried over from Phase 0, still not done

`docs/phase-0-checklist.md` step 8 flagged both of these as "live today" and independent of the
migration timeline — they're still outstanding:

1. Rotate `regression_test.php`'s token (`Claude.md:57`, plaintext in a tracked file). Folds into
   the `SMOKE_TOKEN` rotation above if that endpoint is being replaced; do it regardless if not.
2. `staging-login.html:61` still hardcodes staging's Basic Auth credentials in a tracked, deployed
   file. Cloudflare Access (Phase 0 checklist step 7) was recommended as the replacement — confirm
   whether that ever got set up; if not, at minimum rotate the password.

---

## 8. 👤 The cutover itself — DNS + routes

Only after every item above is confirmed:

- 👤 Lower `handmadedesignsbysuzi.com`'s DNS TTL to 300s, wait a full 48h (per
  `docs/production-isolation.md`'s one-way-doors section — this is what makes the nameserver change
  a minutes-long rollback instead of a slow one).
- 👤 Add the zone to Cloudflare (safe only while the registrar still points at Hostinger — adding a
  zone doesn't move traffic, changing nameservers does).
- 🤖 Uncomment the two `routes` lines in `wrangler.jsonc`, redeploy production. **This is the
  cutover** — the moment `handmadedesignsbysuzi.com` can be reachable through Cloudflare.
- 👤 Change the registrar's nameservers to Cloudflare's.
- 👤 Set up the Square production webhook subscription now (deferred from step 5) and set
  `SQUARE_WEBHOOK_SIG_KEY`.
- 👤 A short read-only freeze on both systems while DNS propagates, per
  `docs/production-isolation.md` — "Orders placed on the Worker after cutover exist only in
  Postgres, which is why Phase 9 uses a short read-only freeze rather than letting both systems
  take orders."

---

## Definition of done

- [x] Production Supabase schema matches staging, `0001`-`0011` (done 2026-08-01)
- [x] Production Supabase has the real, current data snapshot, `0009` normalized (done 2026-08-01,
      independently re-verified row-for-row and by absolute-URL count)
- [x] `hdbs-public`/`hdbs-private` R2 buckets exist, neither public (done 2026-08-01)
- [x] Real media migrated (159 product images + 1 logo, done 2026-08-01, byte-verified); studio/
      hero/about images and capital-equipment receipts/business docs remain a manual pull from
      Hostinger (never rescued in Phase 0 — optional, owner's call before cutover)
- [x] Square + PayPal live secrets set and verified genuinely live (done 2026-08-01);
      `ORDER_TOKEN_SECRET`/`SMOKE_TOKEN` self-generated fresh; name-parity passes
- [ ] `SQUARE_WEBHOOK_SIG_KEY` (after DNS, step 8), `RESEND_API_KEY`, USPS keys still outstanding
- [ ] `npx wrangler deploy` (production) succeeds; a full browser walkthrough against the
      `workers.dev` hostname works end to end, including one real refunded live charge
- [ ] `regression_test.php` token and staging Basic Auth password rotated (or Cloudflare Access live)
- [ ] TTL lowered 48h+ before the nameserver change
- [ ] `routes` uncommented, nameservers repointed, Square production webhook live,
      read-only freeze observed during propagation

Only the last checkbox is the actual, irreversible-without-a-DNS-rollback cutover. Everything above
it is exactly as reversible as "do nothing" — this checklist can be worked through incrementally,
stopping after any item, with production still fully served by Hostinger the whole time.
