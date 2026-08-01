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
| Last code deploy | Continuous, every session | ✅ Redeployed 2026-08-01 (first time since the Phase 0 scaffold); real live charge + refund verified through the actual browser checkout UI |
| R2 buckets | Created, private, real product/logo media loaded (159+1 files) | ✅ Same — created 2026-08-01, private, 159 product images + 1 logo loaded and verified |
| Supabase schema | migrations `0001`-`0011` | ✅ `0001`-`0011`, all applied and confirmed live 2026-08-01 |
| Supabase data | Real prod snapshot loaded (`scripts/migrate-data.mjs`, Phase 1) | ✅ Real snapshot loaded 2026-08-01, verified row-for-row against all 12 tables |
| Secrets present | Same 10 names as production (no `SQUARE_WEBHOOK_SIG_KEY` — production-only, see step 5) | ✅ `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_TOKEN_SECRET`, `SMOKE_TOKEN`, `SQUARE_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIG_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `BREVO_API_KEY`, `USPS_CONSUMER_KEY`, `USPS_CONSUMER_SECRET` — every one verified genuinely live against its real provider's own API, 2026-08-01 |
| Email | `EMAIL_MODE=sink` (never calls Brevo) | ✅ `EMAIL_MODE=live`, Brevo wired, verified with a real send through the real deployed code (`send_confirm.php` → `ORD-MSAT7Q4O`), 2026-08-01 |
| Missing on *both* | `SQUARE_APP_ID` (likely vestigial dead config, see step 5) | (same) |
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
  - The **webhook subscription** originally assumed to need DNS cutover first turned out not to —
    see the dedicated `SQUARE_WEBHOOK_SIG_KEY` entry below, done 2026-08-01 against the current
    `workers.dev` URL. Only the subscription's URL needs updating in Square's dashboard after
    cutover (step 8), not the secret itself.
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
- ✅ **Email — done 2026-08-01, switched providers from Resend to Brevo.** Resend's free tier turned
  out to cap an account at one verified domain, and this account already had one (a sibling
  project) — a second domain needed a $20/mo upgrade. Investigated whether Brevo's free plan had
  the same limit rather than assuming from marketing copy: **confirmed it doesn't**, by actually
  adding a second domain via Brevo's API and getting a clean success, not a plan-tier error.
  - Signed up for Brevo (user did this directly — account creation is something this session
    doesn't do), added `mail.handmadedesignsbysuzi.com`, walked through adding its 4 DNS records
    (2 DKIM CNAMEs, a Brevo verification TXT, a DMARC TXT) at Hostinger — on the `mail.` subdomain
    only, never the apex. One hiccup: the domain briefly vanished from Brevo's domain list between
    adding it and checking DNS propagation (re-added it, no data lost) — re-triggered
    authentication afterward: `authenticated: true, verified: true`.
  - **Rewired `src/lib/email-sender.ts`'s `LiveEmailSender`** from Resend's `POST /emails` to
    Brevo's `POST /v3/smtp/email` (different request shape — Brevo wants `to`/`replyTo` as
    `{email}` objects, not bare strings, and `htmlContent` not `html`). Renamed the env binding
    `RESEND_API_KEY` → `BREVO_API_KEY` in `src/types.ts` and all 6 route call sites
    (`contact.ts`/`email.ts`/`orders.ts`/`payments.ts`×2/`refunds.ts`/`studio.ts`), and in
    `scripts/check-secret-parity.sh`'s expected-secrets list. `npm test`: 497/497 unaffected
    (no unit tests exercised the Resend-specific internals directly). `tsc --noEmit`: clean.
  - Set `BREVO_API_KEY` on both Workers (same real key on both — Brevo has no sandbox/live split
    the way Square/PayPal do; staging never calls it since it stays on `EMAIL_MODE=sink`), deleted
    the now-unused `RESEND_API_KEY` from production. **Flipped `wrangler.jsonc`'s production
    `EMAIL_MODE` back to `"live"`** (was reverted to `"sink"` earlier this session while the
    provider decision was pending) and redeployed — confirmed via the deploy output
    (`env.EMAIL_MODE ("live")`).
  - **Verified with two independent real sends, not just an API 200**: a direct Brevo API test
    (event log showed `requests → delivered → opened`), then — the one that actually matters —
    triggering `send_confirm.php`'s real admin resend against a real order (`ORD-MSAT7Q4O`) through
    the actual deployed production code, confirmed via Brevo's event log showing that exact
    order's subject line delivered and opened. This is the first time this migration has verified
    a real email send through the real code path end to end, not a direct provider-API test.
  - One earlier live-payment test (`TESTEMAIL-1`) failed with "Payment configuration error" —
    diagnosed, not just retried: Square's published `cnon:card-nonce-ok` test nonce only works
    against Square's Sandbox API, not the live one, so it correctly failed there. Not a
    credentials regression (re-verified `SQUARE_TOKEN`/`SQUARE_LOCATION_ID` directly against
    Square's live API, still fine) — just the wrong tool for testing a live charge headlessly.
    Order deleted, product stock restored via a real full-record update, same as prior test cleanups.
- ✅ **USPS — done 2026-08-01.** User had credentials already (USPS Developer Portal, an account
  only they could create). Set on both Workers (USPS has no sandbox tier — same real credentials
  everywhere, confirmed by this project's own earlier finding that USPS tracking data isn't
  reachable in any sandbox mode on this product tier). Verified genuinely live twice: a direct
  OAuth token request to `https://apis.usps.com/oauth2/v3/token` returned a real Bearer token, then
  the actual deployed `validate_tracking.php` route was called with a real historical order's
  tracking number and returned real USPS status (`"Delivered, Front Door/Porch"`) — no redeploy
  needed since the route was already ported and live, only the secret was missing.
