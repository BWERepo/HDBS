// Hono route for POST /api/order_lookup.php.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseOrderLookupStore, SupabaseSettingsStore } from "../db";
import { requestOrderLookupLink, viewOrdersByToken } from "../order-lookup";
import { resolveBizProfile } from "../lib/biz-profile";
import { createEmailSender } from "../lib/email-sender";

export const orderLookupRoute = new Hono<{ Bindings: Env }>();

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

orderLookupRoute.post("/api/order_lookup.php", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const action = String(body.action ?? "");
  const store = new SupabaseOrderLookupStore(createDb(c.env));

  if (action === "request") {
    const email = String(body.email ?? "").toLowerCase().trim();
    const bizProfileRaw = await new SupabaseSettingsStore(createDb(c.env), c.env.R2_PUBLIC).getSetting("biz_profile");
    const bizName = resolveBizProfile(bizProfileRaw).name;
    const origin = new URL(c.req.url).origin;
    const rateLimitKey = await sha256Hex(`order_lookup_${email}`);

    const result = await requestOrderLookupLink(
      store,
      createEmailSender(c.env.EMAIL_MODE, c.env.BREVO_API_KEY, bizName),
      bizName,
      email,
      origin,
      c.env.ORDER_TOKEN_SECRET,
      rateLimitKey
    );
    return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
  }

  if (action === "view") {
    const result = await viewOrdersByToken(store, String(body.token ?? ""), c.env.ORDER_TOKEN_SECRET);
    return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
  }

  return fail(c, "Unknown action", 400);
});
