// Hono route for GET /api/orders.php — admin-only order list with grouped line items.
//
// POST (create order)/PUT (update)/DELETE are not wired yet — see src/orders.ts's header for why
// order creation specifically is deferred to its own pass.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseOrdersStore } from "../db";
import { isValidAdminToken } from "../auth";
import { listOrders } from "../orders";

export const ordersRoute = new Hono<{ Bindings: Env }>();

ordersRoute.get("/api/orders.php", async (c) => {
  const db = createDb(c.env);
  const isAdmin = await isValidAdminToken(new SupabaseAdminAuthStore(db), c.req.header("X-Admin-Token"));
  if (!isAdmin) return fail(c, "Unauthorized", 401);
  const orders = await listOrders(new SupabaseOrdersStore(db));
  return ok(c, { orders });
});

ordersRoute.on(["POST", "PUT", "DELETE"], "/api/orders.php", (c) =>
  fail(c, "Not yet ported", 501)
);
