// JSON response helpers — the equivalent of api/config.php's fail() and its
// `header('Content-Type: application/json')` convention.
//
// The response SHAPE must stay byte-compatible with what the existing vanilla-JS front end
// expects: js/api.js and the admin modules read `data.error` on failure. Do not "improve" this
// into a richer envelope without changing those call sites.

import type { Context } from "hono";

/** Matches api/config.php's fail(): { error: "..." } with a non-200 status. */
export function fail(c: Context, message: string, status = 400): Response {
  return c.json({ error: message }, status as never);
}

export function ok<T>(c: Context, body: T): Response {
  return c.json(body as never);
}

/**
 * Constant-time string compare — the WebCrypto-era replacement for PHP's hash_equals().
 *
 * Required for the smoke-suite token and every HMAC signature check. Length is compared
 * non-secretly first (a length mismatch is already observable from the failure itself).
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
