// Newsletter subscribers: ports api/subscribers.php's GET (admin list)/POST (public
// subscribe)/DELETE (admin unsubscribe). Same store-interface + fake pattern as the rest.
//
// The per-IP rate limit (5 subscribe attempts / 15 minutes) reuses the exact lockout shape
// src/auth.ts already established for login — same threshold/window semantics, different store
// (rate_limits, not settings-based fail counters), since that's what the PHP itself used
// (api/subscribers.php's own rate_limits table, distinct from admin login's settings-row
// counters).

export interface SubscriberRow {
  email: string;
  /** Pre-formatted like PHP's DATE_FORMAT(subscribed_at, '%m/%d/%Y') — the route/adapter layer
   *  formats it; this module only shapes what the API returns. */
  date: string;
}

export interface SubscribersResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_WINDOW_SECONDS = 900; // 15 minutes

export interface SubscribersStore {
  listSubscribers(): Promise<SubscriberRow[]>;
  findSubscriber(email: string): Promise<{ source: string | null } | null>;
  insertSubscriber(email: string, source: string | null): Promise<void>;
  updateSubscriberSourceIfEmpty(email: string, source: string): Promise<void>;
  deleteSubscriber(email: string): Promise<void>;

  getRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null>;
  setRateLimit(key: string, attempts: number, lastAt: number): Promise<void>;
}

function isValidEmail(email: string): boolean {
  // Matches PHP's FILTER_VALIDATE_EMAIL closely enough for this form: one "@", a dot in the
  // domain part, no whitespace. Not RFC 5322-exhaustive — neither is FILTER_VALIDATE_EMAIL.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Ports api/subscribers.php's per-IP rate limit, keyed by md5('sub_' + ip) in the PHP — the
 *  caller passes the already-hashed key so this module doesn't need to know about md5/IPs. */
async function checkAndRecordRateLimit(
  store: SubscribersStore,
  key: string,
  now: number
): Promise<SubscribersResult | null> {
  const row = (await store.getRateLimit(key)) ?? { attempts: 0, lastAt: 0 };

  if (row.attempts >= RATE_LIMIT_MAX_ATTEMPTS && now - row.lastAt < RATE_LIMIT_WINDOW_SECONDS) {
    const mins = Math.ceil((RATE_LIMIT_WINDOW_SECONDS - (now - row.lastAt)) / 60);
    return { ok: false, error: `Too many requests. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, status: 429 };
  }

  const attempts = row.attempts >= RATE_LIMIT_MAX_ATTEMPTS ? 1 : row.attempts + 1;
  await store.setRateLimit(key, attempts, now);
  return null;
}

/** Ports api/subscribers.php's GET action. Caller must have already required admin. */
export async function listSubscribers(store: SubscribersStore): Promise<SubscribersResult<{ subscribers: SubscriberRow[] }>> {
  return { ok: true, data: { subscribers: await store.listSubscribers() } };
}

/** Ports api/subscribers.php's POST action. `rateLimitKey` is the caller's hashed IP key. */
export async function subscribe(
  store: SubscribersStore,
  rateLimitKey: string,
  email: string,
  source: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<SubscribersResult> {
  const limited = await checkAndRecordRateLimit(store, rateLimitKey, now);
  if (limited) return limited;

  const em = email.trim();
  if (!em || !isValidEmail(em)) return { ok: false, error: "Invalid email address" };
  const src = source.trim();

  const existing = await store.findSubscriber(em);
  if (existing) {
    if (src !== "") await store.updateSubscriberSourceIfEmpty(em, src);
    return { ok: false, error: "Already subscribed" };
  }

  await store.insertSubscriber(em, src !== "" ? src : null);
  return { ok: true };
}

/** Ports api/subscribers.php's DELETE action. Caller must have already required admin. */
export async function unsubscribe(store: SubscribersStore, email: string): Promise<SubscribersResult> {
  if (!email) return { ok: false, error: "Email required" };
  await store.deleteSubscriber(email);
  return { ok: true };
}

// ── In-memory test double ──
export class SubscribersStoreFake implements SubscribersStore {
  subscribers = new Map<string, { source: string | null; subscribedAt: number }>();
  rateLimits = new Map<string, { attempts: number; lastAt: number }>();

  async listSubscribers(): Promise<SubscriberRow[]> {
    return [...this.subscribers.entries()]
      .sort((a, b) => b[1].subscribedAt - a[1].subscribedAt)
      .map(([email, v]) => ({ email, date: new Date(v.subscribedAt * 1000).toISOString().slice(0, 10) }));
  }
  async findSubscriber(email: string): Promise<{ source: string | null } | null> {
    const row = this.subscribers.get(email);
    return row ? { source: row.source } : null;
  }
  async insertSubscriber(email: string, source: string | null): Promise<void> {
    this.subscribers.set(email, { source, subscribedAt: Math.floor(Date.now() / 1000) });
  }
  async updateSubscriberSourceIfEmpty(email: string, source: string): Promise<void> {
    const row = this.subscribers.get(email);
    if (row && !row.source) row.source = source;
  }
  async deleteSubscriber(email: string): Promise<void> {
    this.subscribers.delete(email);
  }

  async getRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null> {
    return this.rateLimits.get(key) ?? null;
  }
  async setRateLimit(key: string, attempts: number, lastAt: number): Promise<void> {
    this.rateLimits.set(key, { attempts, lastAt });
  }
}
