// JSON response helpers — the equivalent of api/config.php's ok()/fail() and its
// `header('Content-Type: application/json')` convention.
//
// The response SHAPE must stay byte-compatible with what the existing vanilla-JS front end
// expects: js/api.js and the admin modules read `data.error` on failure. Do not "improve" this
// into a richer envelope without changing those call sites.
//
// ⚠️ api/config.php's real functions are:
//   function ok($data = []) { echo json_encode(array_merge(['success'=>true], $data)); }
//   function fail($msg, $code = 400) { echo json_encode(['success'=>false,'error'=>$msg]); }
// Every one of the ~9,900 lines of front-end JS checks `d.success` before trusting a response —
// grep any of js/store.js, js/admin-orders.js, js/auth.js, js/ui.js and it's everywhere. This
// file's ok()/fail() previously omitted `success` entirely, which meant every ported route's
// response was silently untrusted by the front end even on a real 200 — caught only by loading
// the actual site in a browser (the product catalog stuck on loading-skeleton placeholders),
// not by any unit test, since nothing in this codebase asserts the HTTP-level envelope shape
// (the business-logic layer's own {ok, data} result type is a different, unrelated convention —
// don't confuse the two when reading a route file).

import type { Context } from "hono";

/** Matches api/config.php's fail(): success:false + { error: "..." } with a non-200 status. */
export function fail(c: Context, message: string, status = 400): Response {
  return c.json({ success: false, error: message }, status as never);
}

/** Matches api/config.php's ok(): success:true merged with the caller's data, exactly like PHP's
 *  array_merge(['success'=>true], $data) — a caller-supplied `success` key wins, same as PHP.
 *  `body` is optional because several call sites pass a possibly-undefined `result.data`, matching
 *  PHP's own `function ok($data = [])` default. */
export function ok<T extends object | undefined = undefined>(c: Context, body?: T): Response {
  return c.json(Object.assign({ success: true }, body) as never);
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
