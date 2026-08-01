import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { timingSafeEqual, ok, fail } from "./http";
import { escapeHtml } from "./html-escape";

// api/config.php's real ok()/fail() always merge in a `success` field:
//   function ok($data = []) { echo json_encode(array_merge(['success'=>true], $data)); }
//   function fail($msg, $code = 400) { echo json_encode(['success'=>false,'error'=>$msg]); }
// This file's own ok()/fail() dropped that field entirely for the whole first pass of this
// migration — every one of the ~9,900 lines of front-end JS checks `d.success` before trusting a
// response, so every route was silently untrusted by the browser even on a real 200. Caught only
// by loading the live site (the product catalog stuck on loading-skeleton placeholders forever),
// not by any test, because nothing asserted this HTTP-level envelope shape. These tests exist so
// that gap can't reopen silently.
function makeApp() {
  const app = new Hono();
  app.get("/ok-empty", (c) => ok(c));
  app.get("/ok-data", (c) => ok(c, { products: [1, 2, 3] }));
  app.get("/fail", (c) => fail(c, "Something broke"));
  app.get("/fail-status", (c) => fail(c, "Nope", 401));
  return app;
}

describe("ok/fail HTTP envelope — matches api/config.php's ok()/fail() exactly", () => {
  it("ok() with no data still includes success:true (PHP's ok($data = []) default)", async () => {
    const app = makeApp();
    const res = await app.request("/ok-empty");
    expect(await res.json()).toEqual({ success: true });
  });

  it("ok() merges success:true alongside the caller's data, not replacing it", async () => {
    const app = makeApp();
    const res = await app.request("/ok-data");
    expect(await res.json()).toEqual({ success: true, products: [1, 2, 3] });
  });

  it("ok() defaults to HTTP 200", async () => {
    const app = makeApp();
    const res = await app.request("/ok-data");
    expect(res.status).toBe(200);
  });

  it("fail() includes both success:false and the error message", async () => {
    const app = makeApp();
    const res = await app.request("/fail");
    expect(await res.json()).toEqual({ success: false, error: "Something broke" });
  });

  it("fail() defaults to HTTP 400, matching api/config.php's fail($msg, $code = 400)", async () => {
    const app = makeApp();
    const res = await app.request("/fail");
    expect(res.status).toBe(400);
  });

  it("fail() honors an explicit status code", async () => {
    const app = makeApp();
    const res = await app.request("/fail-status");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Nope" });
  });
});

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
