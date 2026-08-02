# HDBS — Project Status

> Working memory for the Handmade Designs By Suzi project. A brand-new session should be able to
> resume from this file alone. Newest status at the top.

---

## Current state — 2026-08-01 (Session wrap-up: staging Worker hostname conflict is the one open decision)

**End-of-session checkpoint, no new work beyond what's already logged below** — see the entries
underneath this one for the full detail on everything accomplished (payments milestone, the admin
log viewer, live Square/PayPal/Brevo/USPS credentials, and all of Phase A of the cutover). This
entry exists to record the one thing left genuinely open and a small piece of prep work sitting
uncommitted.

**Open decision, not yet made**: the user asked to point `staging.handmadedesignsbysuzi.com` at
the new `hdbs-staging` Worker. That's technically blocked until Phase B (Cloudflare Custom Domain
routes only take effect once the zone is actually active — nameservers still point at Hostinger's
`dns-parking.com`, not Cloudflare's, as of this entry). Prepped the config for whenever Phase B
happens: a commented-out `routes` block for `env.staging` in `wrangler.jsonc`, mirroring the
top-level production `routes` block's own commented-out pattern. **But caught a real conflict
before finishing it**: `staging.handmadedesignsbysuzi.com` is *already* the old PHP staging site's
hostname (the one this session just carefully preserved with a real CNAME to
`staging.handmadedesignsbysuzi.com.cdn.hstgr.net`, replacing Cloudflare's broken IP-snapshot
import). Pointing the new Worker at that same hostname would silently cut off the old PHP staging
site. Asked the user whether to use a different hostname for the new Worker (e.g.
`new-staging.handmadedesignsbysuzi.com`) or retire the old PHP staging site's URL outright — **not
yet answered**. The prepped `wrangler.jsonc` block still has the literal
`staging.handmadedesignsbysuzi.com` pattern in it and needs updating once this is decided; it's
fully commented out so it has zero effect either way until then.

**Also created/updated the `/BWEHDBSEnd` skill this session** (`C:\Users\Admin\.claude\skills\
BWEHDBSEnd\SKILL.md`) — it existed already but from the pre-migration PHP/FTP era (`dev`/`main`
branch promotion, `deploy.ps1`, `regression_test.php` conventions), all stale relative to this
entire session's actual work on Cloudflare/Supabase/`wrangler` against the `cloudflare-migration`
branch. Rewrote it to match current reality: tracks secrets by name only (never values), points at
`docs/phase-9-cutover-checklist.md` for cutover-specific detail, pushes to `cloudflare-migration`
instead of assuming `main`, and explicitly won't touch `deploy.ps1`/DNS/routes as a side effect of
wrapping up a session, given the standing production freeze. (Attempting to invoke it via the
Skill tool directly failed — "disabled for model invocation in skillOverrides settings" — so this
wrap-up entry was written by manually following the skill's own instructions instead.)

**Immediate next step for a future session**: get the user's answer on the staging hostname
question above, finish the `wrangler.jsonc` block accordingly, and then it's just the 48h TTL
wait (already running, started earlier today) before Phase B of
`docs/phase-9-cutover-checklist.md` can happen.

---

## Current state — 2026-08-01 (Phase A of the cutover fully complete — Cloudflare zone added, 2 real DNS bugs caught)

**Added `handmadedesignsbysuzi.com` to Cloudflare via "Connect"** (registration stays at Hostinger;
only DNS management moves). Reviewed the auto-imported DNS zone against hPanel's real records
before activating rather than trusting the import — found two real bugs, not cosmetic ones:

- **`ftp` A record imported as Proxied.** Cloudflare's proxy only speaks HTTP/HTTPS; `deploy.ps1`
  uses this exact hostname for every FTP deploy this project does. Left proxied, this would have
  silently broken every future deploy the moment nameservers switched. Fixed: DNS only.
- **`staging` imported as two static A records pointing at different literal IPs.** The real
  Hostinger record was an `ALIAS` (their CNAME-like feature) targeting
  `staging.handmadedesignsbysuzi.com.cdn.hstgr.net` — Cloudflare's importer can't replicate a
  proprietary record type, so it just snapshotted whatever IPs that CDN hostname happened to
  resolve to at import time. Since Hostinger's CDN almost certainly rotates those IPs, this would
  have silently broken staging at some unpredictable future point with no obvious cause. Fixed:
  deleted both, replaced with a real CNAME matching the original target exactly.

Also cleaned up (matching original unproxied Hostinger behavior, zero new risk):
`autoconfig`/`autodiscover` (mail-client autoconfig CNAMEs) and `test` (confirmed via a full
codebase grep and a live request returning a bare 403 that nothing references or serves anything
behind it) — all switched to DNS only. MX/SPF/DMARC/Brevo/Hostinger-mail records were already
correctly untouched by the import.

**Zone activated. Nameservers assigned: `arturo.ns.cloudflare.com`, `rayne.ns.cloudflare.com`** —
recorded in `docs/phase-9-cutover-checklist.md` for phase B, not applied anywhere yet. Confirmed
the domain is registered at Hostinger (not elsewhere), and the actual nameserver swap happens
under Hostinger's **Domains → Nameservers** section specifically — different from the DNS zone
editor used for everything above.

**Deliberately stopped before Cloudflare's own "replace your nameservers" step** — caught that this
was actually phase B's cutover trigger, not part of phase A, and the 48h TTL wait (started earlier
this session) hasn't elapsed. Cloudflare's own UI offers to skip that step for exactly this reason.

**Phase A of `docs/phase-9-cutover-checklist.md` is now fully complete.** Only the 48h wait
remains before phase B — the actual nameserver switch, route uncomment, and webhook URL update.

---

## Current state — 2026-08-01 (Cutover conversation: no maintenance mode, low-traffic window, rollback plan agreed)

**Talked through step 8 (the actual DNS/routes cutover) before scheduling it — not executed this
session.** One real gap surfaced by checking rather than assuming: neither the PHP site nor the
Worker has any maintenance/read-only mode. `docs/production-isolation.md`'s "short read-only
freeze" language was always aspirational, never actually built.

**Decision: no maintenance-mode build, accept a brief dual-availability window at a 300s TTL,
schedule phase B during a deliberately low-traffic window instead.** Reasoning: this is a
low-volume handmade-goods storefront, not high-traffic — the realistic exposure during DNS
propagation is a few minutes where some resolvers still reach Hostinger while others reach
Cloudflare, not a sustained double-serving problem. Building a real cross-stack maintenance toggle
would be new scope disproportionate to that risk.

**Rollback plan and triggers agreed in advance, not left to improvise mid-cutover**: phase A (TTL
lower + Cloudflare zone) is fully reversible with zero customer impact. Phase B rollback = repoint
nameservers back to Hostinger *first*, then pull `routes` back out of `wrangler.jsonc` *second* —
reversing that order briefly 522s visitors instead of falling back cleanly. Hostinger's PHP site is
never touched this whole migration, so it's instantly functional the moment DNS points back.
Rollback triggers: checkout failing for real customers, 5xx on the real domain, orders
not saving or saving wrong, or any sign of a double-processed order/payment.

**`docs/phase-9-cutover-checklist.md` step 8 rewritten** with this decision baked in, split into
phase A (prep, do anytime) and phase B (the actual cutover, low-traffic window) with the
rollback plan spelled out inline rather than left as a vague warning.

**Not yet scheduled to an actual date/time** — user wants to pick that separately.

---

## Current state — 2026-08-01 (USPS + Square webhook done — step 5 is now completely closed)

**USPS**: user already had Developer Portal credentials. Set on both Workers (USPS has no sandbox
tier — same real credentials everywhere, a finding from earlier in this migration). Verified twice:
a direct OAuth token request to USPS's real API succeeded, then the actual deployed
`validate_tracking.php` route returned a real historical order's real status ("Delivered, Front
Door/Porch") — no redeploy needed, only the missing secret was blocking it.

**Square webhook — a real assumption in the checklist turned out to be wrong, caught by rereading
the code instead of waiting.** The checklist said the webhook subscription needed DNS cutover
first. Rechecked `routes/payments.ts` before accepting that: `callbackUrl` is computed dynamically
from the incoming request's own origin, not hardcoded — so the subscription could be created
against the current `workers.dev` URL right now, with only its `notification_url` needing to
change after cutover, not the secret or any code.

Created a real subscription via Square's API, got a real signing key, set it. **Verified without
a real charge** (which would have hit the same live-vs-sandbox-nonce dead end as the earlier email
test) — used Square's own `POST .../test` endpoint instead: `status_code: 200`, confirming HMAC
verification against the real key works. Cross-checked `app_log`: a real `"COMPLETED but no order
ID found"` line landed in `webhook_log.txt` (expected, since Square's canned test payload
references a fake order id), proving the full handler executed, not just the signature check.

`bash scripts/check-secret-parity.sh` now reports **zero real gaps** — the only remaining "missing"
item is `SQUARE_APP_ID`, already flagged as likely-vestigial dead config in an earlier entry.

`docs/phase-9-cutover-checklist.md` step 5 is now **fully closed, all sub-items done and
independently verified**. The only remaining checklist item is step 8 itself — the actual DNS/routes
cutover, which now only needs a URL update in Square's dashboard afterward, not a new secret.

---

## Current state — 2026-08-01 (Email switched from Resend to Brevo — production live, verified end-to-end)

**Closes the email gap deferred earlier this session.** Investigated whether Brevo's free plan had
the same one-domain-per-account cap that blocked Resend, rather than trusting marketing copy:
**confirmed it doesn't**, by actually adding a second domain via Brevo's API and getting a clean
success. User signed up for Brevo themselves (account creation isn't something this session does),
added `mail.handmadedesignsbysuzi.com`, and added its 4 DNS records at Hostinger (2 DKIM CNAMEs, a
verification TXT, a DMARC TXT — all scoped under `mail.`, never the apex). One hiccup along the
way: the domain briefly vanished from Brevo's list between adding it and checking propagation —
re-added it (no data lost), then re-triggered authentication: `authenticated: true, verified: true`.

**Rewired `src/lib/email-sender.ts`'s `LiveEmailSender`** from Resend's API to Brevo's
`POST /v3/smtp/email` (different request shape — `to`/`replyTo` as `{email}` objects, `htmlContent`
not `html`). Renamed `RESEND_API_KEY` → `BREVO_API_KEY` in `src/types.ts` and all 6 route call
sites, and in `scripts/check-secret-parity.sh`. `npm test`: 497/497 unaffected. `tsc --noEmit`:
clean. Set the real key on both Workers (Brevo has no sandbox/live split), deleted the now-unused
`RESEND_API_KEY` from production, flipped `wrangler.jsonc`'s production `EMAIL_MODE` back to
`"live"` (it had been reverted to `"sink"` earlier this session), redeployed.

**Verified with two independent real sends, not just an API 200** — a direct Brevo API test first
(event log: `requests → delivered → opened`), then the one that actually matters: triggering
`send_confirm.php`'s real admin resend against a real order (`ORD-MSAT7Q4O`) through the actual
deployed production Worker, confirmed via Brevo's event log showing that exact order's subject
line delivered and opened. First time this whole migration has verified a real email send through
the real code path end to end, not a direct provider-API test.

**One diagnosed-not-just-retried failure along the way**: an attempt to test-charge a fresh order
(`TESTEMAIL-1`) to trigger a payment-confirmation email failed with "Payment configuration error."
Root cause: Square's published `cnon:card-nonce-ok` test nonce only works against Square's
**Sandbox** API — it was never going to work against the live Payments API used in production.
Re-verified `SQUARE_TOKEN`/`SQUARE_LOCATION_ID` directly against Square's live API to rule out a
credentials regression (still fine) before concluding this. Order deleted, real product stock
restored via a full-record update — same cleanup pattern as every other real-data test this
session.

`docs/phase-9-cutover-checklist.md` step 5 is now fully closed. Remaining before cutover: USPS
credentials (optional), `SQUARE_WEBHOOK_SIG_KEY` (needs live DNS), and step 8 itself.

---

## Current state — 2026-08-01 (Email provider decision deferred; production flipped back to EMAIL_MODE=sink)

Resend's free tier only covers one verified domain per account, and this Cloudflare/Resend account
already has one from a sibling project — a second domain (`mail.handmadedesignsbysuzi.com`) needs
a $20/mo plan upgrade. Presented the real options (pay, reuse the existing verified domain at the
cost of a less on-brand from-address, switch to a free-tier provider like Brevo requiring a new
`EmailSender` implementation, or defer) — **user chose to defer**.

**`wrangler.jsonc`'s production `EMAIL_MODE` flipped from `"live"` back to `"sink"`, redeployed,
confirmed in the deploy output.** Reasoning, documented inline in the config: `LiveEmailSender`
doesn't throw on a failed Resend call, it just logs `status: "failed"` — so leaving `EMAIL_MODE`
on `"live"` with an unverified domain wouldn't crash anything, it would silently fail every real
send in a way indistinguishable from a genuine bug. `sink` is the honest, deliberate state until a
provider decision is actually made — matches staging's own default, not a regression.

**Flagged prominently in `docs/phase-9-cutover-checklist.md` step 8**, not just step 5: cutting
over to the real domain with `EMAIL_MODE` still on `sink` means real customers get zero order
confirmation emails. This needs to be resolved (or explicitly, consciously accepted) before routes
are ever uncommented — not something to let slip through silently once step 5's other items look
done.

`npm test`: 497/497 (unaffected — a config var change, not application logic). `tsc --noEmit`:
clean.

---

## Current state — 2026-08-01 (RESEND_API_KEY set on production, but the sending domain isn't verified yet)

`RESEND_API_KEY` is now set on production. Confirmed genuinely valid without needing domain-read
access: calling Resend's API directly returned "restricted to only send emails" (401
`restricted_api_key`) rather than an invalid-key error — a real key, correctly scoped send-only.

