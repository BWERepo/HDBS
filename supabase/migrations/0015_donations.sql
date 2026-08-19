-- 0015_donations — a "Donated" flag on products, plus a separate donations log (date, recipient,
-- product) recorded independently via its own admin screen.
--
-- `products.donated` is just a boolean on the product row (mutually exclusive with `sell`,
-- enforced in src/products.ts's saveProduct). `donations` is a separate log table — checking a
-- product's Donated checkbox does NOT itself create a donation record; the admin logs the actual
-- date/recipient separately via Shop > Donations, so the log can't gain a phantom entry just from
-- flipping the flag, and un-checking Donated later doesn't erase donation history.
--
-- Both schemas covered in one file/one paste (both live in the shared DR Supabase project,
-- qrsydsglkgampabirejz) — run the whole file at once rather than two separate copy/pastes.

set search_path to hdbs_staging, extensions;

alter table products add column if not exists donated boolean not null default false;

create table if not exists donations (
  id              bigint generated always as identity primary key,
  product_id      text not null references products (id) on delete cascade,
  donation_date   date not null,
  recipient       text not null,
  created_at      timestamptz not null default now()
);
create index if not exists donations_product_idx on donations (product_id);
alter table donations enable row level security;


set search_path to hdbs_prod, extensions;

alter table products add column if not exists donated boolean not null default false;

create table if not exists donations (
  id              bigint generated always as identity primary key,
  product_id      text not null references products (id) on delete cascade,
  donation_date   date not null,
  recipient       text not null,
  created_at      timestamptz not null default now()
);
create index if not exists donations_product_idx on donations (product_id);
alter table donations enable row level security;

notify pgrst, 'reload schema';
