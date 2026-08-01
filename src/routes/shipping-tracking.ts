// Hono route for POST /api/validate_tracking.php — admin-only, live USPS tracking-number lookup.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore } from "../db";
import { isValidAdminToken } from "../auth";
import { createUspsGateway } from "../lib/usps-gateway";
import { validateTracking } from "../shipping-tracking";

export const shippingTrackingRoute = new Hono<{ Bindings: Env }>();

shippingTrackingRoute.post("/api/validate_tracking.php", async (c) => {
  if (!(await isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token")))) {
    return fail(c, "Unauthorized", 401);
  }
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const gateway = createUspsGateway(c.env.USPS_CONSUMER_KEY, c.env.USPS_CONSUMER_SECRET);
  const result = await validateTracking(gateway, { carrier: body.carrier as string | undefined, numbers: body.numbers });
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});
