-- 0012_coupons — coupon codes, redemption history, and customer store credit.
--
-- New feature (not a PHP port). A coupon is a single code (admin-supplied or auto-generated) with
-- a `quantity` — the max number of times it may be redeemed, across all customers, each use
-- independently capped at `amount` (or the order's subtotal if smaller) — no shared dollar pool
-- across uses. `used_count` increments atomically on each redemption. "Number created"/"number
-- used" are `quantity`/`used_count`, stored directly on the row.
--
-- A customer may redeem a given code at most once (coupon_redemptions_code_email_uidx below).
--
-- When a dollar coupon's face value exceeds what a single order actually needed (e.g. a $25
-- coupon applied to a $15 order), the $10 difference is credited to the customer's account as
-- store credit — but only if the order's email matches an existing customer account; guest
-- checkouts simply don't collect the unused difference. Store credit is then spendable at a later
-- checkout the same way a coupon discount is (see orders.ts's `_credit` line item).
--
-- `citext` is schema-qualified as `extensions.citext` throughout (rather than relying on
-- `search_path` to include `extensions`) so this migration doesn't error with "type citext does
-- not exist" when run against a schema-scoped connection (e.g. `set search_path to hdbs_prod;`
-- with no `extensions` in the path).

create table coupons (
  code         text primary key,
  coupon_type  text not null check (coupon_type in ('dollar', 'percent')),
  amount       numeric(10,2) not null,
  quantity     integer not null,
  used_count   integer not null default 0,
  expires_at   date,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table coupons enable row level security;


create table coupon_redemptions (
  id               bigint generated always as identity primary key,
  code             text not null references coupons (code),
  order_id         text not null references orders (id) on delete cascade,
  customer_email   extensions.citext,
  discount_amount  numeric(10,2) not null,
  redeemed_at      timestamptz not null default now()
);

create index coupon_redemptions_code_idx  on coupon_redemptions (code);
create index coupon_redemptions_email_idx on coupon_redemptions (customer_email);

-- A customer may only use a given code once. Partial (excludes null emails) since a guest order
-- with no email can't be deduplicated this way — that's an accepted gap, not a bypass worth
-- blocking checkout over.
create unique index coupon_redemptions_code_email_uidx on coupon_redemptions (code, customer_email) where customer_email is not null;

alter table coupon_redemptions enable row level security;


-- Atomic conditional redemption, same reasoning as 0010's decrement_stock_if_available:
-- PostgREST can't express a conditional update in one round trip, and concurrent checkouts must
-- not exceed `quantity` uses.
create or replace function redeem_coupon_if_available(p_code text, p_requested numeric)
returns table(ok boolean, applied numeric) as $$
declare
  v_type text;
begin
  select coupon_type into v_type
  from coupons
  where code = p_code
    and active
    and used_count < quantity
    and (expires_at is null or expires_at >= current_date)
  for update;

  if not found then
    return query select false, 0::numeric;
    return;
  end if;

  update coupons set used_count = used_count + 1 where code = p_code;
  return query select true, p_requested;
end;
$$ language plpgsql;


-- ── Store credit ──
alter table customers add column store_credit_balance numeric(10,2) not null default 0;

create table store_credit_transactions (
  id             bigint generated always as identity primary key,
  customer_email extensions.citext not null,
  -- Positive = credit added (unused coupon difference), negative = credit spent at checkout.
  amount         numeric(10,2) not null,
  reason         text not null,
  order_id       text references orders (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index store_credit_transactions_email_idx on store_credit_transactions (customer_email);

alter table store_credit_transactions enable row level security;

-- Credits a customer's account. Only called when the order's email matches a real customer row
-- (checked by the caller via a real UPDATE ... WHERE email = ... — an UPDATE that touches zero
-- rows for a non-account email is simply a no-op, which is the desired "guest gets nothing" case).
create or replace function credit_store_account(p_email extensions.citext, p_amount numeric)
returns boolean as $$
declare
  v_updated integer;
begin
  update customers set store_credit_balance = store_credit_balance + p_amount where email = p_email;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$ language plpgsql;

-- Atomic conditional debit — mirrors redeem_coupon_if_available's reasoning.
create or replace function debit_store_credit_if_available(p_email extensions.citext, p_requested numeric)
returns table(ok boolean, applied numeric) as $$
declare
  v_balance numeric;
  v_applied numeric;
begin
  select store_credit_balance into v_balance from customers where email = p_email for update;

  if not found or v_balance <= 0 then
    return query select false, 0::numeric;
    return;
  end if;

  v_applied := least(v_balance, p_requested);
  update customers set store_credit_balance = store_credit_balance - v_applied where email = p_email;
  return query select true, v_applied;
end;
$$ language plpgsql;
