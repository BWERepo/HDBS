-- 0008_business — capital_equipment.
--
-- ⭐ NOT CREATED: any table for api/business_docs.php. That endpoint writes uploaded documents to
-- ../business_documents/ (api/business_docs.php:12) and appears to be filesystem-only, with no
-- database metadata at all — there is no such table in production. Confirm the intended behaviour
-- before building the private-R2 route for it, since without a metadata table the only record of a
-- document is its filename. See docs/schema-reconciliation.md finding 9.

-- ── capital_equipment ──
-- Business equipment purchases with scanned receipts — a tax/accounting record, admin-only.
--
-- ⚠️ The receipts are the most sensitive files in the system and the hardest to replace. They are
-- written to ../capital_equipment_receipts/ (api/capital_equipment.php:27), i.e. ABOVE the
-- webroot, so they are unreachable over HTTP and served only through the admin-gated endpoint.
-- That is a real security boundary and it is reproduced by the separate hdbs-private R2 bucket,
-- which gets no public URL and is read only after requireAdmin().
--
-- 13 rows exist in production with real .pdf/.jpg filenames, but FTP could not reach the directory
-- (the account is chrooted to public_html and refuses ../), so those files are NOT yet in
-- media-mirror/. They must be pulled by hand via hPanel File Manager before cutover.
create table capital_equipment (
  id                bigint generated always as identity primary key,
  description       text not null,
  purchase_date     date not null,
  purchase_price    numeric(10,2) not null,

  -- Stored filename (server-generated, collision-free) and the original upload name shown in the
  -- UI. Both nullable: an equipment row can be recorded without a receipt attached.
  receipt_filename  text,
  receipt_orig_name text,

  created_at        timestamptz default now()
);

create index capital_equipment_purchase_date_idx on capital_equipment (purchase_date desc);

alter table capital_equipment enable row level security;
