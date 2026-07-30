-- 0004_customers — customers, customer_login_attempts, subscribers.
--
-- ⭐ NOTE FOR THE PORT: `customers` has ZERO ROWS in production (verified — api/db_backup.php
-- emits an INSERT block only for tables with data, and there is none for this table). No customer
-- account has ever been created on the live site.
--
-- That substantially deflates what the migration plan ranked as its fifth-largest risk: bcrypt
-- password hashes not being cheaply verifiable in a Worker. There are no customer hashes to
-- verify, so there is no customer-lockout scenario and no need to send password-reset mail from a
-- brand-new sending domain.
--
-- The bcrypt→PBKDF2 transparent-rehash work is still required, but only for the ADMIN password and
-- security answer, which live in the settings table (api/admin.php:102,150,167). Verified those
-- use password_hash(..., PASSWORD_DEFAULT), i.e. bcrypt with a $2y$ prefix.

create table customers (
  -- App-generated ID, not a sequence.
  id            text primary key,
  first_name    text,
  last_name     text,

  -- citext + unique, replacing MySQL's `UNIQUE KEY email` under a case-insensitive collation.
  -- Without citext the unique constraint would change meaning: alice@x.com and Alice@x.com would
  -- become two distinct accounts, and login would fail for whichever the user didn't type.
  email         citext not null unique,

  -- bcrypt ($2y$) today. The port verifies with bcryptjs and rehashes to PBKDF2-SHA256 on the
  -- next successful login, so the column holds a mix of both formats — branch on the prefix.
  password_hash text,

  phone         text,
  sec_question  text,
  -- Also bcrypt, and api/customers.php:176 already tolerates a legacy plaintext value by checking
  -- for the $2y$ prefix first. Preserve that tolerance.
  sec_answer    text,

  order_count   integer default 0,
  joined_at     timestamptz default now()
);

alter table customers enable row level security;


-- ── customer_login_attempts ──
-- Per-email login throttle, separate from the generic rate_limits table. Created lazily in SIX
-- different places (api/customers.php:38,88,148,199, deploy_log.php:16, orders.php:100).
--
-- email_hash was char(32) holding md5(lower(trim(email))). Opaque text here; like rate_limits this
-- is ephemeral throttle state, so the hash function can change with no data migration.
-- last_at widened from int(11) to bigint (2038).
create table customer_login_attempts (
  email_hash text primary key,
  attempts   integer not null default 0,
  last_at    bigint  not null default 0
);

create index customer_login_attempts_last_at_idx on customer_login_attempts (last_at);

alter table customer_login_attempts enable row level security;


-- ── subscribers ──
-- Newsletter signups. `source` was added lazily by api/subscribers.php:50 and records which
-- surface the signup came from ("Notify me" on a coming-soon product vs. the footer form).
create table subscribers (
  id            bigint generated always as identity primary key,
  -- citext + unique, same reasoning as customers.email: MySQL's UNIQUE KEY was case-insensitive,
  -- and here it also prevents the same person being emailed twice.
  email         citext not null unique,
  subscribed_at timestamptz default now(),
  source        text
);

alter table subscribers enable row level security;