**Real send attempt exposed a real gap, not assumed from the checklist alone**: sent an actual test
email via Resend's API using the exact from-address `src/lib/email-sender.ts` uses
(`orders@mail.handmadedesignsbysuzi.com`) to the user's own inbox — got back Resend's own `403
domain_not_verified`. The sending domain was never added/verified in Resend at all. Per
`docs/phase-0-checklist.md` step 5, this needs the domain added in Resend's dashboard and its
DKIM/SPF records added to Hostinger DNS on the `mail.` subdomain (never the apex, which runs
Suzi's real mailbox) — account/DNS work only the user can do.

**Until this is fixed, every real production email will silently fail with a 403** the same way a
missing key would have — `EMAIL_MODE=live` alone isn't enough. This is now the one concrete blocker
left in step 5 of `docs/phase-9-cutover-checklist.md`.

---

## Current state — 2026-08-01 (Phase 9 checklist step 7 done: both carried-over Phase 0 security fixes)

**`regression_test.php`'s `rt_token` rotated on the live production PHP site** — a different
system than everything else this session touched (still the real Hostinger MySQL app serving
customers today, pre-cutover). User provided a real admin session token; called the live
`admin.php`'s `set_setting` action with a freshly-generated value, piped straight in and never
echoed. Verified the old plaintext value from `Claude.md` now 403s, without printing the new one.
`Claude.md` no longer hardcodes any real token value.

**`staging-login.html` deleted outright, not just rotated — a real finding changed the plan
mid-task.** Its Basic Auth credentials turned out to already be vestigial: staging's real
`.htaccess` has a deliberate override (with its own comment) granting the whole directory to
everyone, since staging is intentionally fully public (`noindex` is the actual gate). Didn't just
assume this from reading the comment — rotated the `.htpasswd` hash via FTP first (generated a
fresh SHA-512-crypt hash with `openssl passwd -6`, matching Hostinger's existing format) and
confirmed both the old and new passwords produced the identical result against a real request,
proving auth genuinely isn't enforced. Deleted the file from git, and from the live server via FTP
`DELE` — first attempt used the wrong path (assumed it lived under `staging/`; it's actually at the
site root), caught by checking the real directory listing rather than trusting the command's exit
code.

`npm test`: 497/497 (unaffected). `tsc --noEmit`: clean.

`docs/phase-9-cutover-checklist.md` step 7 is now fully done. Remaining before cutover: the last
pieces of step 5 (`RESEND_API_KEY`, USPS, `SQUARE_WEBHOOK_SIG_KEY`), and step 8 itself.

---

## Current state — 2026-08-01 (Phase 9 checklist step 6 done: first real production deploy, real live charge verified)

**`npx wrangler deploy` (no `--env`) — production's first redeploy since the Phase 0 scaffold.**
Bindings confirmed correct on deploy: real `hdbs-public`/`hdbs-private` R2 buckets,
`ENVIRONMENT=production`, `EMAIL_MODE=live`.

**Cron trigger registration failed (`Error 10072`, account-wide 5-cron Free-plan cap already hit by
sibling projects) — investigated, then deliberately deferred rather than fixed.** Found `hdbs` has
no `scheduled()` handler anywhere in `src/` at all, so the two declared cron expressions currently
have nothing to call — the registration failure has zero functional impact today. Put to the user
rather than assumed: they chose to defer rather than disable a sibling's cron or upgrade the plan.

**Automated checks**: `/api/health` (200, `phase: 0` noted as a cosmetic Phase-0 leftover),
`/api/products.php` (real 47-product catalog), `/api/admin.php` (correctly 401s, confirming the
full admin surface including this session's log-viewer work is live).

**A real live charge through the actual browser checkout UI — the first time this entire migration
has verified the real frontend against a live payment, not an API curl.** User opened the
`workers.dev` storefront, bought the $35 "ETCC Logo Crossbody" with a real card. A Permissions-
Policy console violation appeared during checkout (`payment=(self)` in
`src/lib/security-headers.ts`) — investigated rather than assumed benign, confirmed harmless only
once the charge actually succeeded (Square's manual card entry doesn't need the Payment Request
API, only Apple/Google Pay detection does). Real order `ORD-MSAT7Q4O` landed `Paid` with a real
Square payment id, correct $48.41 total. Refunded immediately after as planned — real refund id,
order moved to `Refunded`. `email_sent: false` on the refund, expected since `RESEND_API_KEY` isn't
set yet.

**One real-data cleanup, different from every disposable staging test order this session**: the
refund didn't restock the real product (refunds never restock, a faithfully-preserved PHP quirk) —
but this is Suzi's actual catalog, not throwaway data, so it was flagged to the user rather than
silently left or silently fixed. Restored to stock `1` via a real `POST /api/products.php`
full-record update, verified afterward that images/other fields were untouched.

`docs/phase-9-cutover-checklist.md` step 6 is now fully done. Remaining before cutover: step 7
(carried-over security fixes), the last pieces of step 5 (`RESEND_API_KEY`, USPS, and
`SQUARE_WEBHOOK_SIG_KEY` which needs live DNS first), and step 8 itself (the actual DNS/routes
flip).

---

## Current state — 2026-08-01 (Phase 9 checklist step 5, in progress: Square + PayPal now live on production)

**Live Square and PayPal credentials are now set on the production Worker** — the first real
payment credentials production has ever had. Both verified genuinely live, not just accepted at
face value:
- Square: `GET https://connect.squareup.com/v2/locations` (the live host) with the real token
  returned a real business — "Handmade Designs By Suzi," Knoxville TN, `id: LJP687TQBTWTA` —
  confirming both the token and location id are real and correctly paired.
- PayPal: requested a live OAuth token from `https://api-m.paypal.com/v1/oauth2/token` with the
  real client id/secret — got a real token back with a real `app_id` (`APP-5TH15273DV406260E`).

**Also self-generated fresh `ORDER_TOKEN_SECRET`/`SMOKE_TOKEN`** for production (32 random bytes
each, no external account needed) — different values than staging's, per
`docs/phase-0-checklist.md`'s explicit "do not reuse" warning. Also set `SMOKE_TOKEN` on staging
(it was missing there) for name-parity. `bash scripts/check-secret-parity.sh` now passes — it was
failing at the start of this step.

**One process mistake, caught immediately, no actual exposure**: the first `ORDER_TOKEN_SECRET`
generation attempt printed a candidate value into the visible transcript before being piped to
`wrangler secret put`. That exact value was never applied — the corrected command generated fresh
random bytes and piped them directly into `wrangler secret put` without ever echoing them, the same
pattern used for every credential since. Worth remembering: `console.log`-then-pipe is not the same
as pipe-only, and only the latter is safe for anything sensitive.

**One finding, not a fix**: `SQUARE_APP_ID` (declared in `src/types.ts`'s `Env`, expected by
`check-secret-parity.sh`) is never actually read anywhere in `src/` — the real value the storefront
needs comes from the `settings` table's `square_app_id` row instead (already real, migrated in
step 2). Likely dead config; flagged for a future small cleanup rather than fixed here.

**Still outstanding for step 5**: `SQUARE_WEBHOOK_SIG_KEY` (can only be created after the real
domain exists post-cutover), `RESEND_API_KEY` + verified sending domain (without this, production
silently stays in email-sink mode forever), and USPS credentials (lower priority, still deferred).

---

## Current state — 2026-08-01 (Phase 9 checklist step 4 done: real media migrated to R2)

**New script `scripts/push-media-to-r2.mjs`** — the piece `migrate-data.mjs` deliberately never
covered (Postgres rows only, no binary files). Walks `media-mirror/`'s subdirectories, shells out to
`wrangler r2 object put --remote` per file, matching `src/routes/media.ts`/`src/business.ts`'s
exact bucket/prefix expectations. `--staging` flag to target either environment, dry-run-by-default
like `migrate-data.mjs`.

**One real bug caught before trusting it at scale**: the first version combined
`execFileSync(..., {shell:true})` with an argument array — a genuine Node-flagged injection-risk
pattern, even though every arg here is fixed/trusted (bucket names, `media-mirror/` file listings,
never user input). Switched to `execSync` with a single manually-quoted command string, the
pattern actually built for that combination. Re-ran the full batch to confirm the fix before
trusting the first run's "160 uploaded, 0 failed" result.

**Result, verified not just trusted**: 159 product images + 1 business logo uploaded to BOTH
`hdbs-public` (production) and `hdbs-public-staging`, spot-checked byte-for-byte identical to the
local file via `wrangler r2 object get`. Staging's bucket previously only had a handful of images
from this session's live admin-UI testing — now has the full real catalog too, as a useful side
effect of building this for production.

**What's still missing, not new**: `business_hero`/`business_about`/`studio_images` (confirmed
empty/unreferenced in production, per Phase 0) and — the real gap — 13 capital-equipment receipts
and the business license/resale-certificate docs, which Phase 0's checklist already flagged as
needing a manual hPanel File Manager pull (FTP can't reach above the webroot). Still the account
owner's call whether that matters before cutover; the script will pick them up automatically once
`media-mirror/capital_equipment_receipts/`/`business_documents/` exist.

`npm test`: 497/497 (unaffected — this is an ops script, not application code). `tsc --noEmit`:
clean.

---

## Current state — 2026-08-01 (Phase 9 checklist step 3 done: production R2 buckets created)

`npx wrangler r2 bucket create hdbs-public`/`hdbs-private` — both didn't exist before this (per the
readiness audit below). Confirmed both are private (`wrangler r2 bucket dev-url get` reports r2.dev
public access disabled for each, same as the staging buckets). Bucket names already matched
`wrangler.jsonc`'s existing production bindings, so no config change needed.

Buckets are empty — migrating the real product/logo/studio media into them is step 4 of
`docs/phase-9-cutover-checklist.md`, not done yet.

---

## Current state — 2026-08-01 (Phase 9 checklist steps 1-2 done: production Supabase is schema- and data-complete)

Working through `docs/phase-9-cutover-checklist.md` (see that file for the full ordered plan; this
is just the running log). **Steps 1 and 2 are both done and independently re-verified, not just
run:**

- **Step 1 (schema):** ran `0010_stock_adjustment_functions.sql` and `0011_app_log.sql` against
  production (`ckiyvsejstptrnwkinir`) via the `/Supabase` skill's browser flow. A pre-check
  diagnostic found production had zero rows anywhere (not even `settings`) — worse than the stale
  "schema through 0008" note assumed, good to have checked rather than trusted it.
- **Step 2 (data):** the user ran `node scripts/migrate-data.mjs --write --allow-prod` themselves,
  in their own terminal, with production's real `SUPABASE_SERVICE_ROLE_KEY` — the key never passed
  through chat, same rule as every other secret handled this session. Loaded the freshest daily
  backup (`202608010000HDBS.sql`). Then ran `0009_normalize_image_urls.sql` (held back until now,
  per its own header).
- **Every claim re-verified independently**, not trusted from tool output: a diagnostic query
  confirmed `has_app_log_table=1`/`has_stock_functions=1` after step 1; a 12-table count query
  matched the dry-run preview exactly after step 2 (63 settings, 47 products, 2 orders, 4
  order_items, 1 refund, 1 review, 11 faqs, 7 email_log, 2 subscribers, 52 tn_city_tax, 17
  studio_items, 13 capital_equipment); a targeted absolute-URL count confirmed zero remaining
  after `0009` and all 47 products now have root-relative `/product_images/...` paths.
- Chrome extension wasn't connected this session, so every SQL run/verification was done by the
  user pasting results back rather than me driving the browser directly — still fully verified,
  just via a different mechanic than the `/Supabase` skill's normal flow.

**Production Supabase is now schema- and data-complete.** Remaining before cutover, per the
checklist: R2 buckets/media (step 3-4), live payment/API secrets (step 5), first real production
deploy (step 6), carried-over security fixes (step 7), and the actual DNS/routes flip (step 8).

---

## Current state — 2026-08-01 (Phase 10/9 cutover readiness audit: production is still Phase-0-era)

**Started a cutover readiness review and found production is far less ready than "everything's
ported" implied.** Every module this whole migration has built was verified against **staging**
only — checked the actual state of the production Worker/Supabase/R2 rather than assuming, and it
hasn't been touched since the very first scaffold deploy:

- `npx wrangler deployments list` (production): exactly one code deploy, from Phase 0
  (2026-08-01T12:31:33), plus two secret-change events. Nothing since.
- `npx wrangler r2 bucket list`: only `hdbs-public-staging`/`hdbs-private-staging` exist.
  **Production's `hdbs-public`/`hdbs-private` don't exist yet.**
- Production Supabase (`ckiyvsejstptrnwkinir`): schema only through migration `0008` (per the
  Phase 2 note below — not re-verified since, worth confirming fresh). **Zero real data** —
  `scripts/migrate-data.mjs` has only ever been run against staging (Phase 1 entry below says so
  explicitly: "real prod data now lives on staging Supabase").
- `npx wrangler secret list` (production): only `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. Missing
  `ORDER_TOKEN_SECRET`, all Square/PayPal keys, `RESEND_API_KEY`, `SMOKE_TOKEN`, USPS keys —
  `bash scripts/check-secret-parity.sh` fails today, confirmed by actually running it rather than
  assuming parity.

**Wrote `docs/phase-9-cutover-checklist.md`** — a full ordered runbook (schema catch-up → real data
load → R2 provisioning → media migration → live secrets → first real production deploy → security
fixes carried over from Phase 0 → the actual DNS/routes cutover), 👤/🤖-tagged like
`docs/phase-0-checklist.md`. Deliberately a **plan document only** — nothing in it was executed
this session; the user chose "write the runbook" over "start executing" when asked. See that file
for the full ordered checklist; don't re-derive it here.

**The one-sentence version for a future session**: "every PHP endpoint is ported" (the milestone
several entries below) was true and still is, but it answered a different question than "is
production ready to cut over." Those are not the same claim, and conflating them is exactly the
mistake this audit exists to catch before it becomes a live incident.

---

## Current state — 2026-08-01 (PayPal capture closed the loop: all four payment endpoints now fully live-verified)

**The one gap left by the milestone below — a real PayPal capture — is now closed too.** A real
PayPal order (`6DN58399PH770464S`) was approved via a genuine browser walkthrough of PayPal's own
sandbox checkout (`https://www.sandbox.paypal.com/checkoutnow?token=...`), logged into by the user
with their own sandbox buyer account (not something this session could do itself — entering a
password is off-limits even for a sandbox account). The subsequent capture succeeded for real:
`payment_id 13128007K2948142B`, `$57.29` total including the `$2.41` surcharge, order landed `Paid`
with `pay: "PayPal"`, correct fee/tax, confirmation email logged. Test order (`TESTPP-CAP-1`)
cleaned up afterward, consuming one more product's stock (`p1782310425206`) — same accepted
"deleting doesn't restock" residue as the milestone below.

**Every one of the four payment/refund endpoints has now been proven against a real processor
sandbox, not just fakes or auth-gate checks**: Square charge, Square refund, PayPal create, and
now PayPal capture. This is the first time in the whole migration that "live-verified" for payments
means a real charge actually moved (simulated) money, not just "failed gracefully with no
credentials."

---

## Current state — 2026-08-01 (First real payment credentials: Square + PayPal sandbox live-verified end-to-end)

**The "no live credentials exist yet" caveat repeated at every prior payments-related milestone is
now closed for Square and PayPal.** The user obtained real sandbox credentials and handed them over
in chat; set via `wrangler secret put --env staging`: `SQUARE_TOKEN`, `SQUARE_LOCATION_ID`,
`PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`. (GitHub/USPS credentials still not provided — those endpoints
remain auth/config-gated only, as before.)

**One real credential mix-up caught and self-corrected, not the user's fault**: the location id
first given (`sandbox-sq0idb-...`) turned out to be an Application-ID-shaped value, not a location
id — Square rejected the charge with `Not authorized to take payments with location_id=...`.
Diagnosed by calling Square's own `GET /v2/locations` directly with the token rather than guessing,
which returned the token's real sandbox location (`LVD15H6H5R4NW`, "Default Test Account").
Corrected the secret and the charge succeeded on retry — worth remembering that Square's own
dashboard surfaces several similarly-shaped ids (app id, location id, access token) and only the
API itself can confirm which one actually pairs with a given token.

**All three real money-movement paths now proven against real processor sandboxes, not fakes**:
- **Square charge** (`process_payment.php`): created a real order, charged it with Square's own
  published test nonce (`cnon:card-nonce-ok`), got a real payment id
  (`N2gUA259kBbYGFnUULTeFH97FL9YY`) back, confirmed the order landed `Paid` with that id attached
  and a confirmation email logged.
- **Square refund** (`refund.php`): charged a second real order, then fully refunded it — real
  Square refund id back, order correctly moved to `Refunded`, confirmation email sent.
- **PayPal create** (`paypal_create.php`): created a real PayPal sandbox order
  (`90906452V67284825`) against a real Supabase order row, correct surcharge/total math.
  **PayPal capture** couldn't complete headlessly — pre-approval capture is normal PayPal behavior,
  not a bug — but the attempt returned PayPal's own real rejection message
  (`"Payer has not yet approved the Order..."`), which is itself useful: it confirms
  `paypal_capture.php`'s error-surfacing is correct against a real API response, not just a
  fake's canned string.

**Also closes the one remaining unverified leg from the admin-log-viewer milestone above**: that
PayPal capture failure produced a REAL `PP-CAPTURE-FAIL` row in the real `app_log` table (not
`AppLogStoreFake`), confirmed readable back out through `read_log` in the exact
`applog()`-matching text format
(`"2026-08-01 2:26:36 PM EDT | PP-CAPTURE-FAIL | Order: TESTPP-1 | ..."`). The insert path is no
longer only unit-tested.

Three test orders created and fully cleaned up afterward (`TESTPP-1`, `TESTSQ-1`,
`TESTREFUND-1` — deleted via `DELETE /api/orders.php`, and the test `app_log` row cleared via
`clear_log`). Two of this session's storefront products (`p1780859837233`, `p1782399703619`,
`p1782562281099`) had their stock consumed by these real orders and were **not** restocked, since
deleting an order doesn't restock (a documented, faithfully-preserved PHP quirk, not new residue) —
worth a `node scripts/migrate-data.mjs --write` reset if pristine catalog stock numbers matter
before this data is shown to anyone.

