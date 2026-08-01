// Ports api/config.php's cors(): allow the app's own origin, the standard method/header set, and
// short-circuit OPTIONS preflights with a bare 200 (no body).
//
// This is far less load-bearing than it was on Hostinger. There, storefront and admin JS called
// an absolute cross-origin URL (https://handmadedesignsbysuzi.com/api/...), so real preflighted
// cross-origin requests happened on every page load and ALLOWED_ORIGIN was doing real work. Once
// js/api.js's base URL becomes same-origin `/api/` (Phase 2), the browser never sends a CORS
// preflight for the app's own calls at all — this middleware now exists to keep the door shut to
// every OTHER origin, not to open it for this one.
//
// Deliberately does NOT set Content-Type here, unlike the PHP: Hono's c.json() already sets
// application/json on every route that calls it, and setting it unconditionally in middleware
// would be wrong for any future non-JSON /api response (e.g. a file download).

import { createMiddleware } from "hono/factory";
import type { Env } from "../types";

const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization, X-Admin-Token";

/** The app's own origin for the current environment — same values api/config.php's ALLOWED_ORIGIN used. */
export function allowedOrigin(env: Env): string {
  return env.ENVIRONMENT === "staging"
    ? "https://staging.handmadedesignsbysuzi.com"
    : "https://handmadedesignsbysuzi.com";
}

/** CORS headers + OPTIONS short-circuit for the /api/* route group. */
export const cors = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const origin = allowedOrigin(c.env);
  const setCorsHeaders = (headers: Headers) => {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
    headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  };

  if (c.req.method === "OPTIONS") {
    const res = new Response(null, { status: 200 });
    setCorsHeaders(res.headers);
    return res;
  }

  await next();

  // Same immutable-headers trap security-headers.ts hit: a Response from a binding fetch (or one
  // built upstream with headers already frozen) can't be .set() on directly.
  c.res = new Response(c.res.body, c.res);
  setCorsHeaders(c.res.headers);
});
