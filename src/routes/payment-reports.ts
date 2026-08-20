// Hono routes for the admin payment-reporting screens: GET /api/paypal_payments.php, POST
// /api/paypal_status.php (matches the front end's actual call, even though the PHP itself never
// checked the method), GET /api/square_payments.php. All three are admin-only.

import { Hono } from "hono";
import type { Env } from "../types";
import { apiHosts } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseOrdersStore } from "../db";
import { isValidAdminToken } from "../auth";
import { createSquareGateway } from "../lib/square-gateway";
import { createPaypalGateway } from "../lib/paypal-gateway";
import { getPaypalPaymentsReport, checkPaypalStatus, getSquarePaymentsReport, backfillSquareTransactionFees } from "../payment-reports";

export const paymentReportsRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

function ppEnv(c: { env: Env }): string {
  return c.env.ENVIRONMENT === "production" ? "live" : "sandbox";
}

paymentReportsRoute.get("/api/paypal_payments.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const result = await getPaypalPaymentsReport(new SupabaseOrdersStore(createDb(c.env)), c.req.query("begin") ?? "", c.req.query("end") ?? "", ppEnv(c));
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});

paymentReportsRoute.post("/api/paypal_status.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const gateway = createPaypalGateway(c.env.PAYPAL_CLIENT_ID, c.env.PAYPAL_SECRET, apiHosts(c.env).paypal);
  const report = await checkPaypalStatus(gateway, ppEnv(c), !!c.env.PAYPAL_CLIENT_ID, !!c.env.PAYPAL_SECRET);
  return ok(c, report);
});

paymentReportsRoute.get("/api/square_payments.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const gateway = createSquareGateway(c.env.SQUARE_TOKEN, apiHosts(c.env).square);
  const result = await getSquarePaymentsReport(gateway, new SupabaseOrdersStore(createDb(c.env)), c.env.SQUARE_LOCATION_ID, {
    begin: c.req.query("begin"),
    end: c.req.query("end"),
    cursor: c.req.query("cursor"),
  });
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});

// The admin "Update Trans Fees" button (js/admin-orders.js's updateTransFees()) POSTs
// {action:'backfill_fees'} to this same URL — matching the PHP's own single-endpoint,
// action-dispatched shape rather than a separate route.
paymentReportsRoute.post("/api/square_payments.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  if (body.action !== "backfill_fees") return fail(c, "Unknown action");
  const gateway = createSquareGateway(c.env.SQUARE_TOKEN, apiHosts(c.env).square);
  const result = await backfillSquareTransactionFees(gateway, new SupabaseOrdersStore(createDb(c.env)), c.env.SQUARE_LOCATION_ID);
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});
