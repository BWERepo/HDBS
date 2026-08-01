// Password hashing/verification with a transparent migration path off bcrypt.
//
// api/admin.php uses password_hash($x, PASSWORD_DEFAULT), which is bcrypt ($2y$ prefix) — for
// the admin password (admin.php:102,150) and the security-question answer (admin.php:167).
// api/customers.php uses the same for customer accounts, though verified separately
// (docs/schema-reconciliation.md): production has ZERO customer rows, so there is no customer
// data to migrate, only the admin credentials.
//
// bcrypt is not implemented by WebCrypto and there is no reason to keep issuing it from a Worker:
// bcryptjs's hash() is slow, CPU-bound JS, while PBKDF2 via crypto.subtle is native and fast. So
// verification supports BOTH formats by inspecting the stored prefix, but every NEW hash this
// module produces is PBKDF2 — bcrypt is a read-only legacy format from here on.
//
// The plan (docs/production-isolation.md's companion migration plan) calls this out as risk 5:
// "bcrypt not cheaply verifiable in Workers." The mitigation is verify-then-rehash: on a
// successful login with a bcrypt-stored hash, the caller (src/auth.ts) immediately re-hashes the
// same plaintext to PBKDF2 and persists it, so every active account migrates itself within one
// login cycle with no forced reset and no visible behaviour change.

import bcrypt from "bcryptjs";

const PBKDF2_PREFIX = "pbkdf2";
// OWASP's 2023 minimum recommendation for PBKDF2-HMAC-SHA256 is 210,000 — but the Workers
// runtime's WebCrypto throws NotSupportedError above 100,000 ("iteration counts above 100000 are
// not supported"). This only surfaces at request time in the real `workerd` runtime, not under
// Vitest (plain Node, no such cap) — caught by an actual `wrangler deploy` + curl login attempt,
// which 500'd with that exact error. 100,000 is the ceiling this platform allows.
export const PBKDF2_ITERATIONS = 100_000;
/** The Workers runtime's hard ceiling — see PBKDF2_ITERATIONS' comment. Exported so a test can
 *  guard against silently regressing past it (Vitest itself can't catch the real error, since it
 *  runs under Node, which has no such cap). */
export const WORKERS_PBKDF2_ITERATION_CEILING = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function toBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_BYTES * 8
  );
}

/** Hash a new password. Always produces the PBKDF2 format — never bcrypt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${PBKDF2_PREFIX}$${PBKDF2_ITERATIONS}$${toBase64(salt.buffer as ArrayBuffer)}$${toBase64(derived)}`;
}

export interface VerifyResult {
  valid: boolean;
  /** True when `valid` and the stored hash is the legacy bcrypt format — caller should rehash. */
  needsRehash: boolean;
}

/**
 * Verify a password against either a bcrypt hash ($2y$/$2a$/$2b$, from before the migration) or
 * this module's own PBKDF2 format. Never throws on a malformed/unrecognised hash — returns
 * { valid: false }, matching api/admin.php's behaviour of failing the login rather than crashing
 * on a corrupt settings row.
 */
export async function verifyPassword(password: string, stored: string): Promise<VerifyResult> {
  if (!stored) return { valid: false, needsRehash: false };

  if (/^\$2[aby]\$/.test(stored)) {
    try {
      const valid = await bcrypt.compare(password, stored);
      return { valid, needsRehash: valid };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  if (stored.startsWith(`${PBKDF2_PREFIX}$`)) {
    const parts = stored.split("$");
    if (parts.length !== 4) return { valid: false, needsRehash: false };
    const [, iterStr, saltB64, hashB64] = parts;
    const iterations = Number(iterStr);
    if (!Number.isFinite(iterations) || iterations <= 0) return { valid: false, needsRehash: false };
    try {
      const salt = fromBase64(saltB64!);
      const derived = await pbkdf2(password, salt, iterations);
      const valid = timingSafeEqualBytes(new Uint8Array(derived), fromBase64(hashB64!));
      return { valid, needsRehash: false };
    } catch {
      return { valid: false, needsRehash: false };
    }
  }

  return { valid: false, needsRehash: false };
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}
