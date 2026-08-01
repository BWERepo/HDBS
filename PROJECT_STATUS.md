# HDBS — Project Status

> Working memory for the Handmade Designs By Suzi project. A brand-new session should be able to
> resume from this file alone. Newest status at the top.

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
