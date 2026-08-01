// Settings get/set: ports api/admin.php's `get_setting` and `set_setting`/`save_setting` actions.
//
// Written against a small store interface, exactly like src/auth.ts.
//
// ── Scope of this port ──
// Covers the key-gating, sensitive-key blocking, and auto-generation/default behaviour of
// get_setting/set_setting verbatim, plus biz_profile's base64 logo/hero_image/about_picture
// upload handling (admin.php:216-299, ported in processBizProfileImages below) — backed by R2
// rather than disk. Route-layer wiring (calling requireAdmin(), stamping version_updated_at) is
// left to the eventual Hono route, matching how auth.ts leaves session-header parsing to its
// caller.
//
// biz_profile's three image blocks differ from studio.ts's resolveStudioImage() in one important
// way, faithfully preserved rather than unified: the PHP's outer `preg_match` is the guard for the
// WHOLE block, so a value that doesn't match `data:image/...;base64,...` at all (already a URL, or
// simply absent) is left UNCHANGED — but once that pattern DOES match, a decode failure is a HARD
// FAIL here (`if (!$bytes) fail(...)`), unlike studio.php's studioSaveImage(), which silently
// empties on the same failure. See processBizProfileImages's own doc comment for the full mapping.

import { decodeBase64Image, mimeForFileType } from "./lib/file-upload";

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
  putImage(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  deleteImage(key: string): Promise<void>;
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

const BIZ_IMAGE_FIELDS = [
  { field: "logo", dir: "business_logo", base: "logo", label: "logo image" },
  { field: "hero_image", dir: "business_hero", base: "hero", label: "hero image" },
  { field: "about_picture", dir: "business_about", base: "about", label: "about picture" },
] as const;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Ports api/admin.php's three biz_profile image blocks (lines 220-299) — logo, hero_image, and
 * about_picture all share this shape. Mutates `biz` in place, replacing each successfully-uploaded
 * field with its new root-relative URL (`/business_logo/<filename>`, matching what migration 0009
 * already normalized every existing biz_profile row to — see products.ts's header for why
 * root-relative rather than a hardcoded domain).
 *
 * Per field: absent/empty -> untouched (`!empty($biz['logo'])` failing). Doesn't match
 * `data:image/...;base64,...` at all (already a URL, or just malformed) -> untouched, because the
 * PHP's outer `preg_match` is the guard for the whole block. Matches but too large or a bad magic
 * byte -> hard fail, aborting the WHOLE set_setting call (matches `fail()` having no catch in the
 * PHP) — note this is stricter than studio.ts's resolveStudioImage(), which only hard-fails on
 * those same two cases but silently empties a decode failure; here a decode failure is ALSO a hard
 * fail (`if (!$bytes) fail(...)`). Matches and validates -> written to R2, and the field's old file
 * is deleted first if it was one of ours (prefix check on the pre-update value), same order as the
 * PHP (write new, delete old, then reassign) — an old file from a DIFFERENT field is never touched
 * even if two fields happen to share a filename, since each field only ever deletes from its own
 * directory.
 */
async function processBizProfileImages(
  store: SettingsStore,
  currentRaw: string | null,
  biz: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; error: string }> {
  let current: Record<string, unknown> = {};
  if (currentRaw) {
    try {
      const parsed = JSON.parse(currentRaw);
      if (parsed && typeof parsed === "object") current = parsed as Record<string, unknown>;
    } catch {
      // A corrupt prior row just means the old-file lookup below never matches, same as the PHP's
      // json_decode(bad json) returning null and `!empty($oldBiz['logo'])` failing quietly.
    }
  }

  for (const { field, dir, base, label } of BIZ_IMAGE_FIELDS) {
    const value = biz[field];
    if (typeof value !== "string" || !value) continue;

    const decoded = decodeBase64Image(value);
    if (!decoded.ok) {
      if (decoded.reason === "no_match") continue; // already a URL, or malformed — left untouched
      if (decoded.reason === "too_large") return { ok: false, error: `${capitalize(label)} too large (max 4MB)` };
      if (decoded.reason === "decode_failed") return { ok: false, error: `Could not decode ${label}` };
      return { ok: false, error: `Invalid ${label} format — only JPEG and PNG are accepted` };
    }

    const filename = `${base}_${Math.floor(Date.now() / 1000)}.${decoded.fileType}`;
    await store.putImage(`${dir}/${filename}`, decoded.bytes, mimeForFileType(decoded.fileType));

    const oldValue = current[field];
    const prefix = `/${dir}/`;
    if (typeof oldValue === "string" && oldValue.startsWith(prefix)) {
      await store.deleteImage(`${dir}/${oldValue.slice(prefix.length)}`);
    }

    biz[field] = `/${dir}/${filename}`;
  }

  return { ok: true };
}

/**
 * Ports api/admin.php's `action=set_setting`/`save_setting`. Caller must have already required
 * admin — this only performs the business logic. Does NOT handle version_updated_at stamping (left
 * to the route, which knows the current time the way the rest of the app does).
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

  let finalValue = value;
  if (key === "biz_profile") {
    let biz: unknown;
    try {
      biz = JSON.parse(value);
    } catch {
      biz = null;
    }
    if (biz && typeof biz === "object") {
      const bizRecord = biz as Record<string, unknown>;
      const currentRaw = await store.getSetting("biz_profile");
      const processed = await processBizProfileImages(store, currentRaw, bizRecord);
      if (!processed.ok) return { ok: false, error: processed.error, status: 400 };
      finalValue = JSON.stringify(bizRecord);
    }
  }

  await store.setSetting(key, finalValue);
  return { ok: true };
}

// ── In-memory test double ──
export class SettingsStoreFake implements SettingsStore {
  settings = new Map<string, string>();
  images = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async getSetting(key: string): Promise<string | null> {
    return this.settings.get(key) ?? null;
  }
  async setSetting(key: string, value: string): Promise<void> {
    this.settings.set(key, value);
  }
  async putImage(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.images.set(key, { bytes, contentType });
  }
  async deleteImage(key: string): Promise<void> {
    this.images.delete(key);
  }
}
