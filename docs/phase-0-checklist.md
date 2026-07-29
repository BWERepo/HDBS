# Phase 0 checklist — foundations & rescue

Everything here is a prerequisite for Phase 1. **Nothing in this list touches production.** The
live PHP site keeps running and serving orders throughout.

Items marked 👤 need you (account access, credentials, a browser). Items marked 🤖 I can do once
the 👤 item it depends on is done.

---

## 1. ✅ Media rescue — DONE, with one gap

**Completed 2026-07-29.** `media-mirror/` holds **159/159 product images + 1 business logo**,
48.4 MB, zero zero-byte files. Verified against the database: 137 distinct filenames are
referenced, so the ~22 extra files on disk are orphans from replaced uploads — expected.

`business_hero/`, `business_about/` and `studio_images/` came back empty, and the database confirms
that is correct: **zero references** to any of them. Those features were never used.

### 👤 Remaining gap — 13 capital-equipment receipts

`capital_equipment` has **13 rows carrying real `.pdf`/`.jpg` receipt filenames**, but
`../capital_equipment_receipts/` returned empty over FTP. That is almost certainly the FTP account
being chrooted to `public_html` and refusing `../` traversal — not missing files. Same for
`../business_documents/` (which has no DB table, so its contents are unknown).

These are business/tax records and are **not recoverable from anywhere else**. FTP can't reach
them, so pull them by hand:

Hostinger hPanel → **File Manager** → navigate one level *above* `public_html` → download the
`capital_equipment_receipts/` and `business_documents/` folders → drop them into
`media-mirror/capital_equipment_receipts/` and `media-mirror/business_documents/`.

Then confirm with:

```bash
powershell -File scripts/pull-media.ps1 -VerifyOnly
```

> Do not skip this because the folders looked empty. The FTP listing is not evidence they are —
> the database says otherwise.

---

## 1b. 👤 Keep the mirror somewhere permanent

