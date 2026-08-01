// Hono routes for GET/POST /api/refund.php. Unlike payments.ts's checkout endpoints, the whole
// file requires admin in the PHP (refund.php calls requireAdmin() once, unconditionally, at the
// top) — refunds are always admin-initiated, never something a customer triggers directly.

import { Hono } from "hono";
import type { Env } from "../types";
import { apiHosts } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseOrdersStore, SupabaseRefundsStore, SupabaseSettingsStore, SupabaseEmailOrderStore, SupabaseAppLogStore } from "../db";
import { isValidAdminToken } from "../auth";
import { resolveBizProfile } from "../lib/biz-profile";
import { createEmailSender } from "../lib/email-sender";
import { createSquareGateway } from "../lib/square-gateway";
import { createPaypalGateway } from "../lib/paypal-gateway";
import { listRefundsForOrder, processRefund } from "../refunds";

export const refundsRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

refundsRoute.get("/api/refund.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const db = createDb(c.env);
  const result = await listRefundsForOrder(new SupabaseRefundsStore(db), c.req.query("order_id") ?? "");
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});

refundsRoute.post("/api/refund.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const db = createDb(c.env);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);

  const bizRaw = await new SupabaseSettingsStore(db, c.env.R2_PUBLIC).getSetting("biz_profile");
  const biz = resolveBizProfile(bizRaw);

  const result = await processRefund(
    new SupabaseOrdersStore(db),
    new SupabaseRefundsStore(db),
    createSquareGateway(c.env.SQUARE_TOKEN, apiHosts(c.env).square),
    createPaypalGateway(c.env.PAYPAL_CLIENT_ID, c.env.PAYPAL_SECRET, apiHosts(c.env).paypal),
    new SupabaseEmailOrderStore(db),
    createEmailSender(c.env.EMAIL_MODE, c.env.BREVO_API_KEY, biz.name),
    biz.name,
    biz.email,
    {
      order_id: body.order_id as string | undefined,
      amount: body.amount as number | string | undefined,
      reason: body.reason as string | undefined,
    },
    new Date(),
    new SupabaseAppLogStore(db)
  );
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});
