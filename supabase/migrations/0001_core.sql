-- 0001_core — settings, admin sessions, rate limiting, shared helpers.
--
-- Converted from the live production MySQL schema recovered in docs/schema-live-prod.sql.
-- Read docs/schema-reconciliation.md before changing anything here.
--
-- Migrations use a strictly-increasing serial prefix (0001, 0002, ...) rather than
-- BusinessWebExpress's YYYYMMDDHHMMSS_ convention, which has already produced two timestamp
-- collisions in that repo.
--
-- ── Why RLS is enabled with NO policies, on every table in every migration ──
-- The Worker talks to Postgres exclusively with the service-role key, and the browser never
-- reaches Supabase directly — it only ever calls /api/* on the Worker. Service role bypasses RLS,
-- so enabling it costs nothing at runtime while making a leaked anon/publishable key completely
-- inert. This is deliberate. Do NOT "fix" the absence of policies by adding permissive ones.

create extension if not exists citext;

-- MySQL's utf8mb4_unicode_ci / utf8mb4_uca1400_ai_ci collations made every string comparison
-- case-insensitive. Postgres is case-sensitive, which would silently turn "account not found"
-- into a support ticket for anyone who typed a capital letter in their email address. citext
-- restores the old behaviour at the column level, so a missed lowercase() call at one site
-- cannot cause it.

-- Shared trigger for MySQL's `ON UPDATE current_timestamp()`, which Postgres has no column-level
-- equivalent for. Used by products.updated_at and tn_city_tax.updated_at.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ── settings ──
-- Key/value store holding biz_profile (the JSON blob index.php renders its SEO/OG tags from),
-- nav_order (the admin's nested drag-and-drop nav tree), SMTP config, the admin password hash,
-- and the security question/answer.
--
-- `value` stays a single opaque text column. nav_order in particular is a bespoke nested JSON blob
-- with a localStorage companion (hdbs_nav_folders) — treat it as an opaque string end-to-end and
-- do not normalise it into columns.
--
-- NOT carried over: the major_version / minor_version rows. Version now lives in version.json so
-- it is diffable in a PR and is a git question rather than a database question. The
-- api/deploy_log.php 300s-debounce auto-bump hack goes away with them.
create table settings (
  key_name text primary key,
  value    text
);

alter table settings enable row level security;


-- ── admin_sessions ──
-- Opaque bearer tokens presented in the X-Admin-Token header. Ported as-is: there is no
-- $_SESSION, cookie, or JWT anywhere in this application, and js/auth.js plus ~15 admin JS
-- modules set that header by hand.
--
-- `expires` stays epoch SECONDS as a bigint rather than becoming a timestamptz, because
-- js/auth.js compares the raw number. Widened from MySQL's bigint(20) semantics unchanged.
--
-- NOT carried over: the legacy fallback in api/config.php:52-58 that read admin_session_token /
-- admin_session_expires out of the settings table. It existed for backward compatibility with a
-- pre-admin_sessions deploy. Consequence: the admin must log in again after cutover.
create table admin_sessions (
  token   text primary key,
  expires bigint not null
);

-- The PHP never cleaned this table up, so production has accumulated dead rows. The daily
-- "0 4 * * *" cron prunes it.
create index admin_sessions_expires_idx on admin_sessions (expires);

alter table admin_sessions enable row level security;


-- ── rate_limits ──
-- Generic per-key throttle, keyed by a hash of a purpose prefix plus the client IP
-- (api/contact.php:17, reviews.php:48, subscribers.php:22, studio.php:185).
--
-- key_hash was char(32) holding PHP md5() output. It is now plain text and treated as opaque:
-- this table is ephemeral throttle state, so the hash function can be switched to SHA-256 during
-- the port with no data migration.
--
-- last_at was int(11) in MySQL — a 2038 problem. Widened to bigint, still epoch seconds.
--
-- Cloudflare's native rate-limiting binding was considered and rejected: it is per-colo and does
-- not provide the "lock this account after N attempts" semantics the existing code relies on.
create table rate_limits (
  key_hash text primary key,
  attempts integer not null default 0,
  last_at  bigint  not null default 0
);

create index rate_limits_last_at_idx on rate_limits (last_at);

alter table rate_limits enable row level security;
