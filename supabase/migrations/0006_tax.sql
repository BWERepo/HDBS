-- 0006_tax — tn_city_tax, tax_sweeps.
--
-- ⭐ NOT CREATED: `tn_sales_tax`. That table was deliberately dropped from production, and
-- regression_test.php:339 asserts it is gone ("tn_sales_tax table removed"). But all 53 lines of
-- api/tn_tax.php still query it and fail at line 17 with "Table tn_sales_tax does not exist" —
-- so that endpoint is dead, broken code and is NOT being ported. Only api/tn_city_tax.php is live.
-- See docs/schema-reconciliation.md finding 4.

-- ── tn_city_tax ──
-- Tennessee city/county sales-tax rates, ~52 rows. Read by api/fetch_tax.php when computing tax
-- on an order's shipping address.
create table tn_city_tax (
  id         bigint generated always as identity primary key,
  city       text not null,
  county     text not null,
  -- numeric(5,4): 0.0975 = 9.75%. The MySQL column carried the comment
  -- "Total rate e.g. 0.0975 = 9.75%". Must stay exact — this multiplies order totals.
  tax_rate   numeric(5,4) not null,
  updated_at timestamptz default now(),

  -- Reproduces MySQL's `UNIQUE KEY city_county (city, county)`. A city name is only unique within
  -- its county, and this is what makes the tax lookup deterministic.
  constraint tn_city_tax_city_county_key unique (city, county)
);

-- MySQL had ON UPDATE current_timestamp() on this column.
create trigger tn_city_tax_set_updated_at
  before update on tn_city_tax
  for each row execute function set_updated_at();

alter table tn_city_tax enable row level security;


-- ── tax_sweeps ──
-- Audit record of each sales-tax remittance period: which orders were included, and the total tax
-- collected. Orders are stamped with orders.tax_swept_date when swept, so a sweep is idempotent
-- and an order cannot be counted twice.
--
-- Empty in production (no INSERT block in the backup), so expect no data to migrate.
create table tax_sweeps (
  id          bigint generated always as identity primary key,
  sweep_date  date not null,
  period_from timestamptz not null,
  period_to   timestamptz not null,
  order_count integer not null default 0,
  total_tax   numeric(10,2) not null default 0,
  -- Both are denormalised snapshots kept as opaque text, exactly as the PHP wrote them: order_ids
  -- is a comma-separated list and order_details a JSON blob (added lazily by
  -- api/tax_sweep.php:99). They are a historical record of what was filed with the state, so they
  -- must NOT be recomputed from the live orders table later — that is the whole point of storing
  -- them. Do not normalise into a join table.
  order_ids     text,
  order_details text,
  created_at    timestamptz default now()
);

create index tax_sweeps_sweep_date_idx on tax_sweeps (sweep_date desc);

alter table tax_sweeps enable row level security;
