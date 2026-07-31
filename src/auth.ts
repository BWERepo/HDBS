// Admin authentication: login, logout, password change, the security-question reset flow, and
// session-token validation.
//
// Ports api/admin.php's login/logout/change_password/get_sec_question/verify_sec_answer/
// reset_password/save_sec_question actions, and api/config.php's validAdminToken()/requireAdmin().
//
// ── Why a store interface instead of importing src/db.ts directly ──
// The Supabase projects do not exist yet (see PROJECT_STATUS.md), so this file is written and
// fully unit-tested against an in-memory AdminAuthStore. The same pattern src/shell.ts used for
// biz_profile: business logic takes a small storage interface as a parameter, so it is testable
// today and becomes real the moment db.ts exists — wiring it up is then a one-line adapter, not a
// rewrite. AdminAuthStoreFake below IS that adapter's test double, and doubles as executable
// documentation of the interface a real Supabase-backed store must satisfy.
//
// ── What changed on purpose, vs a literal port ──
// 1. DROPPED: the legacy settings-table token fallback (api/config.php:52-58, admin.php:76-77,
//    87-88, 153-154). It existed for backward compatibility with a pre-admin_sessions deploy.
//    Carrying a second, weaker auth path forward forever has no value once every session is new
//    anyway. Consequence, called out in the migration plan: the admin must log in again after
//    cutover.
// 2. Passwords and the security answer verify against EITHER bcrypt (the existing stored format)
//    or this codebase's own PBKDF2 format (src/lib/password.ts), and a successful bcrypt
//    verification triggers an immediate, invisible rehash to PBKDF2. See password.ts's header for
//    why bcrypt is read-only from here on.
// 3. A legacy PLAINTEXT security answer (from before admin.php:167 started hashing it) still
//    verifies by direct comparison, exactly as admin.php:130-133 did — but unlike the PHP, a
//    successful plaintext match now ALSO triggers a rehash, so that legacy case self-heals too
//    rather than remaining plaintext forever.

import { hashPassword, verifyPassword } from "./lib/password";

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 900; // 15 minutes — shared between login and the security-answer flow.
const SESSION_TTL_SECONDS = 8 * 3600;

export interface AdminSession {
  token: string;
  expires: number; // epoch seconds, matching admin_sessions.expires and js/auth.js's comparisons.
}

/**
 * Storage the auth logic needs. A real implementation is a thin wrapper over Supabase; see
 * AdminAuthStoreFake for the in-memory test double this file's own tests run against.
 */
export interface AdminAuthStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  findSession(token: string): Promise<AdminSession | null>;
  insertSession(session: AdminSession): Promise<void>;
  deleteSession(token: string): Promise<void>;
  /** Deletes every session except the given token — used after a password change. */
  deleteSessionsExcept(token: string): Promise<void>;
  /** Deletes every session — used after a security-question password reset. */
  deleteAllSessions(): Promise<void>;
  /** Deletes sessions whose expiry is before `now`. The PHP never did this; ports the cleanup cron does instead. */
  deleteExpiredSessions(now: number): Promise<void>;
}

export interface AuthResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  /** HTTP status the caller should respond with on failure. Defaults to 400, as fail() in PHP did. */
  status?: number;
  data?: T;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32)); // bin2hex(random_bytes(32)) -> 64 hex chars.
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function nowSeconds(now: number): number {
  return Math.floor(now / 1000);
}

