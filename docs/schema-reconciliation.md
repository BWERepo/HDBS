# Schema reconciliation — live production vs. the PHP source

**Source of truth:** `Z:\Backup\Websites\HDBS\Backup\202607290000HDBS.sql`, the nightly
production backup generated 2026-07-29 04:00 EDT by `api/db_backup.php`, which emits real
`SHOW CREATE TABLE` output (`api/db_backup.php:32`).

Schema extracted, data excluded, to [`schema-live-prod.sql`](schema-live-prod.sql) — 20 tables,
241 lines.

**Why this dump is trustworthy as a complete inventory:** `api/db_backup.php:24` enumerates via
`SHOW TABLES` (not a hardcoded list), and line 38 (`if ($rows)`) emits an `INSERT` block only for
tables that have data. So a table present with no `INSERT` is genuinely empty, and no table can be
silently omitted.

This document exists because HDBS has **no schema file**. The schema is created lazily at runtime
by `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN` scattered across nine PHP files,
so the code's DDL is incomplete by construction and could not be trusted as the migration input.

> **Still outstanding:** the staging DB (`u541882440_hdbs_staging`) has not been dumped. Staging is
> where new columns land first, so it may carry columns production does not. Diff it before
> writing migration `0001`.

---

## Headline deltas from what the migration plan assumed

| # | Assumption | Reality | Consequence |
|---|---|---|---|
| 1 | 21 tables | **20 tables** | — |
| 2 | — | **`prompt_log` exists** and was missed entirely by the source exploration | **Orphaned table — drop it.** `regression_test.php:1387` asserts *"api/prompt_log.php removed from server"*: the endpoint was deliberately deleted and the table was left behind. It is a developer scratchpad (`category`, `prompt`, `notes`, ~23 rows) with no remaining reader |
| 3 | `order_lookup_requests` is a live table | **Does not exist in production** | `api/order_lookup.php:24` creates it lazily on first use, so the guest magic-link order-lookup rate limiter has **never run in production**. The feature may simply be unused rather than broken — confirm with the user before porting |
| 4 | `tn_sales_tax` and `tn_city_tax` both exist | **Only `tn_city_tax` exists** (52 rows) | ⭐ **`api/tn_tax.php` is dead, broken code.** `regression_test.php:339` asserts *"tn_sales_tax table removed"* — the table was intentionally dropped, but all 53 lines of `api/tn_tax.php` still query it and fail at line 17 with *"Table tn_sales_tax does not exist"*. **Do not port it.** Only `api/tn_city_tax.php` is live |
| 5 | Customer passwords are bcrypt and must be migrated | **`customers` has ZERO rows** | ⭐ **Risk 5 in the plan largely evaporates.** No customer accounts exist. The bcrypt→PBKDF2 transparent-rehash work is still needed for the *admin* password and security answer (stored in `settings`), but there is no customer-lockout risk and no mass password-reset concern |
| 6 | No table-level constraints mentioned | **`order_items` has a real FK** to `orders(id)` `ON DELETE CASCADE` | The only foreign key in the database. Must be preserved — order deletion currently cascades |
| 7 | Collation is uniformly `utf8mb4_unicode_ci` | **Mixed**: `utf8mb4_unicode_ci` and `utf8mb4_uca1400_ai_ci` (MariaDB 11 default) | Both are case-insensitive, so the Postgres case-sensitivity risk stands. `customers.email` and `subscribers.email` both carry `UNIQUE KEY email` — they need `citext`, or the unique index changes meaning |
| 8 | — | **`reviews.status` is `enum('pending','approved')`** | Needs a Postgres enum type or a `CHECK` constraint; a bare `text` column loses the guarantee |
| 9 | — | **No `business_docs` table** | `api/business_docs.php` appears to be filesystem-only with no DB metadata. Confirm before designing the private-R2 route |

---

## Boolean columns — the complete list (plan risk 4)

Smaller than feared. Only three columns are boolean-shaped, and two are `tinyint(4)`, not
`tinyint(1)`:

| Table | Column | MySQL type | Default |
|---|---|---|---|
| `products` | `sell` | `tinyint(1)` | `1` |
| `products` | `coming_soon` | `tinyint(4)` | `0` |
| `studio_items` | `active` | `tinyint(4)` | `1` |

The mitigation stands: model them as `boolean` in Postgres but **coerce back to `1`/`0` in the API
response layer**, so the ~9,900 lines of vanilla JS see exactly what they see today. Grep `sell`,
`coming_soon`, and `active` across `js/` before deciding otherwise.

---

## Lazy DDL inventory — what must become migration `0001`

Far more widespread than `ensureProductColumns()` alone. **`orders` gains seven columns lazily
across five different files**, which is why the source code can never be the schema authority:

