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
| R2 buckets | `hdbs-public-staging`, `hdbs-private-staging` exist | **Neither `hdbs-public` nor `hdbs-private` exist yet** |
| Supabase schema | migrations `0001`-`0011` | ✅ `0001`-`0011`, all applied and confirmed live 2026-08-01 |
| Supabase data | Real prod snapshot loaded (`scripts/migrate-data.mjs`, Phase 1) | ✅ Real snapshot loaded 2026-08-01, verified row-for-row against all 12 tables |
| Secrets present | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_TOKEN_SECRET`, `SQUARE_TOKEN`, `SQUARE_LOCATION_ID`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` | **Only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`** |
| Missing on *both* | `SMOKE_TOKEN`, `SQUARE_APP_ID`, `SQUARE_WEBHOOK_SIG_KEY`, `USPS_CONSUMER_KEY`/`_SECRET`, `RESEND_API_KEY` | (same) |
| `npm run check:secrets` | — | **Fails today** — run it, this is the live output as of this audit |

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

## 3. 👤 Provision production R2 buckets

Staging's buckets auto-provisioned on first `wrangler deploy --env staging`. Production's will do
the same on first real `wrangler deploy` (no `--env`) — but confirm the bucket names in
`wrangler.jsonc` (`hdbs-public`, `hdbs-private`) match what `docs/phase-0-checklist.md` step 4
specified, and that **neither is public**, before that deploy happens.

- 👤 Optionally create them explicitly first via `npx wrangler r2 bucket create hdbs-public` /
  `hdbs-private`, if you'd rather provision deliberately than let a deploy do it implicitly.

---

## 4. 👤 Migrate real media into production R2

Product images, business logo/hero/about, and studio gallery images currently exist **only on
Hostinger's disk** (per `docs/phase-0-checklist.md`'s media-rescue section) and in
`media-mirror/` locally. Staging's R2 buckets got populated by this session's live admin-UI uploads
during testing — a handful of real images, not the full catalog.

- 👤🤖 Re-run `scripts/pull-media.ps1` against the *current* live Hostinger site first (catches
  anything Suzi has uploaded since Phase 0 — the phase-0 checklist already flags this as a
  pre-cutover step).
- 🤖 Upload the full `media-mirror/` contents into production's `hdbs-public`/`hdbs-private` R2
  buckets — this needs a small script (doesn't exist yet) since `migrate-data.mjs` only handles
  Postgres rows, not binary files. Building this is in scope for this checklist, not yet done.

---

## 5. 👤 Live payment/API credentials for production

**These must be LIVE credentials, not the sandbox ones set on staging this session.** Square Sandbox
and PayPal Sandbox tokens must never reach the production Worker — `check-secret-parity.sh`'s whole
point is identical secret *names*, deliberately different *values*.

- 👤 Square: production access token + production location id (Square Developer Dashboard →
  production application, not sandbox), plus a **production webhook subscription** pointed at
  `https://handmadedesignsbysuzi.com/api/square-webhook.php` for `SQUARE_WEBHOOK_SIG_KEY` — this
  can only be created once the DNS cutover (step 8) is live, so it's the one secret that comes
  *after* cutover, not before. Note this creates a brief window where the webhook backstop isn't
  configured; the plan already accepts an initial short read-only order freeze (per
  `docs/production-isolation.md`'s one-way-doors section) which covers this.
- 👤 PayPal: production Client ID + Secret (PayPal Developer Dashboard → Live app, not Sandbox).
- 👤 `ORDER_TOKEN_SECRET` — generate fresh 32 random bytes, **do not reuse staging's value** (per
  `docs/phase-0-checklist.md` step 6 — this was already called out as an environment-specific
  secret, never copied).
- 👤 `SMOKE_TOKEN` — replaces the old `rt_token`. Also flagged in `Claude.md:57` as a **live
  production credential sitting in plaintext in a tracked file that should be rotated regardless**
  of this migration; rotating it here kills two birds.
- 👤 `RESEND_API_KEY` + verified sending domain (`mail.handmadedesignsbysuzi.com`) — without this,
  production would silently run `EMAIL_MODE=sink` forever and no real order confirmation would ever
  reach a customer. Check `wrangler.jsonc`'s production `vars.EMAIL_MODE` is `"live"` (it already
  is) and that this key is actually set before cutover, not after.
- 👤 USPS `CONSUMER_KEY`/`CONSUMER_SECRET`, if shipment tracking should work at cutover (currently
  unset on both Workers — this was always a lower-priority deferred item, still true here).
- 🤖 `bash scripts/check-secret-parity.sh` must pass (all names present on both Workers) before
  proceeding — it will fail loudly if anything above was missed.

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
- [ ] `hdbs-public`/`hdbs-private` R2 buckets exist, neither public, full media migrated
- [ ] All 13 secrets set on production with **live** (not sandbox) payment values;
      `npm run check:secrets` passes
- [ ] `npx wrangler deploy` (production) succeeds; a full browser walkthrough against the
      `workers.dev` hostname works end to end, including one real refunded live charge
- [ ] `regression_test.php` token and staging Basic Auth password rotated (or Cloudflare Access live)
- [ ] TTL lowered 48h+ before the nameserver change
- [ ] `routes` uncommented, nameservers repointed, Square production webhook live,
      read-only freeze observed during propagation

Only the last checkbox is the actual, irreversible-without-a-DNS-rollback cutover. Everything above
it is exactly as reversible as "do nothing" — this checklist can be worked through incrementally,
stopping after any item, with production still fully served by Hostinger the whole time.
