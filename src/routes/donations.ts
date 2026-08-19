// Hono routes for POST /api/donations.php (single-file multi-action, same convention as
// coupons.php/tax_sweep.php: `action` in the body picks the operation).

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseDonationsStore } from "../db";
import { isValidAdminToken } from "../auth";
import { createDonation, listDonations, deleteDonation } from "../donations";

export const donationsRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

donationsRoute.post("/api/donations.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);

  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const action = String(body.action ?? "");
  const store = new SupabaseDonationsStore(createDb(c.env));

  if (action === "create") {
    const result = await createDonation(store, {
      product_id: body.product_id ? String(body.product_id) : undefined,
      date: body.date ? String(body.date) : undefined,
      recipient: body.recipient ? String(body.recipient) : undefined,
    });
    return result.ok ? ok(c, { id: result.data!.id }) : fail(c, result.error!, result.status ?? 400);
  }

  if (action === "list") {
    const result = await listDonations(store);
    return ok(c, { donations: result.data!.donations });
  }

  if (action === "delete") {
    const result = await deleteDonation(store, Number(body.id ?? 0));
    return result.ok ? ok(c, { message: "Donation deleted" }) : fail(c, result.error!, 400);
  }

  return fail(c, "Unknown action", 400);
});
