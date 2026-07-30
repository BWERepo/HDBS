-- 0003_orders — orders, order_items, refunds, order_lookup_requests.
--
-- `orders` is the other table whose true shape only existed in the live database: it gains SEVEN
-- columns lazily across FIVE different files (api/orders.php:15-17, refund.php:22-23,
-- square_payments.php:19-20, paypal.php:96-100), with refunded_amount added redundantly in three
-- of them. All of it is declared up front here.

create table orders (
  -- App-generated ID, not a sequence. Referenced by order_items.order_id, refunds.order_id, and
  -- by the Square/PayPal payment records. Stays text.
  id                    text primary key,

  customer_name         text,
  -- citext: MySQL's case-insensitive collation made customer lookups by email work regardless of
  -- capitalisation. api/order_lookup.php matches on this column.
  customer_email        citext,
  customer_phone        text,
  shipping_address      text,

  shipping_carrier      text default 'USPS',
  -- Widened to varchar(500) in MySQL by api/orders.php:22-24 because multi-package orders store
  -- several comma-separated tracking numbers in this one column. Plain text here.
  tracking_number       text,

  confirm_sent_at       timestamptz,
  shipping_sent_at      timestamptz,

  -- ⚠️ numeric, never float. api/process_payment.php recomputes the order total server-side and
  -- compares it against what the client submitted; rounding drift becomes a payment mismatch.
  total                 numeric(10,2),
  tax_amount            numeric(10,2) default 0,
  transaction_fee       numeric(8,2) not null default 0,
  refunded_amount       numeric(10,2) default 0,
  paypal_surcharge      numeric(10,2) default 0,

  payment_method        text default 'Square',
  status                text default 'Awaiting Payment',
  square_payment_id     text,
  paypal_capture_id     text,

  -- order_type and payment_configuration both default to 'Online' and distinguish web orders from
  -- in-person/craft-fair sales entered by hand in the back office.
  order_type            text not null default 'Online',
  payment_configuration text default 'Online',
  check_number          text,

  -- Genuine dates, not timestamps — no timezone hazard on these.
  order_date            date,
  tax_swept_date        date,

  -- MySQL stored naive DATETIME in server-local time with no timezone awareness. Storing UTC and
  -- formatting at the edge is correct, but note that existing order timestamps will render
  -- differently in js/admin-orders.js unless the data migration converts them from
  -- America/New_York rather than assuming UTC. Spot-check a known order after migrating.
  created_at            timestamptz default now()
);

create index orders_customer_email_idx on orders (customer_email);
create index orders_status_idx          on orders (status);
create index orders_order_date_idx      on orders (order_date desc);
create index orders_tax_swept_date_idx  on orders (tax_swept_date) where tax_swept_date is null;

alter table orders enable row level security;


-- ── order_items ──
-- The ONLY foreign key in the entire database, and it cascades. Preserved exactly: deleting an
-- order currently removes its line items, and the back office relies on that.
--
-- Line items denormalise product_name and price at time of sale on purpose, so historical orders
-- keep their original values when a product is later renamed or repriced. product_id is
-- deliberately NOT a foreign key to products — products can be deleted while their orders remain.
create table order_items (
  id           bigint generated always as identity primary key,
  order_id     text not null references orders (id) on delete cascade,
  product_id   text,
  product_name text,
  price        numeric(10,2),
  quantity     integer
);

create index order_items_order_id_idx on order_items (order_id);

alter table order_items enable row level security;


-- ── refunds ──
-- One row per refund action; an order can be refunded multiple times partially, which is why
-- orders.refunded_amount is a running total rather than a boolean.
create table refunds (
  id               bigint generated always as identity primary key,
  order_id         text not null,
  amount           numeric(10,2) not null,
  reason           text not null,
  -- 'Square', 'PayPal', 'Check', 'Cash' — how the money actually went back.
  method           text not null,
  square_refund_id text,
  status           text not null default 'Completed',
  created_at       timestamptz not null default now()
);

create index refunds_order_id_idx on refunds (order_id);

alter table refunds enable row level security;


-- ── order_lookup_requests ──
-- ⚠️ THIS TABLE HAS NEVER EXISTED IN PRODUCTION. api/order_lookup.php:24 creates it lazily with
-- CREATE TABLE IF NOT EXISTS on first use, and it is absent from the live database — meaning the
-- guest "look up my order by email magic link" flow has never once run in production.
--
-- Created here anyway because it is three columns and costs nothing, so neither answer to
-- "is that feature wanted?" is blocked. If the feature is dropped, drop this table with it.
-- See docs/schema-reconciliation.md finding 3.
create table order_lookup_requests (
  email_hash text primary key,
  attempts   integer not null default 0,
  last_at    bigint  not null default 0
);

alter table order_lookup_requests enable row level security;
