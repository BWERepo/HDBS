// Settings get/set: ports api/admin.php's `get_setting` and `set_setting`/`save_setting` actions.
//
// Written against a small store interface, exactly like src/auth.ts — Supabase doesn't exist yet
// (see PROJECT_STATUS.md), so this is fully unit-tested against an in-memory fake and becomes real
// the moment src/db.ts exists.
//
// ── Scope of this port ──
// Covers the key-gating, sensitive-key blocking, and auto-generation/default behaviour of
// get_setting/set_setting verbatim. Deliberately DEFERRED to a later, R2-dependent pass:
// biz_profile's base64 logo/hero_image/about_picture upload handling (admin.php:216-291) — that
// logic saves decoded image bytes to disk, which has no meaning in a Worker and must be
// rewritten against R2 rather than ported as-is. Route-layer wiring (calling requireAdmin(),
// stamping version_updated_at) is also left to the eventual Hono route, matching how auth.ts
// leaves session-header parsing to its caller.

export const PUBLIC_SETTING_KEYS = [
  "square_fees",
  "tax_rates",
  "product_categories",
  "cat_prefixes",
  "shipping_config",
  "square_mode",
  "square_app_id",
  "square_location_id",
  "confirm_token",
  "major_version",
  "minor_version",
  "debug_mode",
  "log_page_changes",
] as const;

export const SENSITIVE_SETTING_KEYS = [
  "github_token",
  "admin_password",
  "admin_sec_answer",
  "square_access_token",
  "square_app_secret",
  "smtp_pass",
] as const;

/** Keys that default to '0' the first time they're read, if never set. */
const BOOLEAN_DEFAULT_KEYS = ["debug_mode", "log_page_changes"];

/** Keys that auto-generate a random 32-hex-char token the first time they're read, if never set. */
const AUTO_TOKEN_KEYS = ["rt_token", "confirm_token", "backup_token"];

export interface SettingsStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export interface SettingsResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16)); // bin2hex(random_bytes(16)) -> 32 hex chars.
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Ports api/admin.php's `action=get_setting`. `isAdmin` must already reflect a verified
 * X-Admin-Token (via src/auth.ts's isValidAdminToken) — this function only applies the
 * public-key allowlist and sensitive-key blocklist on top of that.
 */
export async function getSettingValue(
  store: SettingsStore,
  key: string,
  isAdmin: boolean
): Promise<SettingsResult<{ value: string | null }>> {
  if (!key) return { ok: false, error: "Missing key" };
  if (!(PUBLIC_SETTING_KEYS as readonly string[]).includes(key) && !isAdmin) {
    return { ok: false, error: "Unauthorized", status: 401 };
  }
  if ((SENSITIVE_SETTING_KEYS as readonly string[]).includes(key)) {
    return { ok: false, error: "Forbidden" };
  }

  let val = await store.getSetting(key);

  if (val === null && BOOLEAN_DEFAULT_KEYS.includes(key)) {
    val = "0";
    await store.setSetting(key, val);
  }
  if (val === null && AUTO_TOKEN_KEYS.includes(key)) {
    val = randomToken();
    await store.setSetting(key, val);
  }
  if (val === null && key === "major_version") {
    val = "1";
    await store.setSetting(key, val);
  }
  if (val === null && key === "minor_version") {
    val = "0";
    await store.setSetting(key, val);
  }

  return { ok: true, data: { value: val } };
}

/**
 * Ports api/admin.php's `action=set_setting`/`save_setting`. Caller must have already required
 * admin — this only performs the business logic. Does NOT handle biz_profile image uploads (see
 * this file's header) or version_updated_at stamping (left to the route, which knows the current
 * time the way the rest of the app does).
 */
export async function setSettingValue(
  store: SettingsStore,
  key: string,
  value: string
): Promise<SettingsResult> {
  if (!key) return { ok: false, error: "Missing key" };
  if ((SENSITIVE_SETTING_KEYS as readonly string[]).includes(key)) {
    return { ok: false, error: "Forbidden" };
  }
  await store.setSetting(key, value);
  return { ok: true };
}

// ── In-memory test double ──
export class SettingsStoreFake implements SettingsStore {
  settings = new Map<string, string>();

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null;
  }
  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }
}