| Table | Lazily added by | Columns |
|---|---|---|
| `orders` | `api/orders.php:15-17` | `payment_configuration`, `check_number`, `refunded_amount` |
| `orders` | `api/refund.php:22-23` | `refunded_amount` (duplicate of the above) |
| `orders` | `api/square_payments.php:19-20` | `refunded_amount` (third copy) |
| `orders` | `api/paypal.php:96-100` | `paypal_capture_id`, `paypal_surcharge` |
| `orders` | `api/orders.php:22-24` | widens `tracking_number` to `varchar(500)` |
| `orders` | `api/tax_sweep.php:34` | checks `tax_swept_date` |
| `products` | `api/config.php:241-243` (`ensureProductColumns`) | `ship_mode`, `ship_fixed`, `coming_soon`, `cogm`, `launch_date` |
| `subscribers` | `api/subscribers.php:50` | `source` |
| `studio_inquiries` | `api/studio.php:48-53` | `status` (widen), `due_date` |
| `capital_equipment` | `api/capital_equipment.php:20-21` | loop-driven, columns from a config array |
| `tax_sweeps` | `api/tax_sweep.php:99` | `order_details` |
| `admin_sessions` | `api/config.php:41` | whole table |
| `rate_limits` | `api/reviews.php:50`, `subscribers.php:24`, `contact.php:19`, `studio.php:187` | whole table, four copies |
| `customer_login_attempts` | `api/customers.php:38,88,148,199`, `deploy_log.php:16`, `orders.php:100` | whole table, six copies |
| `order_lookup_requests` | `api/order_lookup.php:24` | whole table — **never actually created in prod** |

All of it is deleted in the port. The five `ensureProductColumns` columns and every lazily-added
`orders` column are declared up front in `0001`.

---

## MySQL → Postgres conversion notes, specific to this schema

- **App-generated IDs, not sequences.** `orders.id`, `products.id`, `customers.id` are
  `varchar(32)` primary keys generated in PHP. Keep them as `text` — do **not** convert to
  identity columns. Only `order_items`, `email_log`, `faqs`, `refunds`, `reviews`,
  `studio_items`, `studio_inquiries`, `studio_project_notes`, `subscribers`, `tax_sweeps`,
  `tn_city_tax`, `capital_equipment`, `prompt_log` use `AUTO_INCREMENT` → `bigint generated always
  as identity`.
- **Money** — `decimal(10,2)` throughout, plus `orders.transaction_fee decimal(8,2)` and
  `tn_city_tax.tax_rate decimal(5,4)`. All become `numeric` with the same precision. Never float:
  `api/process_payment.php` recomputes order totals server-side and rounding drift there is a
  payment mismatch.
- **`timestamp NULL DEFAULT current_timestamp()`** → `timestamptz default now()`. Note
  `products.updated_at` also carries `ON UPDATE current_timestamp()`, which Postgres has no
  equivalent for — it needs a trigger, or the update path sets it explicitly.
- **`date` columns** (`orders.order_date`, `tax_swept_date`, `products.launch_date`,
  `capital_equipment.purchase_date`, `studio_inquiries.due_date`) stay `date`. No timezone
  hazard on these.
- **Epoch integers** — `admin_sessions.expires` is `bigint`; `rate_limits.last_at` and
  `customer_login_attempts.last_at` are `int(11)` (a 2038 problem). Widen both to `bigint` but
  keep them as epoch seconds — `js/auth.js` compares raw numbers.
- **`char(32)` hash keys** — `rate_limits.key_hash` and `customer_login_attempts.email_hash` hold
  PHP `md5()` output. They stay as opaque `text` keys; the hash function itself is internal and
  can be swapped to SHA-256 during the port without a data migration, since both tables are
  ephemeral rate-limit state.
- **`mediumtext`/`longtext`** → `text`. Affects `products.img1/2/3`, `settings.value`,
  `email_log.email_body`.
- **`products.launch_date NOT NULL DEFAULT '2026-07-01'`** — a hardcoded literal default. Carry it
  or replace with `current_date`; flag for a decision.
- **`AUTO_INCREMENT=` values give live row-count upper bounds**: `order_items` 345, `email_log`
  109, `tn_city_tax` 53, `prompt_log` 24, `studio_items` 18, `capital_equipment` 14, `faqs` 13,
  `subscribers` 4, `refunds` 2, `reviews` 2, `tax_sweeps` 6. This is a small database. The whole
  dump is 109 KB.
- **Empty in production** (no `INSERT` emitted): `customers`, `studio_inquiries`,
  `studio_project_notes`, `tax_sweeps`. Create the tables; expect no data migration for them.

---

## RLS

Enable RLS on every table with **no permissive policies**. The Worker uses the service-role key
exclusively and the browser never talks to Supabase directly, so service role bypasses RLS and
this costs nothing — while making a leaked anon key completely inert. Record the rationale in
`0001` so a future session does not "fix" the absence of policies.