**What's still not exercised end-to-end**: a real PayPal *capture* (needs either a headless
sandbox-buyer-approval flow or a manual browser walkthrough of PayPal's own checkout UI — not
something a server-side script can complete alone), and anything gated on GitHub/USPS credentials
(still not provided).

---

## Current state — 2026-08-01 (Admin log viewer: a real Supabase table replaces the disk files)

**`api/admin.php`'s `read_log`/`clear_log`/`get_error_log` actions are ported** — the last
still-TODO surface called out at the end of the "smaller tail" milestone below. These three read
and write plain text files on Hostinger's disk (`notify_log.txt`, `webhook_log.txt`,
`error_log.txt`, `pages.log`); a Worker has no filesystem, and the earlier `applog.php` port
already replaced the underlying writes with `console.error` (viewable only live via `wrangler
tail`, nothing queryable after the fact) — so the admin log *viewer* had nothing left to read.

**A genuine architecture decision, put to the user rather than assumed**: drop the viewer
(`wrangler tail`/Cloudflare's own dashboard already cover live debugging) vs. rebuild it on a real
table. The user chose to rebuild it — same choice pattern as the github_log/repo_stats/db_backup
decisions in the milestone below.

**New module `src/app-log.ts`**: an `app_log` Supabase table (`supabase/migrations/0011_app_log.sql`,
RLS enabled like every other table), one row per log line (`file`/`context`/`message`/`logged_at`),
replacing the PHP's per-file text blob. `readLog`/`clearLog`/`getErrorLog` port the three admin.php
actions exactly — same 200-line cap + reversal for `read_log`, same 100KB tail-truncation banner
for `get_error_log`, same `$allowed` file list and "Invalid log file"/"No entries yet." messages.
Wired into `routes/admin.ts` behind the same admin-token gate as `set_setting`.

**Only two of the four files have real writers today, matching what's already ported**: `notify`
(payments.ts's `PAYMENT-FAIL`/`PP-CREATE-FAIL`/`PP-CAPTURE-FAIL`, refunds.ts's `REFUND-FAIL` — all
four already had `console.error` call sites from the payments milestone; each gained a
best-effort `appLog.append()` alongside it, swallowing its own errors so a logging failure can
never fail the payment/refund it's logging about) and `webhook` (the Square webhook handler's own
`PAID`/`COMPLETED but no order ID found` line, matching `square-webhook.php:89-95` byte-for-byte in
content). `error` (gated on `debug_mode`) and `pages` (gated on `log_page_changes`) have no ported
writer yet — same as the live PHP, which only populates those once debug mode or page-view logging
is turned on. They're still valid, listable/clearable files, just empty until something writes to
them — not a gap introduced by this port.

`npm test`: 497/497 passing (13 new: 9 in `app-log.test.ts`, plus one targeted write-path test each
in `payments.test.ts` (×2, PAYMENT-FAIL + webhook) and `refunds.test.ts`). `tsc --noEmit`: clean.

**Live-verified against staging, real Supabase round trip**: migration `0011_app_log.sql` applied
by the user via the Supabase SQL editor (RLS enabled, matching the project's standing pattern).
Confirmed real auth gating (401 with no/bogus token), a real `SELECT` (`read_log` on an empty
table returns `"No entries yet."`, not an error — proves the table exists and RLS/service-role
access works), a real `DELETE` (`clear_log` returns success), `get_error_log`'s placeholder
message, and the shared "Invalid log file" rejection for an unknown file name. **Did NOT
live-verify an actual write** — same root cause as the payments milestone: Square/PayPal
credentials are still unset on staging, so none of the three writer call sites (`chargeOrderWithSquare`,
`createPaypalOrderForCheckout`, the webhook handler) can be reached end-to-end yet. The insert path
is covered by dedicated unit tests against `AppLogStoreFake` instead, same as every other module
whose live credentials don't exist yet.

**Everything identified in this project's PHP-to-Cloudflare migration plan is now either ported or
a deliberate, confirmed drop.** What's left before cutover is exactly what the milestone below
already said: real Square/PayPal/GitHub/USPS credentials (owner-only), and Phase 10 itself
(uncommenting `routes` in `wrangler.jsonc`).

---

## Current state — 2026-08-01 (The "smaller tail": every remaining PHP endpoint except the three deliberately dropped)

**Every PHP endpoint identified in this session's full-migration audit is now either ported or a
confirmed, deliberate drop.** Following the payments milestone, the entire remaining backlog was
cleared in one continuous pass: `refund.php`, `paypal_payments.php`, `paypal_status.php`,
`square_payments.php`, `products_csv.php`, `usps.php`/`validate_tracking.php`, `applog.php`,
`github_log.php`, `repo_stats.php`, and `db_backup.php`. 84 new tests, 484/484 passing overall,
typecheck clean, every route live-verified on staging (auth gates confirmed correct; no live
credentials exist yet for Square/PayPal/GitHub/USPS, same gap as the payments milestone).

**`refund.php`** (`src/refunds.ts`, `src/routes/refunds.ts`) — full/partial refund via a real
Square refund (card orders), a real PayPal capture-refund (PayPal/Venmo orders), or a ledger-only
entry for Cash/Check, plus a third confirmation-email template
(`buildRefundEmailHtml`/`sendRefundEmail` in `email.ts`). `SquareGateway`/`PayPalGateway` (from the
payments milestone) each gained a `refund`/`refundCapture` method, reusing the existing injection
pattern rather than a new abstraction. One subtlety worth remembering: a Square/PayPal refund
REJECTED by the processor does **not** get a ledger row at all (the PHP calls `fail()` before its
`INSERT INTO refunds`) — the ledger only ever records refunds that actually went through.

**Three admin payment-reporting screens** (`src/payment-reports.ts`,
`src/routes/payment-reports.ts`) — `paypal_payments.php` (sourced entirely from our own orders
table, no live API call needed), `paypal_status.php` (a live OAuth credential check that never
exposes the credential values themselves — `PayPalGateway` gained `verifyCredentials(): Promise
<boolean>` for exactly this), and `square_payments.php`'s **read-only reporting half** (a live
Square List Payments call joined against our own orders table for tax/refund status, since Square
never itemizes tax and refunds are issued through our own admin, not Square's). Square's
`backfill_fees` POST action — a historical-data maintenance tool for orders that predate the async
webhook going live — was deliberately NOT ported; new orders get their fee from the webhook going
forward, so this only matters for pre-webhook historical orders, a one-time cleanup job rather than
ongoing reporting surface.

**`products_csv.php`** (`src/lib/csv.ts`, `src/products-csv.ts`, `src/routes/products-csv.ts`) —
export and merge/replace import. Workers has no `fgetcsv()`/`fputcsv()` equivalent, so this
required a real (if minimal) RFC 4180 parser/serializer from scratch — real product descriptions
routinely contain commas, so a naive `split(",")` genuinely wasn't viable. Two PHP `!empty()`
subtleties caught by reading the source closely rather than assuming: a present-but-**blank**
`sell` CSV cell casts to `(int)'' = 0` (not-for-sale), but an **entirely absent** `sell` column
defaults to 1 (for-sale) — array_combine() always sets the key when the column exists, even for a
blank cell, so the PHP's `?? 1` fallback only ever fires when the column is missing outright. And
`cogm`'s `!empty()` treats a literal `"0"` cell the same as a blank one (falls back to the
price-based default), which a naive JS truthy check on the string `"0"` would get backwards (a
non-empty string is truthy in JS). Both are covered by dedicated tests.

**`usps.php`/`validate_tracking.php`** (`src/lib/usps-gateway.ts`, `src/shipping-tracking.ts`,
`src/routes/shipping-tracking.ts`) — live USPS Tracking API v3 lookup, same gateway-injection
pattern as Square/PayPal. No sandbox/live split to resolve here at all (USPS has no sandbox
tracking data reachable with this app's product tier, per the PHP's own header comment — both
environments always call the real API).

**`applog.php`** — not an HTTP endpoint at all, just a shared PHP logging helper
(`applog()`/`dbg()`/`pagelog()`) that other files `require_once`. "Porting" it meant adding the
missing `console.error(...)` calls (visible via `wrangler tail`, the Workers-native equivalent of
a log file) at the failure points in `payments.ts`/`refunds.ts` that called `applog()` in the
original — `PAYMENT-FAIL`, `PP-CREATE-FAIL`, `PP-CAPTURE-FAIL`, `REFUND-FAIL` — matching the
original's context tags so a future `wrangler tail` session reads the same way the old log files
did. The admin-facing log *viewer* (admin.php's `email_log`/`deploy_log`/`app_log`/`github_log`
actions) remains a separate, still-TODO item in `routes/admin.ts`.

**`github_log.php`/`repo_stats.php`** (`src/lib/github-gateway.ts`, `src/github-log.ts`,
`src/repo-stats.ts`, `src/routes/github-log.ts`, `src/routes/repo-stats.ts`) — the admin "Change
History" screen. `github_log.php` ported closely: `curl_multi`'s parallel per-commit file-count
fetches become `Promise.all`, and the PHP's 10-minute file cache becomes Cloudflare's Cache API
(`caches.default`) at the route layer — same intent (don't hammer GitHub's API on every admin page
load), Workers-native mechanism. `repo_stats.php` needed a genuine re-architecture, not a literal
port: it scanned the **live deployed directory** on Hostinger (`RecursiveDirectoryIterator` over
`public_html`) for file/line counts, and a Worker has no filesystem to walk, deployed or otherwise.
Replaced with GitHub's recursive git-tree API for file listing (one call) and
`raw.githubusercontent.com` fetches for line counts, capped at 400 files scanned to bound
subrequests per request — large enough to cover this codebase's real file count today.

**`db_backup.php`** (`src/db-backup.ts`, `src/routes/db-backup.ts`) — also a genuine
re-architecture, not a literal port: the PHP built a *runnable MySQL dump* (`SHOW CREATE TABLE` +
`INSERT` statements), a format meaningless against Supabase's Postgres, and a Worker has no
`pg_dump` binary to shell out to for a real equivalent. Replaced with a JSON export of every row in
every one of the 20 tables `supabase/migrations/*.sql` creates — not a re-runnable script, but the
same underlying guarantee (a portable snapshot of every row), which is what a backup actually
needs to provide. **Scope deliberately narrower than the PHP in one way**: only the `?download=1`
mode is ported (token-gated direct response) — the PHP's other mode emails the dump as an
attachment via `sendEmailWithAttachment()`, and this codebase's `EmailSender` abstraction
(`src/lib/email-sender.ts`) has no attachment support yet (nothing else ported so far has needed
it). Shipping a fake "emailed" mode that claims an attachment exists when it doesn't would be
actively misleading, so it's deferred rather than half-built — and download is the mode the PHP's
own comment already calls out as the one that actually matters ("the only way to get the dump text
at all," for local tooling like the `/BWEHDBSBackup` skill). Reuses the already-ported
`backup_token` auto-generation in `settings.ts` (already in `AUTO_TOKEN_KEYS`) rather than
reimplementing that logic.

**Three product decisions confirmed by the user before any of this was built** (github_log.php,
repo_stats.php, db_backup.php: port all three, not drop) — these are all genuinely low-stakes
admin/dev conveniences, so the recommendation each time was "drop, since the platform's own tooling
already covers this," but the user chose to keep all three working on the new stack.

`npm test`: 484/484 passing (84 new across this batch: 35 payments + 14 refunds + 9 payment-reports
+ 8 csv + 14 products-csv + 7 shipping-tracking + 5 github-log + 5 repo-stats + 4 db-backup —
tallies to more than 84 because some of those were already counted in the payments-milestone
entry above; see individual test files for exact per-module counts). `tsc --noEmit`: clean.

**Live-verified on redeployed staging, auth gates only** — same caveat as the payments milestone:
Square/PayPal/GitHub/USPS credentials are still unset on staging, so every route was confirmed to
fail gracefully (401/403/"not configured") rather than crash, not exercised end-to-end against a
real external API. `refund.php` additionally confirmed against a real order id (401 unauthenticated
on both GET and POST, matching the PHP's file-level `requireAdmin()`).


## Current state — 2026-08-01 (Payments: Square charge + PayPal create/capture + webhook)

**The single largest remaining migration gap is now closed in code**: `api/process_payment.php`
(Square charge), `api/paypal.php` + `paypal_create.php` + `paypal_capture.php` (PayPal Orders v2),
and `api/square-webhook.php` (async status backstop) are all ported. Every other checkout-blocking
gap identified in this session's full-migration audit is resolved:

- **Three open decisions confirmed by the user, all "drop"**: `checkout.php` (legacy admin-gated
  Square hosted links), `order_lookup.php` (guest magic-link lookup — production's own
  `order_lookup_requests` table has never existed), and `admin.php`'s arbitrary-SQL DB browser
  (superseded by Supabase's own SQL editor). None of the three are ported; see "Open decisions"
  above, now marked resolved.
- Everything else (products, orders, customers, subscribers, tax, content, contact, studio,
  business docs, settings/biz_profile, admin auth) was already ported before this session.
- Deliberately still deferred, lower-stakes than a working checkout: `refund.php` (admin-initiated
  post-purchase refunds), the three admin reporting screens (`paypal_payments.php`,
  `paypal_status.php`, `square_payments.php`), `applog.php`, `repo_stats.php`, `github_log.php`,
  `products_csv.php`, `usps.php`/`validate_tracking.php`, `db_backup.php`.

**Architecture decision, not a literal port**: the PHP branches sandbox-vs-live at request time
(`square_mode` DB setting, `pp_env()` hostname sniff). This migration already committed to a
different model — identical secret *names* across both Workers, different *values*
(src/types.ts's own header) — so `src/lib/square-gateway.ts`/`src/lib/paypal-gateway.ts` take
already-resolved credentials + base URL (via `apiHosts(env)`) rather than re-implementing the
branch. One real consequence: `SQUARE_SANDBOX_LOCATION_ID` (a second constant PHP used only in
test mode) has no equivalent — there's only ever one location id per Worker now.

**A genuine, easy-to-miss inconsistency between the three PHP files' `test_mode` bypass, preserved
exactly rather than unified**: `process_payment.php`'s test_mode returns *before* the atomic
Awaiting-Payment→Processing claim; `paypal_create.php`'s returns *before even loading the order
row* (create never mutates order state); `paypal_capture.php`'s test_mode runs *after* the atomic
claim, so a test-mode capture still briefly locks the order to Processing. Verified with dedicated
tests per function rather than assuming they'd all behave the same way.

**MD5 → SHA-256 substitution**: Square's idempotency key was `md5($source_id)` truncated to 8
hex chars — Workers' Web Crypto has no MD5. Substituted a SHA-256 prefix (same reasoning as
routes/orders.ts's existing sha256Hex helper for rate-limit keys) — nothing anywhere compares this
value against a stored PHP-generated one, so the substitution is invisible to Square's own
idempotency semantics.

**square-webhook.php's order-identification has two fallback paths that likely never fire in
practice, ported as-is rather than fixed**: fallback #1 regexes for `"Order XXXX"` in the payment
note, but `process_payment.php` sets `note` to the *bare* order id with no "Order " prefix.
Fallback #3 queries `WHERE square_payment_id = payment.order_id` — comparing a column that always
holds a *payment* id against Square's *separate* order-id identifier space. Only fallback #2
(match the most recent non-final order by amount) is realistically effective for payments this
codebase's own checkout creates — Square Terminal/POS sales might still populate `note`
differently, which is why fallback #1 wasn't simply deleted. Not a security issue, so not fixed
per this migration's standing policy — documented in `src/payments.ts`'s own header instead.

**New shared infrastructure**: `src/lib/square-gateway.ts` and `src/lib/paypal-gateway.ts` (real
`fetch`-based API clients behind an interface, same injection pattern as
`src/lib/email-sender.ts`, with `Fake*Gateway` test doubles in `src/payments.ts`). `OrdersStore`
(orders.ts) gained `getOrder`/`getOrderItems`/`claimForProcessing`/`releaseFromProcessing`/
`findOrderByAmount`/`findOrderBySquarePaymentId`, and `OrderUpdatableFields` gained
`square_payment_id`/`paypal_capture_id`/`paypal_surcharge`/`confirm_sent_at`. `email.ts` gained a
second, simpler confirmation template (`buildPaymentReceivedEmailHtml`/`sendPaymentReceivedEmail`,
porting `order_confirm_email.php`) distinct from its existing `send_confirm.php`-derived one — the
two were already documented as separate PHP templates before this session, this just fills in the
one that didn't exist yet. `src/routes/payments.ts` wires all four endpoints; all four are public
(no admin token required for a real charge — only the `test_mode` regression-suite bypass is
admin-gated, inside `src/payments.ts` itself, matching the PHP's own `requireAdmin()` placement).

`npm test`: 418/418 passing (35 new, all in `payments.test.ts`). `tsc --noEmit`: clean.

**Live-verified on redeployed staging, but only the code-path/error-handling surface — no real
charge has been attempted.** Checked `wrangler secret list --env staging` first: **none of the
payment secrets exist yet** — only `ORDER_TOKEN_SECRET` and the two Supabase secrets are set.
`SQUARE_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIG_KEY`, `PAYPAL_CLIENT_ID`,
`PAYPAL_SECRET`, and `RESEND_API_KEY` are all still unset on staging (`RESEND_API_KEY` doesn't
block anything today since `EMAIL_MODE=sink` there). Despite that, every route was confirmed to
degrade exactly the way the PHP would with missing credentials, not crash:
- Created a real order (`TESTPAY-1`, guest checkout, a real in-stock product) directly against
  staging's live Supabase.
- `POST /api/process_payment.php` against it returned `{"error":"Payment not configured"}` —
  correctly failed at the credentials check, after successfully loading the order and recomputing
  its total from real line items.
- `POST /api/paypal_create.php` against it returned `{"error":"PayPal is not configured. Please
  choose another payment method."}` — same story.
- `POST /api/square-webhook.php` with no signature returned `"Webhook key not configured"` (500),
  matching the PHP's own `if (!defined('SQUARE_WEBHOOK_SIG_KEY'))` guard exactly.
- All four endpoints' missing-field validation (`Missing source_id or order_id`, `Missing
  order_id`) also confirmed correct.

**What's actually left before a real payment can be tested**: real Square Sandbox and PayPal
Sandbox credentials, which only the account owner can obtain (Square Developer Dashboard sandbox
access token + sandbox location id; PayPal Developer Dashboard sandbox REST app client
id/secret; a Square webhook subscription pointed at
`https://hdbs-staging.muddy-resonance-c828.workers.dev/api/square-webhook.php` for its signing
key) — then `wrangler secret put <NAME> --env staging` for each. Once set, a real sandbox card
charge and a real sandbox PayPal/Venmo capture are the next verification step, mirroring how the
original PHP-era PayPal go-live worked (see this file's much earlier PayPal integration history).


**Closes both remaining "no meaning without R2" deferrals called out in Phase 3's product-image
entry below**: `settings.ts`'s biz_profile logo/hero_image/about_picture uploads, and
`studio.ts`'s gallery-item and hero-image uploads. Every base64-image upload path in the app is
now R2-backed; nothing is left returning a placeholder "not yet available" error.

**Extracted a shared decoder first**: `decodeBase64Image()` in `src/lib/file-upload.ts` — the
base64-TEXT-length cap (not decoded-byte cap) plus JPEG/PNG magic-byte check that
`api/products.php`, `api/studio.php`'s `studioSaveImage()`, and `api/admin.php`'s three
biz_profile blocks all share. It only classifies the outcome (`no_match` / `too_large` /
`decode_failed` / `bad_type`); it doesn't decide pass-through vs. silent-empty vs. hard-fail,
because **the three PHP call sites don't actually agree with each other** on that:

- `studio.php`'s `studioSaveImage()`: malformed pattern *or* a base64 decode failure both silently
  return `''`; only too-large or a bad magic byte call `fail()`.
- `admin.php`'s biz_profile blocks: a malformed pattern leaves the field **untouched** (the PHP's
  `preg_match` is the guard for the whole `if` block); but once the pattern matches, a decode
  failure is **also** a hard `fail()` — unlike studio, which forgives it. Too-large and bad-magic-byte
  are hard fails in both.

This is a real, easy-to-miss divergence between two PHP files that look like they're doing the same
thing. Each port (`resolveStudioImage` in `studio.ts`, `processBizProfileImages` in `settings.ts`)
maps the shared classifier onto its own source's behavior rather than unifying them — verified with
dedicated tests per branch in both `studio.test.ts` and `settings.test.ts` (deliberately including a
same-shaped "decode failure" case in both files with opposite expected outcomes, so a future
refactor that accidentally unifies them would fail loudly).

**Filename scheme differences, both preserved exactly**: studio images use a deterministic filename
(`studio_<item id>.<ext>`, or the fixed `studio_hero.<ext>` for the page-copy hero) — matching
`studioSaveImage()`'s own `$filebase` argument — so a re-upload naturally overwrites the same R2
key and needs no old-file cleanup on save (only `deleteStudioItem` cleans up, and only because the
row itself is going away). biz_profile's three images use a **time-stamped** filename
(`logo_<unix-seconds>.<ext>`, etc.), matching `admin.php`'s `'logo_' . time() . '.' . $ext` — so
each upload gets a new key, and the OLD file has to be explicitly deleted (prefix-checked against
the pre-update biz_profile row, exactly like the PHP's `strpos($oldBiz['logo'], $logoUrl) === 0`
check, just against a root-relative `/business_logo/` prefix instead of a full domain — matching
what migration 0009 already normalized every existing biz_profile row to).

**Storage**: both go to `R2_PUBLIC` under the same prefixes `routes/media.ts` already proxied
(`studio_images/`, `business_logo/`, `business_hero/`, `business_about/` — media.ts's own header
already anticipated this, calling out that `business_hero`/`business_about` were "empty in
production... but routed anyway"). `SupabaseStudioStore` and `SupabaseSettingsStore` both gained an
`R2Bucket` constructor parameter; every construction site across `routes/admin.ts`,
`routes/business.ts`, `routes/studio.ts`, `routes/email.ts`, `routes/contact.ts`, and
`routes/orders.ts` was updated to pass `c.env.R2_PUBLIC` (mechanical, since `c.env` was already in
scope at every call site — most of those only ever call `.getSetting()` and never touch the new
image methods, but the interface now requires them for `SupabaseSettingsStore` to compile).

**One preserved orphaning quirk, not fixed**: if a studio item is re-saved with a different image
*extension* than before (PNG then later JPEG), the old extension's R2 object is never cleaned up —
same as the live PHP's disk behavior, since the filename is extension-dependent. Consistent with
how products.ts's own per-slot orphaning was documented rather than fixed.

`npm test`: 383/383 passing (16 new — `file-upload.ts` gained no new tests of its own since
`decodeBase64Image` is exercised indirectly through both `studio.test.ts` and `settings.test.ts`).
`tsc --noEmit`: clean.

**Live-verified with a real authenticated pass this time** — the user logged into staging
themselves (same admin-password gap as Phase 3's product-image entry) and uploaded a real Design
Studio gallery item image, a Page Copy hero image, and a Business Profile logo, all through the
actual admin UI. All three landed correctly: `GET /api/studio.php` shows a real gallery item with
`image: "/studio_images/studio_19.jpg?t=1785603307"` and a `studio_config.hero.image` of
`/studio_images/studio_hero.jpg?t=1785602676"`; the R2 object `business_logo/logo_1785602989.jpg`
is fetchable directly (200, correct `Content-Type: image/jpeg`).

**Caught and fixed a real, unrelated pre-existing bug along the way**: the storefront homepage kept
showing the default logo/hero/about even after a successful biz_profile save. Root cause was in
`src/index.ts`'s SPA catch-all, NOT in this session's new code — `const load = async () => null;`
had sat there since before `src/db.ts` existed, with a `// TODO(Phase 3): read the biz_profile row
via src/db.ts` comment that never got followed up once `src/db.ts` actually landed. Every phase
since then kept building real Supabase-backed features while the one thing that renders the
homepage's own branding was still silently hardcoded to "no data available." `getBizProfile()` in
`shell.ts` already had the injection seam built for exactly this (`load: () => Promise<string |
null>`, with its own isolate-scoped 60s cache and graceful fallback-to-defaults on failure) — it
was just never wired to a real loader. Fixed with a one-line change: `load` now constructs
`SupabaseSettingsStore` and calls `getSetting("biz_profile")` for real. Confirmed on redeploy: the
homepage HTML now contains `business_logo/logo_1785602989.jpg` instead of the default
`HDBSLogo.jpeg`.

**How this was diagnosed**: the first two "verified" reports from the user turned out to be
against the wrong screen (the Projects/inquiries tab, which has no images) and then a real save
that looked like it silently did nothing. `wrangler tail --env staging` proved the Worker was
receiving zero requests during one retry attempt (confirmed the tail itself was live by curling the
Worker directly mid-session and watching it appear instantly) — which turned out to be a red
herring from checking too early. The DevTools Network tab on the actual retry showed real 200s all
the way through, which is what pointed at "the write path works, something downstream doesn't
read it" rather than a save-path bug — leading straight to the `index.ts` stub. Lesson: when a
change is confirmed to have written real data but the page doesn't reflect it, check what actually
reads that data before re-auditing the write path a second time.

`npm test`: 383/383 passing (unchanged by the `index.ts` fix — no test file covers that entry
point). `tsc --noEmit`: clean.

## Incident — 2026-08-01: the third console error was a half-finished design, now completed

After the two fixes below, the user's console still showed one 501 on every page load, on
`/api/admin.php`. Traced it (not from `ui.js`'s `tryLoad()` — that only accounts for the two
401s, both confirmed benign) to a completely separate call site:
`public/index.html`'s leftover PHP-era inline script,
`fetch('/api/admin.php',{action:'get_version'})`, firing unconditionally on every single page load
to populate the four `.site-version-line` footers. `get_version` was never ported to
`routes/admin.ts` — hence the 501 on every visit, forever, until now.

**Root cause: `src/shell.ts`'s `ShellOptions.version` field was accepted but never used.** Its own
doc comment already said *"rendered into window.BIZ_VERSION for the footer version lines"* — that
was the intended design from Phase 2, correctly describing what should happen, but `buildTokens()`
never actually emitted a `BIZ_VERSION` token. Since `index.html:1046`'s fetch script was never a
`{{TOKEN}}` site (it's raw PHP-era JS, not a `<?php echo ?>` echo the shell generator ever touched),
nothing forced this half-finished state to be visible until a real browser loaded the real page.

**Fixed by finishing the design, not adding a new one**: `buildTokens()` now emits
`BIZ_VERSION_JSON`; `index.html`'s `window.BIZ_NAME=...` script line now also sets
`window.BIZ_VERSION={{BIZ_VERSION_JSON}}`; the dead fetch is replaced with a direct read of that
global. Version is a build-time constant from `version.json` — there was never a reason for a
live network round trip once the plan moved off the `major_version`/`minor_version` settings-row
scheme, which is exactly the point PROJECT_STATUS.md's "Open decisions" section made weeks ago.

**Also closed the open decision from Phase 0**: `version.json` was still the placeholder `0.1.0`.
Queried the real value live (`major_version`/`minor_version` are both in `api/admin.php`'s own
public-keys allowlist, so no admin token was needed): **4 / 27**. Set `version.json` to `4.27.0` so
the footer doesn't look like a regression the moment a real visitor sees it.

**Live-verified**: `window.BIZ_VERSION="4.27.0";` now present in the served HTML (confirmed with a
cache-busted request after a transient edge-cache blip on the very first post-deploy request — the
page correctly sends `Cache-Control: no-store`, so this was a one-off propagation timing artifact,
not a caching misconfiguration); the dead `get_version` fetch string no longer appears anywhere in
the response; `POST /api/admin.php {action:"get_version"}` still 501s as expected, since nothing
calls it anymore.

`npm test`: 367/367 passing (1 new). `tsc --noEmit`: clean.

---

## Incident — 2026-08-01: every ported route was missing `success:true`/`false`, now fixed

**A foundational bug in `src/lib/http.ts`'s `ok()`/`fail()`, present since Phase 0, affecting all
~74 response call sites across every route file.** `api/config.php`'s real helpers are:
```php
function ok($data = []) { echo json_encode(array_merge(['success'=>true], $data)); }
function fail($msg, $code = 400) { echo json_encode(['success'=>false,'error'=>$msg]); }
```
This port's `ok()`/`fail()` returned only the caller's data/error — **no `success` field at all**.
Every one of the ~9,900 lines of front-end JS checks `d.success` before trusting a response
(`store.js`, `admin-orders.js` ×30, `admin-misc.js` ×26, `ui.js` ×12, `auth.js` ×6, and more) — so
every ported route's response has been silently untrusted by the browser since it was written,
**even on a genuine 200**. This is why the storefront's product grid was stuck on loading
skeletons forever after the JS-load fix above: `ui.js`'s `apiFetch('products.php').then(d =>
if(d.success && d.products) ...)` never fired, because `d.success` was always `undefined`.

**Caught only because the user loaded the real site in a browser** and reported the visual symptom
(skeleton placeholders, never resolving) — no unit test could have caught this, because nothing in
this codebase asserted the HTTP-level envelope shape. Every prior phase's "live-verified" claims in
this file checked backend correctness by reading curl'd JSON bodies directly (was the tax amount
right? did the row get inserted?) — genuinely true and still valid — but none of them re-exercised
this specific front-end contract by loading the actual page, so this had been silently broken
since the very first route was wired.

**Fixed**: `ok(c, body)` now returns `{ success: true, ...body }`; `fail(c, message, status)` now
returns `{ success: false, error: message }` — byte-compatible with the PHP again. Added dedicated
tests in `http.test.ts` (mounting a throwaway Hono app, the same pattern `cors.test.ts` already
established) asserting the envelope shape explicitly, since nothing had before. `npm run
typecheck` confirmed zero call sites broke across all 74 usages — none needed updating.

**Live-verified on redeployed staging**: `GET /api/products.php` now returns
`{"success":true,"products":[...]}`; an unauthorized `POST /api/products.php` now returns
`{"success":false,"error":"Unauthorized"}` at 401. Also used this incident to audit the two
*other* console errors the user's screenshots showed (`payment_configuration` and `paypal_fees`
both 401ing on page load): both are **genuinely absent from `api/admin.php`'s own public-settings
allowlist**, so they 401 on the real production PHP site too, silently swallowed by a `.catch()` —
not a regression. A third error (a 501) was not reproduced by replaying every unconditional
page-load call in `js/ui.js`'s `tryLoad()`; it likely came from a specific interaction between the
user's two screenshots rather than the bare page load, and needs a fresh console capture to pin
down now that this fix is live.

`npm test`: 366/366 passing (6 new, all in `http.test.ts`). `tsc --noEmit`: clean.

**Lesson for future sessions, sharper than the deploy-hook one above**: a curl-based "live
verification" that reads specific fields out of a JSON body can miss an entire envelope-shape
contract if it never diffs against what the real PHP actually emitted. Compare a ported
endpoint's *raw* response text against the equivalent live PHP response at least once per route
family, not just the fields the test happens to check.

---

## Incident — 2026-08-01: a deploy I ran broke staging's JS, now fixed and hardened

**Caused by this session, not a pre-existing bug.** While live-verifying the products write path
above, I ran `npx wrangler deploy --env staging` directly instead of `npm run deploy:staging`. The
latter's `predeploy:staging` npm hook runs `scripts/sync-assets.mjs`, which regenerates
`public/js/`/`public/css/`/`public/.well-known/` from the repo-root copies; a bare `wrangler
deploy` has no reason to know that step exists. At the moment I ran it, `public/js/` did not exist
in this session's working directory at all (`public/css/` did, unexplained asymmetry — never
root-caused, and it no longer matters given the fix below). Wrangler deploys are declarative, so
that deploy overwrote whatever JS was live before with **none** — every `<script src="/js/...">`
on the site 404'd into the SPA shell's HTML, and browsers correctly refused to execute it (`strict
MIME type checking`), which cascaded into `TableKit is not defined`, `openMenu is not defined`,
and a non-functional hamburger menu/admin nav. **The user hit this live** while attempting the
manual product-upload verification I'd asked them to do, and sent a screenshot of the console
errors — that's how it was caught, not by anything automated.

**Fixed**: ran `npm run sync:assets` (17/17 JS files restored, confirmed identical to repo root),
redeployed to staging, and curled 4 of the previously-broken files directly — all now return
`Content-Type: text/javascript` with real JS content, not HTML.

**Hardened so this can't recur, at the tool level rather than by convention**: added a `build`
block to `wrangler.jsonc` —
```jsonc
"build": { "command": "node scripts/sync-assets.mjs" }
```
Wrangler runs this automatically before **every** `wrangler dev`/`wrangler deploy`, regardless of
whether it's invoked via an npm script or bare `npx wrangler`. **Proved it, not just configured
it**: deleted `public/js/` again on purpose, ran a bare `wrangler deploy --dry-run`, and confirmed
the `[custom build]`-prefixed log showed `sync-assets` running automatically and `public/js/`
existing again on disk afterward with all 17 files matching root, before I did a real (non-dry-run)
redeploy. "Remember to use the right npm command" is no longer a requirement for a correct deploy.

`npm test`: 360/360 (no test regressions — this was a deploy-process gap, not a code bug).
`tsc --noEmit`: clean.

**Lesson for future sessions**: this project's own established pattern — "a dry-run build proves
the config resolves, not that the runtime behaves as assumed" (Phase 2's `run_worker_first` and
immutable-headers bugs, both above) — applies to the asset pipeline too, not just runtime code.
Always verify a real deployed page loads its own JS/CSS (a curl content-type check is enough), not
just that `wrangler deploy` exits 0.

---

## Current state — 2026-08-01 (Phase 3: product image upload — the write path)

**`src/products.ts` extended with `saveProduct`/`deleteProduct` (POST/DELETE), completing
`api/products.php`'s full port** — the last of the three deferred "no meaning without R2"
image-upload paths (`settings.ts`'s biz_profile logo/hero/about and `studio.ts`'s gallery images
are still deferred; this closes the highest-value one, since the admin catalog was otherwise
entirely read-only).

**Extracted the shared upload helpers first**: `decodeDataUrl`/`detectFileType`/`mimeForFileType`/
`sanitizeFilename`/`sanitizeDispositionName` moved out of `business.ts` into
`src/lib/file-upload.ts` (with their tests moving to `src/lib/file-upload.test.ts`), since
`products.ts` needed the same magic-byte type detection `business.ts` already had. `business.ts`
re-exports them so nothing importing from there broke.

**Deliberately did NOT reuse `decodeDataUrl` for the actual image-slot decode**, only
`detectFileType` for the magic-byte check — `api/products.php`'s per-slot validation has
genuinely different semantics from the single-file business-doc/receipt uploads that module was
built for: the size cap is on the **base64 text length** (`strlen($m[2]) > 4MB*4/3`), not decoded
bytes; a slot that merely *contains* `"data:image"` without matching the full pattern, or fails to
base64-decode, is **silently emptied** rather than failing the request; but a **bad magic byte**
aborts the *entire* save with a 400 — a genuinely different failure mode from the other two. All
three behaviors ported and tested explicitly, including the asymmetry between them.

**One faithfully-preserved PHP quirk, documented rather than fixed**: validation and the R2 write
happen per-slot in order, exactly like the PHP's per-slot `file_put_contents()` inside its loop —
so if slot 3 fails magic-byte validation after slots 1-2 already wrote successfully, those two R2
objects are **not** rolled back even though the product row itself is never saved. Same orphaning
the live PHP has always produced on Hostinger. Contrast with `send_confirm.php`'s missing
`requireAdmin()` in `email.ts` (Phase 4, below), which *was* a deliberate security fix — this one
has no such consequence, so it's preserved and called out, not corrected.

**Also preserved two easy-to-miss PHP semantics**, both covered by dedicated tests: `cogm` defaults
to half the price only when the key is *absent* (`isset()`), so an explicit `cogm: 0` is honored,
not defaulted; and `coming_soon` follows PHP's `empty()` truthiness (`0`, `"0"`, absent → false;
anything else → true), not a plain JS truthy check.

**URLs**: `api/products.php:65` hardcoded the production domain into the stored URL. New uploads
here store a root-relative path (`/product_images/<filename>`) instead, matching what migration
`0009` already normalized every existing row to.

`src/db.ts`'s `SupabaseProductsStore` gained `upsertProduct`/`deleteProduct`/`putProductImage` and
now takes `R2_PUBLIC` in its constructor (same dual-binding pattern as
`SupabaseCapitalEquipmentStore`, against the public bucket since product images are
customer-facing). `src/routes/products.ts` wires `POST`/`DELETE /api/products.php` behind
`isValidAdminToken`, replacing the two 501 stubs.

**Live-verified against staging, but only the unauthenticated path** — deployed and curled the real
Worker: `GET /api/products.php` still returns real catalog data (no regression), and `POST`/`DELETE`
both correctly 401 with no token and with a bogus token (confirming the admin gate makes a real
`admin_sessions` round-trip against live Supabase, not just a unit-tested code path). **Did NOT
live-verify an actual authenticated save/delete** — the real admin password now live on staging is
Suzi's actual production password (migrated in during Phase 1), deliberately never written down
anywhere in this session, so there is no way to self-serve a valid token the way earlier phases'
throwaway-password bootstrap did. This is a real gap, not a formality: the Supabase `upsert()`
call and the R2 `put()` call are exercised by the in-memory fake's 19 new tests, but not yet by a
real database and a real bucket. **Worth a manual pass in the admin UI** (create a product with a
real image, confirm it renders and the R2 object exists, then delete it) before this is trusted at
the same level as the rest of Phase 3.

`npm test`: 360/360 passing (19 new). `tsc --noEmit`: clean.

---

## Current state — 2026-08-01 (Phase 4: email.ts)

**`src/lib/email-format.ts`, real Resend wiring in `src/lib/email-sender.ts`, and
`src/email.ts` written and wired.** This is Phase 4 proper — the plan's `email.ts`.

**Scoped after reading all 5 order-email files** (745 lines): they turned out to be **3 different,
overlapping order-confirmation templates** plus a 4th client-triggered variant, not 9 distinct
senders. Confirmed with the user before proceeding:
- `mailer.php`'s `_emailLogoHeader()`/`_noCrlf()` → ported as `spliceLogoHeader`/`stripCrlf`
  (pure, tested against all 3 real header-color branches this codebase's templates use, plus both
  fallback paths).
- `api/order_confirm_email.php`'s `sendOrderConfirmation()` — used only by the not-yet-built
  Square/PayPal payment processors — deferred alongside payments, nothing calls it yet.
- `notify.php` (internal "new order" alert to Suzi) — deferred, redundant with the confirmation.
- `order_confirm.php` (a 4th, client-triggered, token-gated variant) — deferred, likely superseded.
- **`send_confirm.php`** — ported. Turns out this is the template `api/orders.php`'s `createOrder()`
  *actually* fires for in-person-paid orders (curled internally in the PHP), not
  `order_confirm_email.php`'s simpler one — discovered by reading orders.ts's own header comment
  from earlier this session, which already documented that curl call.

**A real gap found and fixed while building this**: `mailer.php`'s `sendEmail()` applies the logo
splice to literally every outbound email, unconditionally, via a by-reference `$html` mutation so
anything logged afterward reflects the spliced version. `contact.ts`/`studio.ts` (built earlier
this session, before this file existed) were missing it — their sink-logged emails on staging
didn't have the logo. Fixed by moving the splice into `EmailSender.send()` itself (both
`SinkEmailSender`/`LiveEmailSender`), which now returns the final spliced `html` for the caller to
log — the TS equivalent of PHP's by-reference mutation. Updated `contact.ts`/`studio.ts` to log
`result.html`, not the pre-splice template. **Live-verified the fix**: resubmitted a real contact
form, confirmed the newly-logged `email_log` row now contains the logo image, where the
earlier-session entries do not.

**Real Resend wiring landed in `LiveEmailSender`** (sending domain `mail.handmadedesignsbysuzi.com`
per the plan, Reply-To Suzi's real mailbox) — genuine, complete code, but **untestable until
`RESEND_API_KEY` + a verified sending domain exist** (neither does yet). `sink` mode is what every
live-verification in this project has used, and remains fully exercised.

**One deliberate security fix, not a literal port**: the live `send_confirm.php` has **no
`requireAdmin()` call at all**, despite its own comment calling it admin-only — anyone who found
the URL could resend, or via preview mode read, any order's confirmation email. Gated behind
`isValidAdminToken` in the port. The *internal* call from `orders.ts`'s in-person-paid order
creation calls `sendOrderConfirmationEmail()` directly in-process rather than over HTTP to this
now-gated route — cleaner than the PHP's self-`curl()`, and sidesteps the question of how an
unauthenticated internal caller would satisfy the new admin gate.

`src/db.ts` gained `SupabaseEmailOrderStore` (joins `order_items` with `products` in JS for
image/SKU, since `product_id` is deliberately not a real FK — same reasoning as `orders.ts`'s own
join-in-JS pattern). New route: `POST /send_confirm.php` (admin-gated, supports `preview`).
`routes/orders.ts`'s `onInPersonPaid` hook now actually fires the confirmation email instead of
being a no-op TODO.

**Live-verified against staging, full round trip with real data**: `send_confirm.php` correctly
401s without a token; preview mode against a real order (`ORD-MR57UJ0A`) returns the correct
recipient/subject/logo-spliced HTML with the real line item; a real resend updates
`confirm_sent_at` and logs an `email_log` row with the logo present; creating a real in-person-paid
order auto-fires the confirmation end-to-end (verified the email_log entry, then confirmed that
`isInPersonPaid` correctly *skips forcing* `Awaiting Payment` without itself forcing `Paid` — that
part is the caller's responsibility, matching the PHP exactly). Test orders cleaned up afterward.

`npm test`: 341/341 passing (26 new: 12 email-format + 14 email). `tsc --noEmit`: clean.

**Remaining**: payments (Square/PayPal/webhooks/Apple Pay — deliberately last, "give it room" per
the plan), and the deferred pieces above (`order_confirm_email.php`'s payment-triggered template,
`notify.php`, `order_confirm.php`) which only make sense once payments exist to trigger them.

---

## Current state — 2026-08-01 (Phase 3 continued: business.ts + ops.ts)

**`src/business.ts` (capital_equipment + business_docs) and `src/ops.ts` (email_log) written and
wired.** Scoped down from the plan's full `ops.ts` after checking what's actually there —
confirmed with the user before proceeding:
- **`deploy_log.php`** writes to a local file and auto-bumps `minor_version` for the old
  FTP-deploy pipeline (`deploy.ps1`/`watch.ps1`). That pipeline doesn't exist in the Cloudflare
  architecture — deploys are `wrangler deploy`, versioning is `version.json` + git history — so
  this endpoint has nothing left to serve. Not a gap, just obsolete.
- **`github_log.php`** is a live external API integration (GitHub commits) with its own
  filesystem cache. Deferred, same reasoning as USPS tracking — lower priority than core
  storefront/admin functionality, not because it's hard.

**`business.ts` is fully implemented, not deferred like earlier image uploads** — both
`capital_equipment.php` (equipment ledger + PDF/JPG/PNG receipt upload) and `business_docs.php`
(resale certificate / business license) now actually write to **R2_PRIVATE**, unlike products.ts/
studio.ts's placeholder "not yet available" responses. This was possible because R2_PRIVATE
already exists (auto-provisioned alongside R2_PUBLIC) and needs no external credentials — the
earlier deferrals were about not having R2 wired up yet, which is no longer true. Shared,
pure/testable helpers (`decodeDataUrl`, `detectFileType` — magic-byte validation, not
client-reported mime type — `sanitizeFilename`, `sanitizeDispositionName`) do the same
validation every upload path in this codebase needs.

One correction to the migration plan's own notes: `docs/schema-reconciliation.md` says
`business_docs.php` has "no database metadata at all" — actually reading the PHP shows its
metadata lives in a `biz_documents` JSON blob in the `settings` table (confirmed against the real
migrated data, which has exactly this key). Reused `settings.ts`'s `SettingsStore` rather than
inventing a new interface for it.

**`ops.ts`** ports `email_log.php`'s list (with `order_id`/`type` filters, capped at 500 rows)/
log/clear — straightforward CRUD.

`src/db.ts` gained `SupabaseCapitalEquipmentStore` (the only store in the file backed by two
different bindings — Supabase for the table, `R2Bucket` for receipt files), `R2BusinessDocsFileStore`,
and `SupabaseEmailLogStore`.

**Live-verified against staging, real data and a real R2 round-trip**: all 13 real capital-
equipment rows (confirmed `has_receipt` reflects real migrated metadata, though the actual
receipt files themselves were never pulled off Hostinger per Phase 0's known gap); the real
`biz_documents` blob (resale certificate + business license) via `business_docs.php`'s list
action; all 9 real `email_log` rows (7 migrated + 2 from this session's own contact/studio
testing). Uploaded a real test PDF receipt to R2_PRIVATE, downloaded it back, and confirmed the
bytes match exactly byte-for-byte — genuine end-to-end proof the private-bucket file path works,
not just the metadata layer. Deliberately did NOT test-upload against `business_docs.php` (would
have overwritten Suzi's real license/certificate files on staging) — that path is covered by unit
tests instead. Test capital-equipment item and its receipt cleaned up afterward.

`npm test`: 315/315 passing (39 new: 32 business + 7 ops). `tsc --noEmit`: clean.

**Everything in the plan's endpoint-port table is now done except `email.ts` (Resend/logo-splice/
sending-domain — Phase 4 proper) and payments (deliberately last).**

---

## Current state — 2026-08-01 (Phase 3 continued: content, contact, studio)

**`src/content.ts` (reviews + faqs), `src/contact.ts`, and `src/studio.ts` written and wired.**

**New shared piece: `src/lib/email-sender.ts`** — a minimal `EMAIL_MODE` dispatcher (`sink`/`live`),
extracted because both `contact.ts` and `studio.ts`'s inquiry form need to send an email and
neither should duplicate the decision. Full Resend integration (logo splice, templates, DKIM
domain) is still Phase 4's `email.ts` — NOT built here. What IS built: the `sink` path the plan
already specifies ("render the full HTML, write email_log with status='sink', return success
WITHOUT calling Resend") — genuinely usable today since staging already runs `EMAIL_MODE=sink`
with no `RESEND_API_KEY`. The `live` path is a clearly-marked stub that correctly reports failure
rather than pretending to send.

**`content.ts`** ports `api/reviews.php` (public approved-only list / admin all-list, rate-limited
public submission, admin approve/delete) and `api/faqs.php` (list, add, update, reorder, delete) —
straightforward CRUD, no email dependency.

**`contact.ts`** ports `api/contact.php`'s validation, rate limit, and HTML email template
(`buildContactEmailHtml`, a pure/testable function) — the actual send goes through the
`EmailSender` abstraction above.

**`studio.ts`** is the big one — ports `api/studio.php`'s full surface: idempotent starter-content
seeding (`ensureStudioSeeded`, checked by count exactly like the PHP), public
items+page-copy-config GET, admin inquiry pipeline (list with grouped notes,
status/due-date/notes CRUD, project delete), and the public commission-inquiry form (rate-limited,
computes a default due date from timeline phrases like "two weeks", emails a notification, and —
matching the PHP exactly — **always returns success once the inquiry is stored**, even if the
email send fails, so a flaky mail relay never blocks a visitor's submission). Noted and skipped:
`api/studio_seed.php` is a stale, unused duplicate of the seed logic already inlined in
`studio.php` itself (which never `require`s the separate file) — ported from the inline version,
the one actually running.

**Deliberately deferred, consistent with `products.ts`/`settings.ts`**: `studioSaveImage`'s actual
file write. A `data:` URL image value now returns a clear "not yet available — pending R2 wiring"
error; an already-URL value (editing text without touching the image) passes through unchanged.

`src/db.ts` gained `SupabaseReviewsStore`, `SupabaseFaqsStore`, `SupabaseContactStore`,
`SupabaseStudioStore`, plus shared `rate_limits`/`email_log` helpers reused across all three
(the same `rate_limits` table already backs subscribers/tax-adjacent throttles — reviews/contact/
studio-inquiry each get their own key prefix on the same table, matching how `orders.ts` and
`customers.ts` already share `customer_login_attempts` this way).

**Live-verified against staging, every module, real writes**: submitted a real review (pending),
approved and deleted it; submitted a real contact form (succeeded via the sink path, no real
email sent); submitted a real studio inquiry — confirmed the due-date computation ("two weeks" →
exactly 14 days out), added an admin note (correct `America/New_York` timestamp format), changed
status, then deleted the whole project and confirmed its note cascaded with it; confirmed
`GET /api/studio.php` auto-seeds exactly 7 services + 10 FAQs on a fresh call. One repeat of the
same transient edge blip seen earlier this session (a request occasionally returns the SPA shell
instead of hitting the Worker) — resolved on immediate retry every time, not a code issue.

`npm test`: 276/276 passing (55 new: 16 content + 8 contact + 31 studio). `tsc --noEmit`: clean.

**Not yet done**: `email.ts` itself (Resend, logo splice, real sending domain), payments
(deliberately last). Remaining back-office long tail: `business.ts` (capital_equipment,
business_docs — the latter has no DB table at all, filesystem-only in the PHP) and `ops.ts`
(applog/email_log viewer/deploy_log/github_log/health/smoke).

---

## Current state — 2026-08-01 (Phase 3 continued: customer accounts)

**`src/customers.ts` written and wired**, completing `api/customers.php`'s full port:
register/login/get_sec_question/reset_password/change_password/inc_orders, admin
add_customer/update_customer/delete_customer/list, and cancel_order (public, cancel-token
authenticated).

**`customers` has ZERO real rows in production** (finding 1) — no legacy data to preserve
byte-compatibility with, so new registrations use `hashPassword()` (PBKDF2) directly rather than
needing a bcrypt-compat write path, same as how the admin flow generates new PBKDF2 hashes.
Reused `password.ts`'s `hashPassword`/`verifyPassword` wholesale — same bcrypt-tolerant,
transparent-rehash-on-login functions `auth.ts` already established for the admin account.

**Added `src/lib/order-token.ts`** — the shared signed-token module (`makeOrderToken`/
`verifyOrderToken`, `ports api/order_token.php`) used for the account order-view token, and later
by guest order lookup. Same `ORDER_TOKEN_SECRET` fix as the cancel token: full 64-char
HMAC-SHA256 output, not the original's 32-char truncation — the migration plan's general guidance
on this HMAC pattern, applied consistently everywhere it appears.

**One deliberate parity addition, not in the original PHP**: `resetCustomerPassword`'s
security-answer check now self-heals a legacy plaintext answer to a hash on successful
verification, matching `auth.ts`'s admin equivalent (which already does this and documents why).
Free to add since there are zero real customer accounts for it to affect — closes the same
"verified-correct answer left in plaintext forever" gap.

**`cancelOrder` reuses `orders.ts`'s `makeCancelToken`** directly — the same function that issues
the token at order creation also verifies it here, so issuer and verifier can never drift out of
sync. Extended `OrdersStore` with two small methods (`getOrderStatus`, `orderBelongsToEmail`)
rather than duplicating order-table access in a second adapter.

**One accepted non-atomicity**: `incrementOrderCount` is read-then-write, not atomic like the
stock decrement's RPC — deliberately not worth another Postgres function for a low-stakes display
counter (unlike stock, an off-by-one here has no financial/inventory consequence).

`src/db.ts` gained `SupabaseCustomersStore`. New route: `GET (?action=list)/POST
/api/customers.php`, action-dispatched exactly like `admin.php` (matches every JS call site:
`js/auth.js`, `js/admin-orders.js`, `js/admin-misc.js`, `js/store.js`).

**Live-verified against staging, every action, real writes**: registered a real customer,
logged in, fetched the security question, reset the password via the security answer and
confirmed login with the new password, admin-listed/added/updated/deleted customers (confirmed
`update_customer`'s always-overwrite-all-four-fields behavior — a real PHP quirk, faithfully
preserved, not "fixed" into a partial update), and both the negative (wrong token → 403) and
positive (correct token → cancels, restores implied via the shared code path, blocks a
double-cancel) `cancel_order` cases against a real order.

`npm test`: 221/221 passing (47 new: 8 order-token + 39 customers). `tsc --noEmit`: clean.

**Not yet done**: `email.ts` (still just the documented no-op TODO in `createOrder`), payments
(deliberately last). That's now every module in the plan's endpoint-port table except payments,
email, and the back-office long tail (`content.ts`/`contact.ts`/`studio.ts`/`business.ts`/
`ops.ts`).

---

## Current state — 2026-08-01 (Phase 3 continued: order mutations)

**`src/orders.ts` extended with POST (create)/PUT (update)/DELETE (single + all)**, completing
`api/orders.php`'s full port (GET was done earlier this session). Three things needed solving
that the read-only pass didn't:

1. **No real multi-table transaction.** The PHP wraps order + item inserts + stock decrements in
   one MySQL transaction, rolled back on any failure. PostgREST has no client-side equivalent —
   each REST call commits independently. Rather than move this business logic into a stored
   procedure (which would duplicate the trust-boundary/pricing logic in two languages, breaking
   the pattern this whole migration follows), `createOrder` does an explicit **compensating
   rollback** on partial failure: delete the order (cascades to any items already inserted) and
   restore stock for any items already decremented. Same end state as a real rollback, achieved at
   the application level instead of the database level. **Live-verified for real**: ordering an
   already-out-of-stock item correctly failed with the exact error and left zero trace of the
   order — the rollback actually works against the real database, not just the fake.

2. **Atomic stock arithmetic needs a Postgres function.** PostgREST can't express
   `stock = stock - $1 WHERE stock >= $1` as a plain column update (no computed expressions, no
   branching on the result in one round trip). Added
   `supabase/migrations/0010_stock_adjustment_functions.sql`
   (`decrement_stock_if_available`/`increment_stock`, called via `.rpc()`) — deliberately narrow:
   only the arithmetic PostgREST can't do moved into SQL, none of the business logic.

3. **Cancel-token HMAC replaced.** `ORDER_TOKEN_SECRET` (32 random bytes) generated and set on
   staging, replacing the `DB_PASS`-keyed HMAC at `api/orders.php:222`. Also fixed, not just
   ported: the original truncates to 24 hex chars; this port uses the full 64-char HMAC-SHA256
   output and domain-separates it (`"cancel:" + orderId`), per the migration plan's general
   guidance on this HMAC pattern — free to fix since the secret change already invalidates every
   existing cancel token regardless of length.

**One deliberate correction, not a literal port**: the PHP's stale-order reclaim compares
`order_date < cutoff`, but `order_date` is a DATE column (no time-of-day) compared against a full
timestamp — MySQL treats the date as its midnight instant, so that condition is true for
essentially every order placed earlier the same day, not just ones genuinely 2+ hours old. Read
as an accidental near-tautology rather than the intended 2-hour freshness window, so this port
compares against `created_at` (a real timestamp) instead — documented in `orders.ts` with the
reasoning, not silently changed.

**Live-verified against staging, full write path**: created a real test order (admin-trusted, one
real product decremented 1→0 stock), confirmed a second order for the now-out-of-stock item
correctly fails with `"Item is out of stock: <name>"` and leaves no phantom order row, updated the
order via PUT (status + tracking number both took), then deleted it via DELETE and confirmed it's
gone. Test residue: that one product's stock is still `0` (deleting an order doesn't restock,
faithfully matching the PHP) — `node scripts/migrate-data.mjs --write` would reset it along with
everything else if pristine staging data is wanted again.

`npm test`: 174/174 passing (36 new). `tsc --noEmit`: clean.

**Not yet done**: `customers.ts` (zero real rows in prod, low urgency), `email.ts` (the
in-person-paid confirmation-email hook in `createOrder` is a documented no-op TODO until then),
payments (deliberately last).

---

## Current state — 2026-08-01 (Phase 3 continued: tax, tax sweep, subscribers)

**`src/tax.ts` and `src/subscribers.ts` written and wired.** Scoped down from the plan's full
`tax.ts`/`shipping.ts` modules after checking what's actually there:
- **`api/fetch_tax.php`** (Square API tax reconciliation) and **`api/tn_tax.php`** (confirmed
  dead — queries a dropped table, finding 2) deliberately NOT ported — genuinely payment-adjacent
  or dead code.
- **`shipping.ts` has no backend business logic to port at all.** `usps.php`/
  `validate_tracking.php` are a live USPS OAuth2 integration needing real credentials we don't
  have (deferred alongside payments); the shipping-rate calculation (`shipping_config`'s zone
  rates/weight tiers) turns out to be pure client-side JS in `js/store.js` — the backend only
  ever stored it as an opaque blob, which `settings.ts` already handles generically. No module
  written; nothing was skipped by omission, there was nothing there.

**`src/tax.ts`** ports `api/tn_city_tax.php` (public GET/search, admin POST upsert/DELETE) and
`api/tax_sweep.php` (pending-orders summary, sweep history, create/edit/delete a sweep record).
One correctness note worth flagging: the upsert conflict target is the **`(city, county)` pair**
(matching MySQL's `UNIQUE KEY city_county`), not `city` alone — caught and fixed a bug in the
first draft of the in-memory fake before it reached the real adapter, where it matched on `city`
only. Also: `tax_sweeps.order_ids` is stored as **JSON** (`json_encode()` in the live PHP), not
comma-separated despite what the migration's own column comment says — the wire format from the
live PHP is the source of truth, not the comment, and this is called out explicitly in the code
and tested.

**`src/subscribers.ts`** ports `api/subscribers.php`'s GET (admin list)/POST (public subscribe,
with the same 5-attempts/15-minute rate-limit shape `auth.ts` already established for
login)/DELETE (admin unsubscribe). The rate-limit key is hashed with SHA-256 in
`src/routes/subscribers.ts` rather than MD5 (WebCrypto has no MD5) — fine since it's purely an
internal bucket key, never compared against a PHP-generated value.

`src/db.ts` gained `SupabaseTaxStore` and `SupabaseSubscribersStore`. New routes:
`GET/POST/DELETE /api/tn_city_tax.php`, `GET/POST/PUT/DELETE /api/tax_sweep.php`,
`GET/POST/DELETE /api/subscribers.php`.

**Live-verified against staging with real data**, read AND write paths:
- `GET /api/tn_city_tax.php` — all 52 real cities, correctly sorted; `?search=nash` correctly
  returns only Nashville.
- `GET /api/subscribers.php` (admin) — both real subscribers, dates formatted `MM/DD/YYYY`
  matching the PHP exactly.
- `GET /api/tax_sweep.php` (admin) — correctly identified the 2 real unswept orders
  (`ORD-MR57UJ0A`/`ORD-MR581NLT`), summed tax ($9.76), correct date range.
- **`POST /api/tax_sweep.php`** — created a real sweep record against live staging data; verified
  pending then correctly shows none, and history shows the sweep with the right JSON-encoded
  `order_ids`, matching the live PHP's actual wire format.

`npm test`: 149/149 passing. `tsc --noEmit`: clean.

---

## Current state — 2026-08-01 (Phase 3 continued: orders read endpoint)

**`src/orders.ts` written and wired** — ports `api/orders.php`'s `GET` action (admin-only order
list with grouped line items). Same store-interface + fake pattern as auth/settings/products.
POST (create)/PUT (update)/DELETE deliberately deferred — order creation carries a stock-decrement
transaction, a per-IP rate limit, and a cancel-token HMAC that needs `ORDER_TOKEN_SECRET`
(replacing the `DB_PASS`-keyed HMAC per the plan's Auth section), genuinely payment-adjacent logic
that deserves its own pass rather than riding on a read endpoint.

Ported faithfully, including two easy-to-get-subtly-wrong formatting rules: `order_date` ->
`n/j/Y` with no leading zeros, and `created_at` (stored UTC) -> `America/New_York` 12-hour time
(`g:i A`). The time conversion is unit-tested against the SAME real data point
`scripts/migrate-data.mjs` empirically validated earlier (`ORD-MR57UJ0A`'s `created_at` ->
`"1:37 PM"`), so the test isn't just internally consistent, it's checked against a real recorded
event.

`src/db.ts` gained `SupabaseOrdersStore`; `src/routes/orders.ts` wires `GET /api/orders.php`
behind `isValidAdminToken` (401 without a valid token, matching `requireAdmin()`).

**Live-verified against staging with real admin credentials** (Suzi's actual production
password, migrated in along with the rest of `settings` — the test password bootstrapped earlier
this session no longer works, as expected, since the data migration overwrote it): both real
orders returned with exactly correct shape — `ORD-MR57UJ0A`'s `time` field is `"1:37 PM"`, exactly
matching the empirical calculation; shipping/subtotal split correct ($50 item + $12 shipping +
$4.88 tax = $66.88 total); the $12 shipping refund shows up in `refunded_amount`.

`npm test`: 121/121 passing. `tsc --noEmit`: clean.

**Not yet done:** order creation/update/delete, `customers.ts`, `subscribers.ts` (public
newsletter signup only — `customers` itself has zero rows in production, finding 1), `tax.ts`,
`shipping.ts`, `email.ts`, payments. `ORDER_TOKEN_SECRET` has not been generated or set as a
Worker secret yet.

---

## Current state — 2026-08-01

**Both Supabase projects now exist**, under the "Business Web Express" org, same as the sibling
project (a deliberate deviation from that plan note — HDBS still gets two separate projects, just
hosted in the same org):

- **Prod**: "Handmade Designs By Suzi - Production", `https://ckiyvsejstptrnwkinir.supabase.co`,
  us-east-1. Migrations `0001`-`0008` run (0009 deliberately held back — it's the image-URL
  normalizer and must run after data load, not against an empty schema).
- **Staging**: `https://ukzhnizosofbkwcpuvye.supabase.co`, migrations `0001`-`0008` also run.

Both projects use Supabase's newer `sb_publishable_...`/`sb_secret_...` key format rather than the
legacy JWT `anon`/`service_role` pair (both still available under Settings → API Keys → "Legacy"
tab). Using the `sb_secret_...` key as `SUPABASE_SERVICE_ROLE_KEY` — same bypass-RLS privilege,
non-deprecated path forward.

**Not yet done:** `wrangler secret put SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (plain, then
`--env staging`) — four commands, to be run by the user directly since the key must never pass
through chat or get logged. R2 buckets and the Resend domain still do not exist.

**`src/db.ts` written** — the Supabase service-role client factory plus adapter classes
(`SupabaseAdminAuthStore`, `SupabaseSettingsStore`, `SupabaseProductsStore`) wiring `auth.ts`,
`settings.ts`, and `products.ts`'s store interfaces to the real `settings`/`admin_sessions`/
`products` tables. Deliberately not unit-tested (no live project in CI, and mocking supabase-js's
query builder buys little over the real thing) — the business logic it wires up is already
covered against fakes, which is what makes this adapter layer thin enough to trust by inspection.
Real verification is `wrangler dev` + `curl` per the Phase 2 lesson in this file.

**`src/routes/admin.ts` and `src/routes/products.ts` written and mounted in `src/index.ts`** —
first real `/api/*` routes. `POST /api/admin.php` stays one action-dispatch path (not
REST-per-action) because the front end calls it that way unchanged
(`js/auth.js:159`); only the actions ported so far (login/logout/change_password/
get_sec_question/verify_sec_answer/reset_password/save_sec_question/get_setting/set_setting)
are wired, everything else 501s so it's visibly unimplemented rather than a bare 404.
`GET /api/products.php` is wired read-only; `POST`/`DELETE` still 501 pending R2 image handling.
`src/lib/cors.ts` is now actually mounted on `/api/*` in `index.ts` (it existed but was unmounted
before this session).

Both `wrangler deploy --dry-run` (prod) and `--dry-run --env staging` build clean with correct
bindings. `npm test` 109/109, `tsc --noEmit` clean.

**Live-verified against the real staging Supabase project.** All four secrets set
(`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, prod + `--env staging`). R2 had to be enabled on the
Cloudflare account first (billing screen, $0 due — free tier covers HDBS's tiny footprint easily);
`wrangler deploy --env staging` then auto-provisioned `hdbs-public-staging`/`hdbs-private-staging`
and deployed to `https://hdbs-staging.muddy-resonance-c828.workers.dev`. Curled for real:
- `GET /api/products.php` → real Supabase query, `{"products":[]}` (empty — schema-only, no data
  loaded yet).
- CORS: OPTIONS preflight returns 200 with the right headers; GET responses carry
  `Access-Control-Allow-Origin`.
- `POST /api/admin.php`: unknown action → 501 (not a bare 404); `get_setting` on `debug_mode`
  (one of the PHP's original public keys) auto-defaults to `"0"` and persists it — first real
  write to the live `settings` table; `login` correctly reports "Admin password not configured"
  since the fresh database has no `admin_password` row yet.

**Found and fixed a real platform-limit bug via this live testing** — the kind unit tests
structurally cannot catch. Bootstrapped a real `admin_password` (bcrypt, via Postgres's
`pgcrypto`/`crypt()`, avoiding any hand-copied hash string) and attempted a real login: 500,
`NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported (requested
210000)`. The Workers runtime's WebCrypto caps PBKDF2 at 100,000 iterations; `src/lib/
password.ts` was using OWASP's 210,000 recommendation. Vitest runs under plain Node, which has no
such cap, so this could ONLY have been caught by a real `wrangler deploy` + login attempt — never
by the unit suite, however thorough. Fixed: `PBKDF2_ITERATIONS` dropped to 100,000 (the platform
ceiling), and added a test (`password.test.ts`) asserting the constant never exceeds an exported
`WORKERS_PBKDF2_ITERATION_CEILING`, so a future "let's be more OWASP-compliant" edit fails fast
in CI instead of live.

**Redeployed and fully re-verified end-to-end against live staging:** bcrypt-seeded login
succeeds (200, session token issued, 64 hex chars matching `bin2hex(random_bytes(32))`); the
issued token authenticates a real non-public `get_setting` call; a second login with the same
password also succeeds — confirming the bcrypt→PBKDF2 rehash-on-login path itself works and the
rehashed value verifies correctly on the next attempt. This is the actual admin credential now
live on staging (not written down here) — the login flow is provably working end-to-end.

Production has NOT been deployed or touched — only staging.

---

## Current state — 2026-08-01 (Phase 1: data migration)

**`scripts/migrate-data.mjs` written and run against staging — real prod data now lives on
staging Supabase.** Source: the daily automated backup at
`Z:\Backup\Websites\HDBS\Backup\202608010000HDBS.sql` (produced by `api/db_backup.php`, which
escapes every value with PDO's real `quote()` — well-defined MySQL string-literal escaping, not
an ad-hoc format, which is what made a small hand-written tokenizer reliable here instead of a
generic SQL parser).

**12 tables migrated**, matching row-for-row between dry-run and the real write:
settings (63), products (47), orders (2), order_items (4), refunds (1), reviews (1), faqs (11),
email_log (7), subscribers (2), tn_city_tax (52), studio_items (17), capital_equipment (13).

**Deliberately excluded** (see the script's header comment for full reasoning):
- `admin_sessions`, `customer_login_attempts`, `rate_limits` — ephemeral security/session
  bookkeeping tied to production IPs and tokens, meaningless on staging.
- `prompt_log` — orphaned table (finding 3), not even in the target schema.
- `customers`, `studio_inquiries`, `studio_project_notes`, `tax_sweeps` — confirmed empty in
  production, nothing to migrate.

**Idempotency strategy varies by table** because most int-id tables use
`bigint generated always as identity`, which PostgREST cannot accept explicit values for (no
`OVERRIDING SYSTEM VALUE` from the REST API) — so the original MySQL ids couldn't be preserved as
conflict targets:
- `settings` (key_name), `products`/`orders` (id), `subscribers` (email), `tn_city_tax`
  (city+county) kept a real natural key — genuine upsert, safe to re-run.
- `order_items`/`refunds` — scoped delete (matching the order_ids in this batch) then insert.
- `reviews`/`faqs`/`email_log`/`studio_items`/`capital_equipment` — delete-all-then-insert (small
  standalone content tables; safe because this is a one-time snapshot load into a disposable
  staging project, not a live incremental sync).

**A real timezone bug would have shipped without empirical verification** — `orders`/`products`
timestamps default to `current_timestamp()`, which this MySQL server returns in UTC, EXCEPT
`email_log.sent_at`, which `api/db_backup.php`'s sibling code deliberately stores in
America/New_York via `CONVERT_TZ(NOW(),'+00:00','-04:00')`. Confirmed empirically rather than
assumed: order `ORD-MR57UJ0A`'s `confirm_sent_at` (`2026-07-03 17:39:22`, treated as UTC) and its
matching `email_log` row's `sent_at` (`2026-07-03 13:39:24`, converted from America/New_York)
land within 2 seconds of each other — the same real event. The script applies a DST-aware
NY→UTC conversion (the standard double-`toLocaleString` trick) only to `email_log.sent_at`; every
other migrated timestamp is treated as already-UTC.

**Per the user's explicit decision**, sensitive settings (`github_token`, `smtp_pass`,
`square_access_token`, `admin_password`, `admin_sec_answer`, etc.) were migrated as-is, not
scrubbed. Consequence: staging's admin login now requires Suzi's **real** production password,
not the test password bootstrapped earlier this session. Risk is contained because the ported
code reads Square/email credentials from Worker secrets (`SQUARE_TOKEN`, `RESEND_API_KEY`, not
yet set on staging) rather than from the `settings` table the old PHP used — so these copied
values are currently inert data, not live credentials the new code will act on, unless a future
phase's route wiring reads `settings` for these instead of the correct Worker secret.

**Live-verified:** `GET /api/products.php` on staging now returns all 47 real products with
correct data — boolean coercion (`sell`/`coming_soon` as `0`/`1`) and the admin-only `cogm` gate
both confirmed working against real data, not just fakes.

**Migration `0009` run against staging and live-verified** — all 47 products' image URLs rewritten
from absolute (`https://handmadedesignsbysuzi.com/product_images/...`) to root-relative
(`/product_images/...`); confirmed via `GET /api/products.php`, zero products left with an
absolute URL.

**R2 population in progress**: `media-mirror/` (159 product images + 1 business logo, ~59MB,
pulled in Phase 0) is being uploaded to `hdbs-public-staging` via `wrangler r2 object put`, one
object per file, key = URL path minus the leading slash (`product_images/<filename>`,
`business_logo/<filename>`) so a simple `GET /product_images/*` Worker route can do
`env.R2_PUBLIC.get(pathname.slice(1))` directly — matching what migration 0009 actually produced,
not the plan's original aspirational `products/<id>/imgN.jpg` restructuring. `Cache-Control:
public, max-age=31536000, immutable` set on every object per the plan.

**`src/routes/media.ts` written and mounted** — `GET /product_images/*`, `/business_logo/*`,
`/business_hero/*`, `/business_about/*`, `/studio_images/*` all proxy to `env.R2_PUBLIC`, key =
URL path minus leading slash, `writeHttpMetadata()`/etag set from the R2 object, falling back to
a 1-year immutable cache-control if the object has none. Mounted before the SPA catch-all in
`src/index.ts` (required — these paths have a file extension so the catch-all's `wantsShell()`
correctly skips them, but would otherwise fall through to `env.ASSETS.fetch()`, 404, and render
the HTML shell instead of an image).

**All 160 files uploaded to `hdbs-public-staging`** via `wrangler r2 object put`
(`Cache-Control: public, max-age=31536000, immutable` set on each), 0 failures. **Live-verified**
end-to-end: real JPEG bytes with correct `Content-Type: image/jpeg` served through the Worker for
multiple spot-checked files (including a `_v2`-suffixed filename, confirming those replacement
images made it through Phase 0's media pull correctly), a real 404 for a nonexistent key, and
cross-checked every image URL the live `GET /api/products.php` response actually references
against the deployed bucket — all resolve. Phase 1's media/data/URL-normalization work is now
fully done and verified on staging.

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

**`src/products.ts` written** — ports `api/products.php`'s `GET` action (public/admin shared
catalog read): the row→DTO mapping, the admin-only `cogm` gate, and — per finding 4 in this
file — coercing the two real Postgres booleans (`sell`, `coming_soon`) back to `1`/`0` in the
response layer rather than touching the ~9,900 lines of loose JS comparisons. `POST`/`DELETE`
(create/update/delete) deliberately deferred: they carry the base64 product-image upload logic,
which needs rewriting against R2 rather than porting the disk-write code verbatim — same reasoning
as `settings.ts`'s deferred `biz_profile` image handling.

**`src/lib/cors.ts` written** — ports `api/config.php`'s `cors()`: allow-origin per environment
(mirroring `ALLOWED_ORIGIN`), the standard methods/headers allowlist, and an OPTIONS
short-circuit. Tested by mounting the middleware on a throwaway Hono app and exercising it with
`app.request()` (the pattern for any future Hono-middleware test — `security-headers.ts` has no
test file yet and could use the same treatment). Noted in the file: this is far less load-bearing
than it was on Hostinger, since same-origin `/api/` calls (Phase 2) never trigger a browser
preflight for the app's own requests — it now exists to keep OTHER origins out, not to let this
one in.

`npm test`: 109/109 passing. `tsc --noEmit`: clean (also added the missing `@types/bcryptjs` dev
dependency this session).

Also committed: `USER_MANUAL.md`, `backup_hdbs.ps1` (standalone Windows Task Scheduler version of
the `/BWEHDBSBackup` skill, for automated daily backups independent of a Claude Code subscription).

**That closes out every Phase 3 piece writable without a live Supabase project.** Everything left
in the plan's dependency order (`db.ts` itself, then wiring `auth.ts`/`settings.ts`/`products.ts`
into real Hono routes, then `customers.ts`/`orders.ts`, `tax.ts`/`shipping.ts`, `email.ts`,
payments) needs either a live store to test meaningfully or R2/Resend to exist. Confirmed with the
user (2026-07-30) that Supabase projects, R2 buckets, and the Resend domain are still not
provisioned — that is the next real unblock, and worth raising with the user directly rather than
continuing to find adjacent unblocked work.

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

- ~~`version.json` is a placeholder at `0.1.0`~~ — **Resolved 2026-08-01**: set to the real `4.27.0`
  during the `window.BIZ_VERSION` fix (see that Incident entry above).
- ~~Whether `checkout.php` (admin-gated legacy Square hosted links) is still used~~ — **Resolved
  2026-08-01: drop it**, confirmed by the user. Not ported; superseded by the embedded Square Web
  Payments SDK flow (`process_payment.php`'s port).
- ~~Whether guest order lookup (finding 4) is wanted at all~~ — **Resolved 2026-08-01: drop it**,
  confirmed by the user. Production's `order_lookup_requests` table has never existed (finding 4),
  meaning the feature has never actually been used. Not ported.
- ~~Whether `api/admin.php`'s arbitrary-SQL DB browser is dropped~~ — **Resolved 2026-08-01: drop
  it**, confirmed by the user. Supabase's own SQL editor replaces it. Not ported.

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
