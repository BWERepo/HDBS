-- 0014_coupon_codes — coupons become named batches that generate individually-tracked,
-- single-use random codes (one printed per physical copy), replacing the old model of one
-- shared/typed code redeemable up to `quantity` times.
--
-- Product decision: wipe and start fresh rather than migrate existing rows — the prior coupon
-- feature had only just shipped (0012/0013) and had no real production usage worth preserving,
-- so reconciling old shared-code redemption history against newly-generated individual codes
-- isn't worth the complexity. This DROPs and recreates every coupon-related table/function.
--
-- New shape:
--   coupons        — the batch: an admin-facing `name` (not a redeemable code), percent `amount`,
--                     `quantity` (how many individual codes were generated), active/expires_at.
--   coupon_codes   — one row per generated code. `redeemed_at is null` = unused. Redemption stamps
--                     order_id/customer_email/discount_amount/redeemed_at directly on the row —
--                     there's no separate `coupon_redemptions` table anymore since each code maps
--                     to at most one redemption by construction.
--   coupon_batch_summary — a view joining the two so the admin list can show used/total without a
--                     second query per batch.
--
-- The old "one redemption per customer per code" uniqueness constraint is gone: it's moot once
-- each code is single-use table-wide (mirrors how a real printed paper coupon works — whoever
-- has it can redeem it once, full stop).
--
-- Both schemas covered in one file/one paste (both live in the shared DR Supabase project,
-- qrsydsglkgampabirejz) — run the whole file at once rather than two separate copy/pastes.

set search_path to hdbs_staging, extensions;

drop function if exists redeem_code_if_available(text, text, extensions.citext, numeric);
drop function if exists redeem_coupon_if_available(text, numeric);
drop view if exists coupon_batch_summary;
drop table if exists coupon_redemptions cascade;
drop table if exists coupon_codes cascade;
drop table if exists coupons cascade;

create table coupons (
  id          bigint generated always as identity primary key,
  name        text not null,
  amount      numeric(10,2) not null,
  quantity    integer not null,
  active      boolean not null default true,
  expires_at  date,
  created_at  timestamptz not null default now()
);
alter table coupons enable row level security;

create table coupon_codes (
  code             text primary key,
  batch_id         bigint not null references coupons (id) on delete cascade,
  order_id         text references orders (id) on delete set null,
  customer_email   extensions.citext,
  discount_amount  numeric(10,2),
  redeemed_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index coupon_codes_batch_idx on coupon_codes (batch_id);
create index coupon_codes_email_idx on coupon_codes (customer_email);
alter table coupon_codes enable row level security;

create view coupon_batch_summary as
select
  b.id, b.name, b.amount, b.quantity, b.active, b.expires_at, b.created_at,
  count(cc.code) filter (where cc.redeemed_at is not null) as used_count
from coupons b
left join coupon_codes cc on cc.batch_id = b.id
group by b.id;

-- Atomic conditional redemption, same reasoning as 0010's decrement_stock_if_available: PostgREST
-- can't express a conditional update in one round trip, and a code must not be redeemable twice
-- under concurrent checkouts.
create or replace function redeem_code_if_available(p_code text, p_order_id text, p_email extensions.citext, p_discount_amount numeric)
returns table(ok boolean) as $$
begin
  perform 1
  from coupon_codes cc
  join coupons b on b.id = cc.batch_id
  where cc.code = p_code
    and cc.redeemed_at is null
    and b.active
    and (b.expires_at is null or b.expires_at >= current_date)
  for update of cc;

  if not found then
    return query select false;
    return;
  end if;

  update coupon_codes
  set redeemed_at = now(), order_id = p_order_id, customer_email = p_email, discount_amount = p_discount_amount
  where code = p_code;

  return query select true;
end;
$$ language plpgsql;


set search_path to hdbs_prod, extensions;

drop function if exists redeem_code_if_available(text, text, extensions.citext, numeric);
drop function if exists redeem_coupon_if_available(text, numeric);
drop view if exists coupon_batch_summary;
drop table if exists coupon_redemptions cascade;
drop table if exists coupon_codes cascade;
drop table if exists coupons cascade;

create table coupons (
  id          bigint generated always as identity primary key,
  name        text not null,
  amount      numeric(10,2) not null,
  quantity    integer not null,
  active      boolean not null default true,
  expires_at  date,
  created_at  timestamptz not null default now()
);
alter table coupons enable row level security;

create table coupon_codes (
  code             text primary key,
  batch_id         bigint not null references coupons (id) on delete cascade,
  order_id         text references orders (id) on delete set null,
  customer_email   extensions.citext,
  discount_amount  numeric(10,2),
  redeemed_at      timestamptz,
  created_at       timestamptz not null default now()
);
create index coupon_codes_batch_idx on coupon_codes (batch_id);
create index coupon_codes_email_idx on coupon_codes (customer_email);
alter table coupon_codes enable row level security;

create view coupon_batch_summary as
select
  b.id, b.name, b.amount, b.quantity, b.active, b.expires_at, b.created_at,
  count(cc.code) filter (where cc.redeemed_at is not null) as used_count
from coupons b
left join coupon_codes cc on cc.batch_id = b.id
group by b.id;

create or replace function redeem_code_if_available(p_code text, p_order_id text, p_email extensions.citext, p_discount_amount numeric)
returns table(ok boolean) as $$
begin
  perform 1
  from coupon_codes cc
  join coupons b on b.id = cc.batch_id
  where cc.code = p_code
    and cc.redeemed_at is null
    and b.active
    and (b.expires_at is null or b.expires_at >= current_date)
  for update of cc;

  if not found then
    return query select false;
    return;
  end if;

  update coupon_codes
  set redeemed_at = now(), order_id = p_order_id, customer_email = p_email, discount_amount = p_discount_amount
  where code = p_code;

  return query select true;
end;
$$ language plpgsql;

notify pgrst, 'reload schema';
