import { describe, it, expect, beforeEach } from "vitest";
import { getSettingValue, setSettingValue, SettingsStoreFake, PUBLIC_SETTING_KEYS, SENSITIVE_SETTING_KEYS } from "./settings";

let store: SettingsStoreFake;

beforeEach(() => {
  store = new SettingsStoreFake();
});

describe("getSettingValue", () => {
  it("rejects a missing key", async () => {
    const result = await getSettingValue(store, "", true);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing key/);
  });

  it("allows a public key without admin", async () => {
    await store.setSetting("square_mode", "sandbox");
    const result = await getSettingValue(store, "square_mode", false);
    expect(result.ok).toBe(true);
    expect(result.data?.value).toBe("sandbox");
  });

  it("requires admin for a non-public key", async () => {
    await store.setSetting("some_other_key", "x");
    const result = await getSettingValue(store, "some_other_key", false);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("allows a non-public key when admin", async () => {
    await store.setSetting("some_other_key", "x");
    const result = await getSettingValue(store, "some_other_key", true);
    expect(result.ok).toBe(true);
    expect(result.data?.value).toBe("x");
  });

  for (const key of SENSITIVE_SETTING_KEYS) {
    it(`blocks the sensitive key "${key}" even for admin`, async () => {
      await store.setSetting(key, "secret");
      const result = await getSettingValue(store, key, true);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Forbidden/);
    });
  }

  for (const key of ["debug_mode", "log_page_changes"]) {
    it(`defaults unset boolean key "${key}" to '0' and persists it`, async () => {
      const result = await getSettingValue(store, key, true);
      expect(result.data?.value).toBe("0");
      expect(await store.getSetting(key)).toBe("0");
    });
  }

  for (const key of ["rt_token", "confirm_token", "backup_token"]) {
    it(`auto-generates a 32-hex-char token for unset "${key}" and persists it`, async () => {
      const result = await getSettingValue(store, key, true);
      expect(result.data?.value).toMatch(/^[0-9a-f]{32}$/);
      expect(await store.getSetting(key)).toBe(result.data?.value);
    });
  }

  it("defaults unset major_version to '1'", async () => {
    const result = await getSettingValue(store, "major_version", true);
    expect(result.data?.value).toBe("1");
  });

  it("defaults unset minor_version to '0'", async () => {
    const result = await getSettingValue(store, "minor_version", true);
    expect(result.data?.value).toBe("0");
  });

  it("returns null for an unset, non-defaulted key", async () => {
    const result = await getSettingValue(store, "product_categories", true);
    expect(result.ok).toBe(true);
    expect(result.data?.value).toBeNull();
  });

  it("does not overwrite an already-set defaulted key", async () => {
    await store.setSetting("major_version", "3");
    const result = await getSettingValue(store, "major_version", true);
    expect(result.data?.value).toBe("3");
  });
});

describe("setSettingValue", () => {
  it("rejects a missing key", async () => {
    const result = await setSettingValue(store, "", "x");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing key/);
  });

  it("saves a normal key", async () => {
    const result = await setSettingValue(store, "product_categories", '["a","b"]');
    expect(result.ok).toBe(true);
    expect(await store.getSetting("product_categories")).toBe('["a","b"]');
  });

  for (const key of SENSITIVE_SETTING_KEYS) {
    it(`blocks writing the sensitive key "${key}" through this path`, async () => {
      const result = await setSettingValue(store, key, "new-value");
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Forbidden/);
      expect(await store.getSetting(key)).toBeNull();
    });
  }
});

describe("PUBLIC_SETTING_KEYS / SENSITIVE_SETTING_KEYS", () => {
  it("have no overlap", () => {
    const overlap = PUBLIC_SETTING_KEYS.filter((k) => (SENSITIVE_SETTING_KEYS as readonly string[]).includes(k));
    expect(overlap).toEqual([]);
  });
});
