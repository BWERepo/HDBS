// Signed, self-expiring token proving the holder controls a given email, with no session table
// (stateless). Ports api/order_token.php's makeOrderToken/verifyOrderToken, used by customer
// login/register (issuing the account order-view token) and, later, the guest order-lookup magic
// link (api/order_lookup.php).
//
// Per the migration plan's Auth section: DB_PASS-keyed HMAC replaced with ORDER_TOKEN_SECRET, and
// NOT truncated to 32 hex chars like the original (full 64-char HMAC-SHA256 output) — free to fix
// since the secret change already invalidates every outstanding token regardless of length. Wire
// format otherwise unchanged: base64url(email|expiry).sig.

import { timingSafeEqual } from "./http";

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return atob(padded);
}

/** Builds a token for `email`, valid for `ttlSeconds` from `now`. */
export async function makeOrderToken(
  email: string,
  ttlSeconds: number,
  secret: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const normalized = email.toLowerCase().trim();
  const expiry = now + ttlSeconds;
  const payload = base64UrlEncode(`${normalized}|${expiry}`);
  const sig = await hmacHex(secret, payload);
  return `${payload}.${sig}`;
}

/** Returns the lowercase email if the token's signature is valid and unexpired; else null. */
export async function verifyOrderToken(token: string, secret: string, now: number = Math.floor(Date.now() / 1000)): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmacHex(secret, payload);
  if (!timingSafeEqual(expected, sig)) return null;

  let raw: string;
  try {
    raw = base64UrlDecode(payload);
  } catch {
    return null;
  }
  const sep = raw.indexOf("|");
  if (sep === -1) return null;
  const email = raw.slice(0, sep);
  const expiry = Number(raw.slice(sep + 1));
  if (!Number.isFinite(expiry) || expiry < now) return null;
  return email.toLowerCase().trim();
}