- ✅ **`SQUARE_WEBHOOK_SIG_KEY` — done 2026-08-01, and it turned out DNS wasn't actually a
  prerequisite.** This checklist originally assumed the webhook subscription needed the real
  `handmadedesignsbysuzi.com` domain to exist first (step 8). Rechecked the code before waiting:
  `routes/payments.ts`'s `callbackUrl` is derived dynamically from the incoming request's own
  origin (`new URL(c.req.url).origin`), not hardcoded — so a webhook subscription can point at the
  current `workers.dev` URL right now, and Square's dashboard URL can simply be updated after
  cutover with no code change needed then.
  - Created a real Square webhook subscription via the API (`POST
    /v2/webhooks/subscriptions`) pointed at
    `https://hdbs.muddy-resonance-c828.workers.dev/api/square-webhook.php`, got a real
    `signature_key` back, set it as the secret.
  - **Verified with Square's own webhook-testing endpoint** (`POST
    /v2/webhooks/subscriptions/{id}/test`), not a real charge (a real live charge would have hit
    the same sandbox-nonce dead end as the email test above) — got back `status_code: 200`,
    confirming HMAC signature verification against the real signing key works. Cross-checked
    against `app_log`: a real `"COMPLETED but no order ID found"` line landed in `webhook_log.txt`
    (expected — Square's canned test payload references a fake order id, not one of this store's
    real orders), proving the full handler path executed correctly, not just the signature check.
    Test log entry cleared afterward.
  - **Deliberately production-only, not a parity gap**: staging doesn't get its own
    `SQUARE_WEBHOOK_SIG_KEY` since that would require a second, separate Square Sandbox webhook
    subscription this checklist never asked for — `check-secret-parity.sh`'s "Only on production"
    flag for this one name is expected and fine.
- 🤖 `bash scripts/check-secret-parity.sh` — **all real gaps closed as of 2026-08-01.** The only
  remaining "MISSING from hdbs" item is `SQUARE_APP_ID`, already flagged as likely-vestigial dead
  config (the real value comes from the `settings` table, not this env binding) — worth a small
  separate cleanup, not a blocker.

---

## 6. ✅ First real production deploy — DONE, including a real live charge

**Completed 2026-08-01.** `npx wrangler deploy` (no `--env`) — production Worker deployed for the
first time since the Phase 0 scaffold. Still routeless, still unreachable from the real domain, per
`wrangler.jsonc`'s comment — verified only against `workers.dev`.

**One real deploy-time problem, diagnosed and deliberately deferred, not silently ignored**: the
Worker code deployed successfully, but the two cron triggers failed with `Error 10072` — this
Cloudflare account has already hit the Workers Free plan's 5-cron-trigger cap across sibling
projects (BusinessWebExpress, FacebookLeadFinder, hdbs-staging). Investigated before deciding
anything: `hdbs` has **no `scheduled()` handler implemented anywhere in `src/`** — the two cron
expressions in `wrangler.jsonc` have nothing to call yet, so the registration failure has zero
functional impact right now. Put to the user rather than assumed: deferred entirely rather than
disabling a sibling project's cron or upgrading the plan, since there's nothing for hdbs's own
cron to run yet. Revisit once a real `scheduled()` handler exists.

Automated verification against `https://hdbs.muddy-resonance-c828.workers.dev`:
- `GET /api/health` → `200 {"ok":true,"environment":"production",...}`. (Found in passing:
  `phase: 0` in that response is a static Phase-0-scaffold leftover, `src/index.ts:78` — cosmetic,
  not a bug, worth deleting in a future cleanup.)