/** Shared 5-attempt/15-minute lockout, used by both login and the security-answer check. */
async function checkLockout<T = Record<string, never>>(
  store: AdminAuthStore,
  keyPrefix: "login" | "sec",
  now: number
): Promise<AuthResult<T> | null> {
  const nowSec = nowSeconds(now);
  let fails = Number(await store.getSetting(`${keyPrefix}_fail_count`)) || 0;
  const failTime = Number(await store.getSetting(`${keyPrefix}_fail_time`)) || 0;

  if (fails >= LOGIN_MAX_ATTEMPTS && nowSec - failTime >= LOGIN_LOCKOUT_SECONDS) {
    fails = 0;
    await store.setSetting(`${keyPrefix}_fail_count`, "0");
  }

  if (fails >= LOGIN_MAX_ATTEMPTS) {
    const mins = Math.ceil((LOGIN_LOCKOUT_SECONDS - (nowSec - failTime)) / 60);
    return { ok: false, error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }
  return null;
}

async function recordFailure<T = Record<string, never>>(
  store: AdminAuthStore,
  keyPrefix: "login" | "sec",
  now: number,
  lockedMessage: string,
  attemptMessage: (left: number) => string
): Promise<AuthResult<T>> {
  const fails = (Number(await store.getSetting(`${keyPrefix}_fail_count`)) || 0) + 1;
  await store.setSetting(`${keyPrefix}_fail_count`, String(fails));
  await store.setSetting(`${keyPrefix}_fail_time`, String(nowSeconds(now)));
  const left = LOGIN_MAX_ATTEMPTS - fails;
  return { ok: false, error: left > 0 ? attemptMessage(left) : lockedMessage };
}

async function clearFailures(store: AdminAuthStore, keyPrefix: "login" | "sec"): Promise<void> {
  await store.setSetting(`${keyPrefix}_fail_count`, "0");
  await store.setSetting(`${keyPrefix}_fail_time`, "0");
}

/** Ports api/admin.php's `action=login`. */
export async function login(
  store: AdminAuthStore,
  password: string,
  now: number = Date.now()
): Promise<AuthResult<{ token: string }>> {
  const locked = await checkLockout<{ token: string }>(store, "login", now);
  if (locked) return locked;

  const hash = await store.getSetting("admin_password");
  if (!hash) {
    return { ok: false, error: "Admin password not configured. Please set a password via the settings.", status: 500 };
  }

  const result = await verifyPassword(password, hash);
  if (!result.valid) {
    return recordFailure<{ token: string }>(
      store,
      "login",
      now,
      "Too many failed attempts. Account locked for 15 minutes.",
      (left) => `Incorrect password. ${left} attempt${left === 1 ? "" : "s"} remaining.`
    );
  }

  await clearFailures(store, "login");
  // Transparent bcrypt -> PBKDF2 migration: rehash on the very first successful login after cutover.
  if (result.needsRehash) await store.setSetting("admin_password", await hashPassword(password));

  const nowSec = nowSeconds(now);
  const token = randomToken();
  await store.deleteExpiredSessions(nowSec);
  await store.insertSession({ token, expires: nowSec + SESSION_TTL_SECONDS });

  return { ok: true, data: { token } };
}

/** Ports api/admin.php's `action=logout`. Caller must have already authenticated `token`. */
export async function logout(store: AdminAuthStore, token: string): Promise<AuthResult> {
  await store.deleteSession(token);
  return { ok: true };
}

/**
 * Ports api/admin.php's `action=change_password`. Caller must have already authenticated
 * `currentToken`; this only performs the password-change business logic.
 */
export async function changePassword(
  store: AdminAuthStore,
  currentToken: string,
  current: string,
  next: string,
  confirm: string
): Promise<AuthResult> {
  const hash = await store.getSetting("admin_password");
  if (!hash) return { ok: false, error: "Current password incorrect" };
  const verified = await verifyPassword(current, hash);
  if (!verified.valid) return { ok: false, error: "Current password incorrect" };

  if (!next) return { ok: false, error: "New password cannot be empty" };
  if (next !== confirm) return { ok: false, error: "Passwords do not match" };

  await store.setSetting("admin_password", await hashPassword(next));
  // A stolen token must not survive a password change.
  await store.deleteSessionsExcept(currentToken);
  return { ok: true };
}

/** Ports api/admin.php's `action=get_sec_question`. */
export async function getSecurityQuestion(store: AdminAuthStore): Promise<AuthResult<{ question: string }>> {
  const q = await store.getSetting("admin_sec_question");
  if (!q) return { ok: false, error: "No security question set" };
  return { ok: true, data: { question: q } };
}

/**
 * Verifies a security answer against a stored value that may be bcrypt, this module's PBKDF2
 * format, or legacy plaintext (matching api/admin.php:130-133's tolerance for pre-hashing data).
 * A successful plaintext match also requests a rehash — the one place this port does more than
 * the PHP did, since there is no reason to leave a verified-correct answer sitting in plaintext.
 */
async function verifySecurityAnswerHash(
  stored: string | null,
  answer: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!stored) return { valid: false, needsRehash: false };
  if (/^\$2[aby]\$/.test(stored) || stored.startsWith("pbkdf2$")) {
    return verifyPassword(answer, stored);
  }
  const valid = answer === stored;
  return { valid, needsRehash: valid };
}

