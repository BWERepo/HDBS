-- 0005_content — reviews, faqs, email_log.

-- ── reviews ──
-- Customer reviews, moderated in the back office before appearing on the storefront.
create table reviews (
  id            bigint generated always as identity primary key,
  customer_name text not null,
  product_name  text,
  rating        integer default 5,
  review_text   text not null,

  -- MySQL had enum('pending','approved'). Modelled as text + CHECK rather than a Postgres enum
  -- type: a CHECK is trivial to widen later (adding 'rejected' is one ALTER), whereas altering a
  -- Postgres enum is awkward and cannot be done inside a transaction in older versions. The
  -- important part is that the constraint survives — a bare text column would silently accept
  -- anything and let an unmoderated review render as approved.
  status        text default 'pending',
  created_at    timestamptz default now(),

  constraint reviews_status_check check (status in ('pending', 'approved')),
  constraint reviews_rating_check check (rating between 1 and 5)
);

create index reviews_status_idx on reviews (status);

alter table reviews enable row level security;


-- ── faqs ──
-- DB-driven FAQ page, ordered by sort_order in the admin.
create table faqs (
  id         bigint generated always as identity primary key,
  question   text not null,
  answer     text not null,
  sort_order integer default 0,
  created_at timestamptz default now()
);

create index faqs_sort_order_idx on faqs (sort_order);

alter table faqs enable row level security;


-- ── email_log ──
-- Every transactional email, with the full rendered HTML body retained so the back office can show
-- exactly what a customer received.
--
-- This table becomes more important after the migration, not less: staging runs with
-- EMAIL_MODE=sink, which renders the complete email and writes it here with status='sink' WITHOUT
-- calling Resend. That replaces the old "staging has a blank SMTP password" trick — a
-- fail-by-accident mechanism — with an explicit one that also makes email templates genuinely
-- reviewable on staging.
create table email_log (
  id         bigint generated always as identity primary key,
  sent_at    timestamptz not null default now(),
  -- 'order_confirm', 'shipping', 'contact', 'generic', 'studio_project', ...
  email_type text not null,
  sent_to    citext not null,
  -- Not a foreign key: emails are also sent for things that aren't orders (contact form,
  -- studio inquiries), in which case the PHP wrote an empty string rather than null.
  order_id   text not null default '',
  subject    text,
  -- 'sent' | 'failed' | 'sink'
  status     text default 'sent',
  error_msg  text,
  email_body text
);

create index email_log_sent_at_idx  on email_log (sent_at desc);
create index email_log_order_id_idx on email_log (order_id) where order_id <> '';

alter table email_log enable row level security;