- `GET /api/products.php` → real catalog, 47 products, real names — not the empty/placeholder
  response every prior "production" check would have gotten before step 2.
- `POST /api/admin.php` unauthenticated → correctly 401s (not the old 501 stub), confirming this
  session's full admin route surface — including the log viewer built earlier — is live.

**A real, full-price live charge through the actual browser checkout UI — the first time this
whole migration has verified the real storefront frontend against a live payment, not just an API
curl**: user opened `https://hdbs.muddy-resonance-c828.workers.dev`, added the cheapest real
in-stock item ("ETCC Logo Crossbody," $35) to cart, and paid with a real card.
- A real Permissions-Policy console violation (`payment is not allowed in this document`) appeared
  during checkout — investigated before assuming it was fine: `src/lib/security-headers.ts`'s
  `payment=(self)` policy. Turned out to be benign — Square's manual card-entry iframe doesn't need
  the Payment Request API, only Apple/Google Pay detection does — confirmed by the charge actually
  succeeding, not by reasoning alone.
- Confirmed via the real order record: `ORD-MSAT7Q4O`, `status: "Paid"`, real
  `square_payment_id: 18L3n3FM8ryB8hTuzAhN0sW7QNKZY`, `$48.41` total ($35 + $10 shipping + $3.41
  tax, correct math), confirmation email logged.
- Refunded immediately after, as planned: real `square_refund_id`, order moved to `Refunded`.
  `email_sent: false` on the refund confirmation — expected, not a bug, since `RESEND_API_KEY`
  isn't set yet (step 5).
- **One real-data cleanup, unlike every disposable test order this session**: the refund didn't
  restock the real "ETCC Logo Crossbody" product (same faithfully-preserved PHP quirk as every
  staging test), but this is Suzi's actual catalog, not throwaway test data — flagged to the user
  rather than silently left, then restored to stock `1` via a real `POST /api/products.php` full-
  record update, verified images/other fields were untouched by the update.

---

## 7. ✅ Two security fixes carried over from Phase 0 — DONE

**Completed 2026-08-01.** `docs/phase-0-checklist.md` step 8 flagged both as "live today" and
independent of the migration timeline:

