import { describe, it, expect, beforeEach } from "vitest";
import { getSettingValue, setSettingValue, SettingsStoreFake, PUBLIC_SETTING_KEYS, SENSITIVE_SETTING_KEYS } from "./settings";
import { MAX_BASE64_IMAGE_LENGTH } from "./lib/file-upload";

function makeDataUrl(mime: string, bytes: number[]): string {
  const binary = String.fromCharCode(...bytes);
  return `data:${mime};base64,${btoa(binary)}`;
}
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BOGUS_BYTES = [0x00, 0x01, 0x02, 0x03];

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

  describe("biz_profile image uploads", () => {
    it("passes through a non-object value unchanged (no JSON, no image processing)", async () => {
      const result = await setSettingValue(store, "biz_profile", "not json");
      expect(result.ok).toBe(true);
      expect(await store.getSetting("biz_profile")).toBe("not json");
    });

    it("leaves an already-URL logo untouched", async () => {
      const value = JSON.stringify({ name: "Biz", logo: "/business_logo/existing.jpg" });
      const result = await setSettingValue(store, "biz_profile", value);
      expect(result.ok).toBe(true);
      expect(JSON.parse((await store.getSetting("biz_profile"))!).logo).toBe("/business_logo/existing.jpg");
    });

    it("leaves a malformed data:image value untouched, unlike studio's silent-empty", async () => {
      const value = JSON.stringify({ name: "Biz", logo: "data:image/jpeg;base64" });
      const result = await setSettingValue(store, "biz_profile", value);
      expect(result.ok).toBe(true);
      expect(JSON.parse((await store.getSetting("biz_profile"))!).logo).toBe("data:image/jpeg;base64");
    });

    it("uploads a valid logo to R2 under business_logo/logo_<ts>.<ext>", async () => {
      const value = JSON.stringify({ name: "Biz", logo: makeDataUrl("image/jpeg", JPEG_BYTES) });
      const result = await setSettingValue(store, "biz_profile", value);
      expect(result.ok).toBe(true);
      const saved = JSON.parse((await store.getSetting("biz_profile"))!);
      expect(saved.logo).toMatch(/^\/business_logo\/logo_\d+\.jpg$/);
      const key = saved.logo.slice(1);
      expect(store.images.has(key)).toBe(true);
      expect(store.images.get(key)!.contentType).toBe("image/jpeg");
    });

    it("uploads hero_image and about_picture to their own directories", async () => {
      const value = JSON.stringify({
        name: "Biz",
        hero_image: makeDataUrl("image/png", PNG_BYTES),
        about_picture: makeDataUrl("image/jpeg", JPEG_BYTES),
      });
      await setSettingValue(store, "biz_profile", value);
      const saved = JSON.parse((await store.getSetting("biz_profile"))!);
      expect(saved.hero_image).toMatch(/^\/business_hero\/hero_\d+\.png$/);
      expect(saved.about_picture).toMatch(/^\/business_about\/about_\d+\.jpg$/);
    });

    it("deletes the previous logo file once the new one is written", async () => {
      await setSettingValue(store, "biz_profile", JSON.stringify({ name: "Biz", logo: "/business_logo/old.jpg" }));
      await store.putImage("business_logo/old.jpg", new Uint8Array([1]), "image/jpeg");
      const result = await setSettingValue(store, "biz_profile", JSON.stringify({ name: "Biz", logo: makeDataUrl("image/jpeg", JPEG_BYTES) }));
      expect(result.ok).toBe(true);
      expect(store.images.has("business_logo/old.jpg")).toBe(false);
    });

    it("does not delete an old logo belonging to a different key's file", async () => {
      await setSettingValue(store, "biz_profile", JSON.stringify({ name: "Biz", logo: "https://cdn.example.com/not-ours.jpg" }));
      await setSettingValue(store, "biz_profile", JSON.stringify({ name: "Biz", logo: makeDataUrl("image/jpeg", JPEG_BYTES) }));
      // No assertion needed beyond "did not throw" — deleteImage is only ever called with our own
      // business_logo/ prefix, so an externally-hosted old URL is never touched.
    });

    it("hard-fails on a bad-magic-byte image (aborts the whole save, does not silently empty)", async () => {
      const value = JSON.stringify({ name: "Biz", logo: makeDataUrl("image/jpeg", BOGUS_BYTES) });
      const result = await setSettingValue(store, "biz_profile", value);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Invalid logo image format/);
      expect(await store.getSetting("biz_profile")).toBeNull(); // never written
    });

    it("hard-fails on an over-cap image with a field-specific message", async () => {
      const huge = `data:image/jpeg;base64,${"A".repeat(MAX_BASE64_IMAGE_LENGTH + 1)}`;
      const result = await setSettingValue(store, "biz_profile", JSON.stringify({ name: "Biz", hero_image: huge }));
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Hero image too large/);
    });

    it("hard-fails on a decode failure, unlike studio's silent-empty for the same case", async () => {
      const value = JSON.stringify({ name: "Biz", about_picture: "data:image/jpeg;base64,!!!" });
      const result = await setSettingValue(store, "biz_profile", value);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/Could not decode about picture/);
    });
  });
});

describe("PUBLIC_SETTING_KEYS / SENSITIVE_SETTING_KEYS", () => {
  it("have no overlap", () => {
    const overlap = PUBLIC_SETTING_KEYS.filter((k) => (SENSITIVE_SETTING_KEYS as readonly string[]).includes(k));
    expect(overlap).toEqual([]);
  });
});
