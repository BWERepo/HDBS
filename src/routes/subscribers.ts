// Hono route for GET (admin list)/POST (public subscribe)/DELETE (admin unsubscribe)
// /api/subscribers.php.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseSubscribersStore } from "../db";
import { isValidAdminToken } from "../auth";
import { listSubscribers, subscribe, unsubscribe } from "../subscribers";

export const subscribersRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

subscribersRoute.get("/api/subscribers.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const result = await listSubscribers(new SupabaseSubscribersStore(createDb(c.env)));
  return ok(c, result.data);
});

subscribersRoute.post("/api/subscribers.php", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  // Matches api/subscribers.php's md5('sub_' + ip) rate-limit key.
  const ip = c.req.header("CF-Connecting-IP") ?? "";
  const key = await sha256Hex(`sub_${ip}`);
  const result = await subscribe(new SupabaseSubscribersStore(createDb(c.env)), key, String(body.email ?? ""), String(body.source ?? ""));
  return result.ok ? ok(c, { message: "Subscribed successfully" }) : fail(c, result.error!, result.status);
});

subscribersRoute.delete("/api/subscribers.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await unsubscribe(new SupabaseSubscribersStore(createDb(c.env)), String(body.email ?? ""));
  return result.ok ? ok(c, { message: "Unsubscribed" }) : fail(c, result.error!, result.status);
});

/** WebCrypto has no MD5; SHA-256 is a fine substitute here since this is purely an internal
 *  rate-limit bucket key, never compared against a stored PHP-generated md5 value. */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
