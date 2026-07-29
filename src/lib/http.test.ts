import { describe, it, expect } from "vitest";
import { timingSafeEqual } from "./http";
import { escapeHtml } from "./html-escape";

describe("timingSafeEqual", () => {
  it("accepts identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("rejects a single differing character", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("rejects differing lengths without throwing", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "x")).toBe(false);
  });

  it("accepts two empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });

  // The PHP this replaces (hash_equals) was used on the regression-test token and every HMAC
  // signature. A prefix match must not pass.
  it("rejects a prefix of the expected value", () => {
    expect(timingSafeEqual("secret", "secre\0")).toBe(false);
  });
});

describe("escapeHtml", () => {
  it("escapes all five characters", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  it("escapes ampersands first so entities are not double-built", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Handmade Designs By Suzi")).toBe("Handmade Designs By Suzi");
  });
});