1. **`regression_test.php`'s `rt_token` rotated on the LIVE production PHP site** (still the real
   system serving customers today, pre-cutover — a different database than anything else this
   session touched). User provided a live admin session token; called the real `admin.php`'s
   `set_setting` action with a freshly-generated value, never echoed into chat. Verified by
   confirming the *old* plaintext token from `Claude.md` now 403s against `regression_test.php`,
   without ever printing the new one. `Claude.md` updated to stop hardcoding the value at all —
   points at looking it up via an authenticated `get_setting` call instead.
2. **`staging-login.html` deleted, not just rotated** — investigating turned up that its Basic Auth
   credentials were already vestigial. Staging's actual `.htaccess` has a deliberate override,
   with its own explanatory comment, granting the whole directory to everyone (staging is
   intentionally fully public; only `noindex` keeps search engines out). Confirmed this genuinely
   was the case (not assumed) by rotating the `.htpasswd` hash via FTP first and testing both the
   old and new passwords against a real request — both got the same result either way, proving
   auth isn't enforced at all. Deleted the file locally, from git, and from the live server (FTP
   `DELE`) — first got the path wrong (it lives at the site root, not inside `staging/`), caught by
   checking the directory listing rather than assuming the delete worked.

---

## 8. 👤 The cutover itself — DNS + routes

✅ **The email blocker flagged here earlier is resolved** — switched to Brevo (step 5), production
is back on `EMAIL_MODE=live`, verified with a real send through the real deployed code.

Only after every item above is confirmed:

- 👤 Lower `handmadedesignsbysuzi.com`'s DNS TTL to 300s, wait a full 48h (per
  `docs/production-isolation.md`'s one-way-doors section — this is what makes the nameserver change
  a minutes-long rollback instead of a slow one).
- 👤 Add the zone to Cloudflare (safe only while the registrar still points at Hostinger — adding a
  zone doesn't move traffic, changing nameservers does).
- 🤖 Uncomment the two `routes` lines in `wrangler.jsonc`, redeploy production. **This is the
  cutover** — the moment `handmadedesignsbysuzi.com` can be reachable through Cloudflare.
- 👤 Change the registrar's nameservers to Cloudflare's.
- 👤 Update the existing Square webhook subscription's `notification_url` (Square Developer
  Dashboard, or `PUT /v2/webhooks/subscriptions/{id}`) from the `workers.dev` URL to
  `https://handmadedesignsbysuzi.com/api/square-webhook.php` — the subscription and
  `SQUARE_WEBHOOK_SIG_KEY` already exist and are verified (step 5, done 2026-08-01); only the URL
  needs to change.
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
- [x] `SQUARE_WEBHOOK_SIG_KEY` and USPS keys done and verified (2026-08-01) — webhook didn't
      actually need to wait for DNS, since the callback URL is derived dynamically per-request
- [x] Email live and verified — switched Resend → Brevo (done 2026-08-01), `BREVO_API_KEY` set,
      `mail.handmadedesignsbysuzi.com` authenticated/verified, `EMAIL_MODE=live`, confirmed with a
      real send through the real deployed code
- [x] `npx wrangler deploy` (production) succeeds; a full browser walkthrough against the
      `workers.dev` hostname worked end to end, including one real refunded live charge
      (done 2026-08-01 — ORD-MSAT7Q4O, real Square payment + refund IDs)
- [x] `regression_test.php` token rotated on live production (done 2026-08-01); `staging-login.html`
      deleted (its Basic Auth was already vestigial — staging is deliberately fully public)
- [ ] TTL lowered 48h+ before the nameserver change
- [ ] `routes` uncommented, nameservers repointed, Square production webhook live,
      read-only freeze observed during propagation

Only the last checkbox is the actual, irreversible-without-a-DNS-rollback cutover. Everything above
it is exactly as reversible as "do nothing" — this checklist can be worked through incrementally,
stopping after any item, with production still fully served by Hostinger the whole time.