`media-mirror/` is gitignored (48 MB of binaries don't belong in git) and excluded from
`deploy.ps1`. That means **it is currently the only copy outside Hostinger, and it is not backed
up by anything.** Copy it somewhere permanent — alongside the `.sql`/`.zip` backups in
`Z:\Backup\Websites\HDBS\Backup\` is the obvious home.

Why this mattered: these directories are on `deploy.ps1`'s exclude list, so they were never
uploaded *from* the repo. They only ever arrived by the admin UI writing to the server's
filesystem, which is why the server held the only copy.

The rewritten `BWEHDBSBackup` skill adds an R2 media sync for exactly this reason — under FTP the
media was implicitly covered by any file backup; under R2 it will not be.

> Re-run `scripts/pull-media.ps1` immediately before the Phase 9 cutover to catch anything Suzi
> uploads in the interim. It is idempotent.

---

## 2. 👤 Staging database schema dump

Production's schema is already recovered — see `docs/schema-live-prod.sql`, extracted from the
nightly backup. Staging has **not** been dumped, and staging is where new columns land first, so
it may carry columns production doesn't.

In Hostinger hPanel → phpMyAdmin → database `u541882440_hdbs_staging` → **Export** → *Custom* →
**Structure only** → Go. Save it into the repo as `docs/schema-live-staging.sql`.

🤖 I'll then diff it against production and fold any differences into the migration.

---

## 3. 👤 Supabase — two projects

Two separate projects, not one with two schemas. Service role sees everything, so a schema is not
a security boundary, and HDBS handles live payments and customer PII — a staging mistake reaching
production orders is categorically worse here than on BusinessWebExpress (which uses one project).
Free tier, $0.

- Create `hdbs-prod` and `hdbs-staging` at https://supabase.com/dashboard
- Region: US East, to sit near the existing customer base
- Save each project's **DB password** into Windows Credential Manager as
  `HDBS-Supabase-DB-Password-Prod` and `HDBS-Supabase-DB-Password-Staging` (the backup skill will
  read these, retiring the old `HDBS-Backup-Token`)
- From each project's **Settings → API**, note the Project URL and the `service_role` key —
  you'll paste them into `wrangler secret put` in step 6

⚠️ Both projects need the keepalive cron; the free tier auto-pauses after 7 idle days. That's
already declared in `wrangler.jsonc` (`0 */6 * * *`).

---

## 4. 👤 Cloudflare — R2 buckets

Four buckets, on the same account as BusinessWebExpress (`info@businesswebexpress.com`):

| Bucket | Holds |
|---|---|
| `hdbs-public` | product images, brand logo/hero/about, studio gallery |
| `hdbs-private` | business documents, capital-equipment receipts |
| `hdbs-public-staging` | — |
| `hdbs-private-staging` | — |

**Do not** enable public access on any of them. `hdbs-public` is served *through* the Worker so
the existing `/product_images/...` URL shape survives, and `hdbs-private` reproduces today's
above-webroot boundary (`api/business_docs.php:12`, `api/capital_equipment.php:27`) — those files
are admin-gated and must never be publicly reachable.

```bash
npx wrangler r2 bucket create hdbs-public
```

---

## 5. 👤 Resend — sending domain

Replaces `mailer.php`, which opens a raw SMTP socket that Workers cannot do.

- Add domain **`mail.handmadedesignsbysuzi.com`** — a subdomain, not the apex, so the sending
  reputation stays isolated from whatever Hostinger/Yahoo mail does
- Add the DKIM/SPF records Resend gives you **at Hostinger DNS now**. Doing this before the
  nameserver move means email is working and verified well before cutover, instead of depending
  on it
- Generate an API key → that's `RESEND_API_KEY` in step 6

> Worth knowing: the current sender is Yahoo consumer SMTP (`smtp.mail.yahoo.com:587`) relaying
> business mail, so deliverability is probably already mediocre. This is an upgrade, not just a port.

---

## 6. 👤 Worker secrets

Both Workers get **identical secret names**; only the values differ (sandbox on staging, live on
production). That's what makes `npm run check:secrets` meaningful and removes a family of
`if ($__staging)` branches from the code.

```bash
npx wrangler secret put SUPABASE_URL --name hdbs-staging
```

Full list (see `src/types.ts`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_TOKEN_SECRET`,
`SMOKE_TOKEN`, `SQUARE_TOKEN`, `SQUARE_APP_ID`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIG_KEY`,
`PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `USPS_CONSUMER_KEY`, `USPS_CONSUMER_SECRET`, `RESEND_API_KEY`.

Existing values come from `secrets.php` (production) and `secrets.staging.php` (staging), which
sit above the webroot on Hostinger. Two exceptions — **generate these fresh, do not copy**:

- `ORDER_TOKEN_SECRET` — replaces the current HMAC keyed on the *database password*
  (`api/order_token.php:14`, `api/orders.php:222`, `api/customers.php:282`). Different value per
  environment. Generate 32 random bytes.
- `SMOKE_TOKEN` — replaces the `rt_token` settings row. The current one is sitting in plaintext in
  a tracked file (`Claude.md:57`) and should be rotated regardless.

`SMTP_PASS` and `DB_PASSWORD` disappear entirely. Fewer secrets is the goal.

---

## 7. 👤 Cloudflare Access on staging

Replaces the staging HTTP Basic Auth. Create an Access application over the `hdbs-staging`
workers.dev hostname with a one-time-PIN policy allowing `info@businesswebexpress.com` and Suzi's
address.

This kills three things at once: the shared password, the "never overwrite staging's `.htaccess`"
special case (`deploy.ps1:33`), and `staging-login.html` — which currently **hardcodes the staging
username and password in cleartext on line 61**, is not gitignored, and is uploaded to the live
server on every full deploy.

---

## 8. 👤 Two security fixes worth doing now, regardless

Independent of the migration; both are live today.

1. **Rotate the `regression_test.php` token.** `Claude.md:57` has the production value in
   plaintext in a tracked file.
2. **Change the staging Basic Auth password**, or complete step 7 which removes it entirely.
   `staging-login.html:61` exposes it in the repo *and* on the server.

---

## 9. 👤 One decision I need

`docs/schema-reconciliation.md` finding 4: `order_lookup_requests` has **never existed** in the
production database. It's created lazily on first use by `api/order_lookup.php:24`, so the guest
"look up my order by email magic link" flow appears to have never run in production.

Is that feature (a) unused and droppable, or (b) supposed to work and quietly broken? It changes
whether I port ~120 lines and the `ORDER_TOKEN_SECRET` magic-link flow with it.

---

## Definition of done

- [ ] `media-mirror/` complete, verified, copied somewhere permanent
- [ ] `docs/schema-live-staging.sql` exists and has been diffed against production
- [ ] Both Supabase projects exist; passwords in Credential Manager
- [ ] Four R2 buckets exist, none public
- [ ] Resend domain verified and sending
- [ ] All 13 secrets set on both Workers; `npm run check:secrets` passes
- [ ] Cloudflare Access protecting staging
- [ ] `npx wrangler deploy --env staging` succeeds and `/api/health` returns 200

That last item is the Phase 0 demo: `hdbs-staging.workers.dev` alive, production Worker still
routeless and unreachable, `handmadedesignsbysuzi.com` still served entirely by Hostinger.
