import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { cors, allowedOrigin } from "./cors";
import type { Env } from "../types";

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/api/*", cors);
  app.get("/api/health", (c) => c.json({ ok: true }));
  return app;
}

const envFor = (environment: "production" | "staging"): Env =>
  ({ ENVIRONMENT: environment }) as Env;

describe("allowedOrigin", () => {
  it("is the apex domain in production", () => {
    expect(allowedOrigin(envFor("production"))).toBe("https://handmadedesignsbysuzi.com");
  });

  it("is the staging subdomain in staging", () => {
    expect(allowedOrigin(envFor("staging"))).toBe("https://staging.handmadedesignsbysuzi.com");
  });
});

describe("cors middleware", () => {
  it("short-circuits OPTIONS with a bare 200 and no body, without reaching the route", async () => {
    const app = makeApp();
    const res = await app.request("/api/health", { method: "OPTIONS" }, envFor("production"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
  });

  it("sets Access-Control-Allow-Origin to the environment's own origin", async () => {
    const app = makeApp();
    const res = await app.request("/api/health", { method: "GET" }, envFor("production"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://handmadedesignsbysuzi.com");
  });

  it("uses the staging origin on the staging environment", async () => {
    const app = makeApp();
    const res = await app.request("/api/health", { method: "OPTIONS" }, envFor("staging"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://staging.handmadedesignsbysuzi.com");
  });

  it("sets the standard methods and headers allowlist", async () => {
    const app = makeApp();
    const res = await app.request("/api/health", { method: "GET" }, envFor("production"));
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, PUT, DELETE, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization, X-Admin-Token");
  });

  it("still returns the route's own JSON body on a normal request", async () => {
    const app = makeApp();
    const res = await app.request("/api/health", { method: "GET" }, envFor("production"));
    expect(await res.json()).toEqual({ ok: true });
  });

  it("does not apply to routes outside the mounted prefix", async () => {
    const app = makeApp();
    app.get("/other", (c) => c.json({ untouched: true }));
    const res = await app.request("/other", { method: "GET" }, envFor("production"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
