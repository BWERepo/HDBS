-- 0002_catalog — products.
--
-- ⭐ This table is the whole reason the schema had to be recovered from the live database rather
-- than read out of the source. api/config.php:241 defines ensureProductColumns(), which ran
-- SHOW COLUMNS + ALTER TABLE ADD COLUMN on EVERY relevant request for five columns
-- (ship_mode, ship_fixed, coming_soon, cogm, launch_date). All five are declared up front here,
-- and every ensureProductColumns() call site is deleted rather than ported.

create table products (
  -- App-generated ID (PHP builds "p" + a millisecond timestamp), not a sequence. Stays text —
  -- do NOT convert to an identity column; the values are referenced by order_items.product_id
  -- and embedded in the product image filenames on disk.
  id          text primary key,

  sku         text default '',
  name        text not null,
  description text,
  price       numeric(10,2) not null default 0,
  stock       integer not null default 0,
  category    text,
  badge       text,

  -- Product image URLs, up to three. These were mediumtext in MySQL because they hold FULL
  -- ABSOLUTE URLs — api/products.php:65 hardcodes https://handmadedesignsbysuzi.com/product_images/
  -- and stores the whole thing. Migration 0009 rewrites them to root-relative paths so each
  -- environment resolves against itself instead of staging serving production's images.
  img1        text,
  img2        text,
  img3        text,

  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),

  weight      numeric(6,2) default 0,
  size        text default '',

  -- ── Booleans ──
  -- MySQL had `sell` as tinyint(1) and `coming_soon` as tinyint(4). Both are genuinely boolean.
  -- These are two of only THREE boolean-shaped columns in the entire database (the third is
  -- studio_items.active), so the blast radius here is small and known.
  --
  -- ⚠️ The API layer MUST coerce these back to 1/0 in JSON responses. PostgREST/supabase-js will
  -- emit true/false, and ~9,900 lines of vanilla JS (js/store.js, js/admin-products.js) compare
  -- these loosely against 1. Coercing in one place in the response layer is reversible and
  -- requires zero JS changes; changing the JS is neither.
  sell        boolean not null default true,
  coming_soon boolean not null default false,

  -- ship_mode is 'weight' or 'fixed'; ship_fixed is the flat rate when fixed.
  ship_mode   text not null default 'weight',
  ship_fixed  numeric(10,2) not null default 0,

  -- Cost of goods manufactured — admin-only margin reporting, never exposed to the storefront.
  cogm        numeric(10,2) not null default 0,

  -- MySQL had `launch_date date NOT NULL DEFAULT '2026-07-01'` — a hardcoded literal that was
  -- presumably "today" when the column was added. current_date is the sane equivalent; nothing
  -- reads the default for existing rows.
  launch_date date not null default current_date,

  constraint products_ship_mode_check check (ship_mode in ('weight', 'fixed'))
);

-- Reproduces MySQL's `ON UPDATE current_timestamp()` on updated_at, which has no column-level
-- equivalent in Postgres.
create trigger products_set_updated_at
  before update on products
  for each row execute function set_updated_at();

-- The storefront filters by category and sorts/filters on the sell + coming_soon flags.
create index products_category_idx on products (category);
create index products_sell_idx     on products (sell) where sell;

alter table products enable row level security;
