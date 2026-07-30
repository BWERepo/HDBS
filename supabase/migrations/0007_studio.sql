-- 0007_studio — the Design Studio feature: gallery items, customer inquiries, project notes.

-- ── studio_items ──
-- Content blocks for the Design Studio page, grouped by `section` and hand-ordered.
create table studio_items (
  id         bigint generated always as identity primary key,
  -- Which part of the page this block belongs to (varchar(12) in MySQL — short slugs).
  section    text not null,
  title      text not null default '',
  -- Opaque JSON payload whose shape varies by section. Kept as text, exactly as the PHP stored it.
  data       text,

  -- Image URL. api/studio.php:139 wrote ALLOWED_ORIGIN . '/studio_images/' . $filename . '?t=...',
  -- so like products.img1-3 these are absolute URLs — but unlike products, they were correctly
  -- environment-scoped rather than hardcoded to production. Migration 0009 normalises them to
  -- root-relative paths for the same reason.
  --
  -- Note: studio_images/ is EMPTY on the production server and the database contains zero
  -- references to it, so this feature's images were never actually used. Column kept regardless.
  image      text not null default '',

  sort_order integer default 0,

  -- The third and last boolean-shaped column in the database (was tinyint(4)). As with
  -- products.sell and products.coming_soon, the API layer must coerce this back to 1/0 in JSON
  -- responses so js/admin-studio.js sees what it sees today.
  active     boolean not null default true,

  created_at timestamptz default now()
);

create index studio_items_section_idx on studio_items (section, sort_order);

alter table studio_items enable row level security;


-- ── studio_inquiries ──
-- Custom-project enquiries submitted from the Design Studio page, then worked as a pipeline in the
-- back office. Empty in production.
create table studio_inquiries (
  id           bigint generated always as identity primary key,
  created_at   timestamptz default now(),
  name         text not null,
  -- citext for the same reason as customers.email — this is how a project is matched to a person.
  email        citext not null,
  phone        text not null default '',
  project_type text not null default '',
  budget       text not null default '',
  timeline     text not null default '',
  description  text,
  contact_pref text not null default '',
  inspiration  text,

  -- api/studio.php:48-50 widened this to varchar(20) lazily; it is the pipeline stage.
  status       text not null default 'inquiry',

  -- Client IP captured at submission for abuse tracing (varchar(45) — sized for IPv6).
  ip           text not null default '',

  -- Added lazily by api/studio.php:52-53.
  due_date     date
);

create index studio_inquiries_status_idx     on studio_inquiries (status);
create index studio_inquiries_created_at_idx on studio_inquiries (created_at desc);

alter table studio_inquiries enable row level security;


-- ── studio_project_notes ──
-- Internal running notes against an inquiry. Empty in production.
create table studio_project_notes (
  id         bigint generated always as identity primary key,
  -- MySQL had no foreign key here, but the relationship is real and notes are meaningless without
  -- their project — so the cascade is added deliberately. This is the one place the port
  -- STRENGTHENS the schema rather than reproducing it; without it, deleting an inquiry silently
  -- orphans its notes, which the data-integrity smoke check would then flag forever.
  project_id bigint not null references studio_inquiries (id) on delete cascade,
  note_text  text not null,
  created_at timestamptz default now()
);

create index studio_project_notes_project_id_idx on studio_project_notes (project_id);

alter table studio_project_notes enable row level security;