/** Ports api/admin.php's `action=verify_sec_answer` and `action=reset_password`. */
export async function verifySecurityAnswer(
  store: AdminAuthStore,
  answer: string,
  now: number = Date.now()
): Promise<AuthResult> {
  const locked = await checkLockout(store, "sec", now);
  if (locked) return locked;

  const normalised = answer.toLowerCase().trim();
  const stored = await store.getSetting("admin_sec_answer");
  const result = await verifySecurityAnswerHash(stored, normalised);

  if (!result.valid) {
    return recordFailure(
      store,
      "sec",
      now,
      "Too many failed attempts. Try again in 15 minutes.",
      (left) => `Incorrect answer. ${left} attempt${left === 1 ? "" : "s"} remaining.`
    );
  }

  await clearFailures(store, "sec");
  if (result.needsRehash) await store.setSetting("admin_sec_answer", await hashPassword(normalised));
  return { ok: true };
}

/**
 * Ports the `reset_password` half of api/admin.php's combined verify_sec_answer/reset_password
 * action. Callers should invoke verifySecurityAnswer first and only call this on success — split
 * here because the PHP's combined action reused the same lockout state for both, and this keeps
 * that shared state in one function (verifySecurityAnswer) rather than duplicating it.
 */
export async function resetPasswordViaSecurityAnswer(
  store: AdminAuthStore,
  newPassword: string
): Promise<AuthResult> {
  if (!newPassword) return { ok: false, error: "Password cannot be empty" };
  await store.setSetting("admin_password", await hashPassword(newPassword));
  // Every existing session must die: the whole point of this flow is recovering from a
  // forgotten/compromised password, so nothing should still be logged in with the old one.
  await store.deleteAllSessions();
  return { ok: true };
}

/** Ports api/admin.php's `action=save_sec_question`. */
export async function saveSecurityQuestion(
  store: AdminAuthStore,
  question: string,
  answer: string,
  answer2: string
): Promise<AuthResult> {
  if (!question) return { ok: false, error: "Question required" };
  const a = answer.toLowerCase().trim();
  const a2 = answer2.toLowerCase().trim();
  if (!a) return { ok: false, error: "Answer required" };
  if (a !== a2) return { ok: false, error: "Answers do not match" };

  await store.setSetting("admin_sec_question", question);
  await store.setSetting("admin_sec_answer", await hashPassword(a));
  return { ok: true };
}

/**
 * Ports api/config.php's validAdminToken()/requireAdmin(), minus the dropped legacy fallback.
 * A missing or expired session returns false; the caller (a Hono middleware, wired in a later
 * phase once real routes exist) is responsible for turning that into a 401 response shaped like
 * fail() in src/lib/http.ts.
 */
export async function isValidAdminToken(
  store: AdminAuthStore,
  token: string | null | undefined,
  now: number = Date.now()
): Promise<boolean> {
  if (!token) return false;
  const session = await store.findSession(token);
  if (!session) return false;
  return session.expires >= nowSeconds(now);
}

// ── In-memory test double ──
// Not exported for production use — it exists so this file's tests, and any future route test,
// can exercise the exact interface a real Supabase-backed store must implement, without a
// database. See the header comment for why the functions above take a store rather than reaching
// for a global client.
export class AdminAuthStoreFake implements AdminAuthStore {
  settings = new Map<string, string>();
  sessions = new Map<string, AdminSession>();

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null;
  }
  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }
  async findSession(token: string): Promise<AdminSession | null> {
    return this.sessions.get(token) ?? null;
  }
  async insertSession(session: AdminSession): Promise<void> {
    this.sessions.set(session.token, session);
  }
  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }
  async deleteSessionsExcept(token: string): Promise<void> {
    for (const t of [...this.sessions.keys()]) if (t !== token) this.sessions.delete(t);
  }
  async deleteAllSessions(): Promise<void> {
    this.sessions.clear();
  }
  async deleteExpiredSessions(now: number): Promise<void> {
    for (const [t, s] of this.sessions) if (s.expires < now) this.sessions.delete(t);
  }
}
