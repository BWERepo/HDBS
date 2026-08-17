// Public media proxy: GET /product_images/*, /business_logo/*, /business_hero/*,
// /business_about/*, /studio_images/* → env.R2_PUBLIC.
//
// Per the migration plan, hdbs-public is Worker-proxied, NOT a public bucket — this route IS that
// proxy. The R2 object key is the URL path with the leading slash stripped
// (`product_images/foo.jpg`), matching what migration 0009 actually rewrote products.img1-3 and
// studio_items.image to, and what scripts/migrate-data.mjs's sibling upload step used as the R2
// key when populating the bucket from media-mirror/. `business_hero/` and `business_about/` are
// empty in production (zero references, per PROJECT_STATUS.md) but routed anyway since they cost
// nothing and the settings-blob rewrite in 0009 already accounts for them.
//
// Must be mounted BEFORE the SPA catch-all in src/index.ts: these paths have a file extension, so
// the catch-all's wantsShell() correctly skips them and falls through to env.ASSETS.fetch() —
// but ASSETS only serves the bundled public/ directory, not R2, so without this route a request
// for a real product image would 404 against ASSETS and then render the HTML shell instead of an
// image.

import { Hono } from "hono";
import type { Env } from "../types";

export const mediaRoute = new Hono<{ Bindings: Env }>();

const PUBLIC_MEDIA_PREFIXES = ["/product_images", "/business_logo", "/business_hero", "/business_about", "/studio_images", "/coupon_templates"];

for (const prefix of PUBLIC_MEDIA_PREFIXES) {
  mediaRoute.get(`${prefix}/*`, async (c) => {
    const key = new URL(c.req.url).pathname.slice(1); // strip leading "/"
    const object = await c.env.R2_PUBLIC.get(key);
    if (!object) return c.text("Not found", 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    if (!headers.has("cache-control")) {
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }
    return new Response(object.body, { headers });
  });
}
