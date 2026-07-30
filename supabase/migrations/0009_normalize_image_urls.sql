-- 0009_normalize_image_urls — rewrite absolute image URLs to root-relative paths.
--
-- Run AFTER the data migration has loaded rows, not against an empty schema. It is idempotent:
-- re-running it is a no-op because the pattern it matches no longer exists afterwards.
--
-- ── The problem ──
-- api/products.php:65 hardcodes https://handmadedesignsbysuzi.com/product_images/ and stores the
-- FULL ABSOLUTE URL in products.img1/img2/img3. Verified against the production backup: all 139
-- image references are absolute production URLs, and zero point anywhere else.
--
-- Two consequences, one of which is a live bug today:
--   1. Staging serves PRODUCTION's images, because staging rows contain production URLs. That is
--      the current behaviour on Hostinger.
--   2. After the migration, keeping absolute URLs would mean the staging Worker fetching media
--      from the production domain — a real request to the live site from every test.
--
-- ── The fix ──
-- Store root-relative paths and let each environment resolve them against itself. The browser is
-- unaffected: everything is same-origin now that the Worker serves both the page and the media
-- (GET /product_images/* proxies R2), whereas before the JS ran on one origin and the images came
-- from an absolute URL.
--
-- ⚠️ Before relying on this, grep `product_images` across js/ for any code doing string surgery on
-- the absolute URL (splitting on the domain, regex-matching https://, etc.). Rendering
-- <img src> from the column value directly is safe; parsing it is not.

update products
set img1 = replace(img1, 'https://handmadedesignsbysuzi.com/product_images/', '/product_images/')
where img1 like 'https://handmadedesignsbysuzi.com/product_images/%';

update products
set img2 = replace(img2, 'https://handmadedesignsbysuzi.com/product_images/', '/product_images/')
where img2 like 'https://handmadedesignsbysuzi.com/product_images/%';

update products
set img3 = replace(img3, 'https://handmadedesignsbysuzi.com/product_images/', '/product_images/')
where img3 like 'https://handmadedesignsbysuzi.com/product_images/%';

-- Also normalise the staging variant, in case any row was written while the admin was pointed at
-- staging (api/products.php uses a hardcoded production URL, but api/admin.php and api/studio.php
-- use ALLOWED_ORIGIN, which is environment-dependent — so mixed values are possible).
update products
set img1 = replace(img1, 'https://staging.handmadedesignsbysuzi.com/product_images/', '/product_images/'),
    img2 = replace(img2, 'https://staging.handmadedesignsbysuzi.com/product_images/', '/product_images/'),
    img3 = replace(img3, 'https://staging.handmadedesignsbysuzi.com/product_images/', '/product_images/')
where img1 like 'https://staging.%' or img2 like 'https://staging.%' or img3 like 'https://staging.%';

-- ── studio_items.image ──
-- Written by api/studio.php:139 as ALLOWED_ORIGIN . '/studio_images/' . $filename . '?t=' . time().
-- The ?t= cache-buster is stripped too: it was a workaround for the browser caching a replaced
-- image at a stable URL, and R2 objects are served immutable with a content-addressed key instead.
--
-- Production currently has zero studio image references, so this is forward-looking.
update studio_items
set image = regexp_replace(image, '^https?://[^/]+/studio_images/', '/studio_images/')
where image ~ '^https?://[^/]+/studio_images/';

update studio_items
set image = split_part(image, '?', 1)
where image like '%?t=%';

-- ── brand images in the settings blob ──
-- biz_profile is a JSON blob holding the logo, hero and about-picture URLs, written by
-- api/admin.php:233/261/287 using ALLOWED_ORIGIN. Rewritten as text rather than parsed as JSON,
-- so a malformed blob cannot fail the migration.
--
-- business_logo/ has one file in production; business_hero/ and business_about/ are empty and
-- unreferenced, so in practice only the logo is affected.
update settings
set value = regexp_replace(
      value,
      'https?://[^"/]*handmadedesignsbysuzi\.com/(business_logo|business_hero|business_about)/',
      '/\1/',
      'g'
    )
where key_name = 'biz_profile'
  and value ~ 'https?://[^"/]*handmadedesignsbysuzi\.com/(business_logo|business_hero|business_about)/';
