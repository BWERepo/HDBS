// Reproduces the security headers from the Hostinger .htaccess (lines 39-58) as Hono middleware.
//
// What did NOT need porting, and why:
//   - `Options -Indexes`            → Workers Static Assets does not do directory listing.
//   - `DirectoryIndex index.php`    → the catch-all shell route handles this.
//   - 301 /index.html → /           → kept, since old bookmarks and cached links still exist.
//   - Deny config.php/applog.php/secrets.php/.ftp-credentials/.env/*.log/*.txt → those files are
//     simply not in public/, so there is nothing to deny.
//
// One live-site quirk deliberately NOT carried over: the .htaccess `\.(log|txt)$` deny rule also
// matched robots.txt, so robots.txt was almost certainly returning 403 in production. Here it
// serves normally.

import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

const CSP = "upgrade-insecure-requests; frame-ancestors 'self'";
const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), usb=(), magnetometer=(), gyroscope=(), payment=(self)";

/** Matches the .htaccess FilesMatch that disabled caching for js/css/php/html. */
const NO_STORE = /\.(js|css|html)$/i;

export const securityHeaders = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  await next();

  // ⚠️ A Response returned from a binding fetch (env.ASSETS.fetch(), and R2 in later phases) has
  // IMMUTABLE headers in the Workers runtime. Calling .set() directly on c.res.headers threw an
  // unhandled TypeError for every real static asset (js/css/images) — every dynamic route built
  // its own Response and was unaffected, so the bug only showed up on real files, not on /api/*
  // or the rendered shell, and workerd's generic "Internal Server Error" body gave no clue why.
  // Caught by requesting an actual asset through a running Worker, not by a unit test — nothing
  // in this file's own logic was wrong, only its assumption about the Response it was mutating.
  // c.res = new Response(...) rebuilds the response with a fresh, mutable Headers object.
  c.res = new Response(c.res.body, c.res);

  const h = c.res.headers;
  h.set("Content-Security-Policy", CSP);
  h.set("X-Frame-Options", "SAMEORIGIN");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  h.set("Permissions-Policy", PERMISSIONS_POLICY);

  const path = new URL(c.req.url).pathname;
  const isDocument = path === "/" || !path.includes(".");
  if (isDocument || NO_STORE.test(path)) {
    h.set("Cache-Control", "no-store, no-cache, must-revalidate");
    h.set("Pragma", "no-cache");
    h.delete("Expires");
  }

  // Staging must never be indexed. On Hostinger this came from staging's own .htaccess, which
  // deploys were forbidden to overwrite (deploy.ps1:33) — a rule that no longer needs to exist.
  if (c.env.ENVIRONMENT === "staging") {
    h.set("X-Robots-Tag", "noindex, nofollow");
  }
});

/**
 * www → apex 301, done at the app layer rather than as a Cloudflare Redirect Rule, mirroring
 * BusinessWebExpress's redirectWwwToApex. Keeping it in the repo means one less piece of
 * behaviour living only in dashboard config.
 */
export const redirectWwwToApex = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const url = new URL(c.req.url);
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return c.redirect(url.toString(), 301);
  }
  await next();
});
