-- 0013_coupons_percent_only — coupons are percent-off only going forward.
--
-- Product decision: dollar-amount coupons are dropped. Since a percent-off discount can never
-- exceed the order subtotal, there's never leftover to credit to a customer's store-credit
-- account from a coupon redemption anymore — the crediting side of store credit
-- (credit_store_account) has no caller left in the app (see src/store-credit.ts). The debit/spend
-- side (debit_store_credit_if_available, customers.store_credit_balance) is untouched — store
-- credit remains spendable at checkout independent of coupons, and existing balances stay valid.
--
-- Any pre-existing 'dollar' rows must be dealt with before this constraint can apply — there are
-- none in production/staging as of this migration (coupons is a brand-new feature, no dollar
-- coupons were ever created), but the update guards against it anyway rather than assuming.
--
-- Both schemas covered in one file/one paste (both live in the shared DR Supabase project,
-- qrsydsglkgampabirejz) — run the whole file at once rather than two separate copy/pastes.

set search_path to hdbs_staging;

update coupons set coupon_type = 'percent' where coupon_type = 'dollar';

alter table coupons drop constraint coupons_coupon_type_check;
alter table coupons add constraint coupons_coupon_type_check check (coupon_type in ('percent'));


set search_path to hdbs_prod;

update coupons set coupon_type = 'percent' where coupon_type = 'dollar';

alter table coupons drop constraint coupons_coupon_type_check;
alter table coupons add constraint coupons_coupon_type_check check (coupon_type in ('percent'));
