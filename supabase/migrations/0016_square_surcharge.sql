-- 0016_square_surcharge — a customer-facing card processing fee for Square (Credit Card) checkout,
-- mirroring the existing `paypal_surcharge` column that already does this for PayPal/Venmo.
--
-- Until now, Square/card customers never saw a fee added to their charge -- the business
-- absorbed Square's processing fee out of its own payout instead (see `transaction_fee`, which
-- records what Square actually kept from the payout and is unrelated to this column). This adds
-- a real, customer-facing surcharge to card payments too, computed from the same `square_fees`
-- admin setting (Settings -> Square Fees) the Receipt Report already assumes.
--
-- Both schemas covered in one file/one paste (both live in the shared DR Supabase project,
-- qrsydsglkgampabirejz) — run the whole file at once rather than two separate copy/pastes.

set search_path to hdbs_staging, extensions;

alter table orders add column if not exists square_surcharge numeric not null default 0;


set search_path to hdbs_prod, extensions;

alter table orders add column if not exists square_surcharge numeric not null default 0;

notify pgrst, 'reload schema';
