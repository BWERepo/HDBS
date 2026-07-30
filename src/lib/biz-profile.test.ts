import { describe, it, expect } from "vitest";
import { resolveBizProfile, defaultCopyright, BIZ_DEFAULTS } from "./biz-profile";

describe("resolveBizProfile", () => {
  it("returns every default when biz_profile is missing", () => {
    const biz = resolveBizProfile(null);
    expect(biz.name).toBe(BIZ_DEFAULTS.name);
    expect(biz.email).toBe(BIZ_DEFAULTS.email);
    expect(biz.hero_headline).toBe(BIZ_DEFAULTS.hero_headline);
    expect(biz.copyright_statement).toBe(defaultCopyright(BIZ_DEFAULTS.name));
  });

  it("degrades to defaults on corrupt JSON, matching index.php's try/catch fallback", () => {
    const biz = resolveBizProfile("{not json");
    expect(biz.name).toBe(BIZ_DEFAULTS.name);
  });

  it("overrides a field when present and non-empty", () => {
    const biz = resolveBizProfile(JSON.stringify({ name: "Suzi's Bags", email: "hi@example.com" }));
    expect(biz.name).toBe("Suzi's Bags");
    expect(biz.email).toBe("hi@example.com");
    // Untouched fields still fall back.
    expect(biz.hero_overline).toBe(BIZ_DEFAULTS.hero_overline);
  });

  it("falls back on empty string and the literal '0', matching PHP's !empty() semantics", () => {
    const biz = resolveBizProfile(JSON.stringify({ name: "", short_name: "0" }));
    expect(biz.name).toBe(BIZ_DEFAULTS.name);
    expect(biz.short_name).toBe(BIZ_DEFAULTS.short_name);
  });

  it("keeps the copyright default bound to the overridden business name", () => {
    const biz = resolveBizProfile(JSON.stringify({ name: "Suzi's Bags" }));
    expect(biz.copyright_statement).toBe(defaultCopyright("Suzi's Bags"));
  });

  it("lets an explicit copyright_statement override the name-bound default", () => {
    const biz = resolveBizProfile(JSON.stringify({ name: "Suzi's Bags", copyright_statement: "All rights reserved" }));
    expect(biz.copyright_statement).toBe("All rights reserved");
  });

  it("ignores a non-object JSON value (e.g. a bare string or array)", () => {
    const biz = resolveBizProfile(JSON.stringify("just a string"));
    expect(biz.name).toBe(BIZ_DEFAULTS.name);
  });
});
