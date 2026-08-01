// Hono routes for GET/POST/PUT/DELETE /api/orders.php.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseOrdersStore } from "../db";
import { isValidAdminToken } from "../auth";
import { listOrders, createOrder, updateOrder, deleteOrder, deleteAllOrders, type OrderUpdatableFields } from "../orders";

export const ordersRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

/** WebCrypto has no MD5; SHA-256 is fine here since it's purely an internal rate-limit bucket
 *  key, never compared against a stored PHP-generated md5 value (same reasoning as
 *  routes/subscribers.ts's identical helper). */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

ordersRoute.get("/api/orders.php", async (c) => {
  const db = createDb(c.env);
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const orders = await listOrders(new SupabaseOrdersStore(db));
  return ok(c, { orders });
});

ordersRoute.post("/api/orders.php", async (c) => {
  const db = createDb(c.env);
  const isAdmin = await isValidAdminToken(new SupabaseAdminAuthStore(db), c.req.header("X-Admin-Token"));
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const ip = c.req.header("CF-Connecting-IP") ?? "";
  const rateLimitKey = await sha256Hex(`order_ip_${ip}`);

  const items = Array.isArray(body.items)
    ? (body.items as Array<Record<string, unknown>>).map((i) => ({
        id: String(i.id ?? ""),
        q: i.q !== undefined ? Number(i.q) : undefined,
        price: i.price !== undefined ? Number(i.price) : undefined,
      }))
    : undefined;

  const result = await createOrder(
    new SupabaseOrdersStore(db),
    {
      id: String(body.id ?? ""),
      cust: body.cust as string | undefined,
      email: body.email as string | undefined,
      phone: body.phone as string | undefined,
      addr: body.addr as string | undefined,
      total: Number(body.total ?? 0),
      tax: body.tax !== undefined ? Number(body.tax) : undefined,
      fee: body.fee !== undefined ? Number(body.fee) : undefined,
      pay: body.pay as string | undefined,
      status: body.status as string | undefined,
      date: body.date as string | undefined,
      order_type: body.order_type as string | undefined,
      payment_config: body.payment_config as string | undefined,
      check_number: body.check_number as string | undefined,
      shipping: body.shipping !== undefined ? Number(body.shipping) : undefined,
      items,
      source: body.source as string | undefined,
    },
    isAdmin,
    rateLimitKey,
    c.env.ORDER_TOKEN_SECRET
    // onInPersonPaid intentionally omitted (defaults to a no-op) — email.ts doesn't exist yet.
    // TODO(email.ts): wire the in-person-paid confirmation email once that module exists.
  );
  return result.ok ? ok(c, { message: "Order saved", cancel_token: result.data!.cancel_token }) : fail(c, result.error!, result.status);
});

ordersRoute.put("/api/orders.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const fields: Partial<OrderUpdatableFields> = {};
  if (body.swept_date !== undefined) fields.tax_swept_date = body.swept_date ? String(body.swept_date) : null;
  if (body.status !== undefined) fields.status = String(body.status);
  if (body.pay !== undefined) fields.payment_method = String(body.pay);
  if (body.order_type !== undefined) fields.order_type = String(body.order_type);
  if (body.payment_config !== undefined) fields.payment_configuration = String(body.payment_config);
  if (body.check_number !== undefined) fields.check_number = String(body.check_number);
  if (body.fee !== undefined) fields.transaction_fee = Number(body.fee);
  if (body.cust !== undefined) fields.customer_name = String(body.cust);
  if (body.email !== undefined) fields.customer_email = String(body.email);
  if (body.phone !== undefined) fields.customer_phone = String(body.phone);
  if (body.addr !== undefined) fields.shipping_address = String(body.addr);
  if (body.total !== undefined) fields.total = Number(body.total);
  if (body.tax !== undefined) fields.tax_amount = Number(body.tax);
  if (body.carrier !== undefined) fields.shipping_carrier = String(body.carrier);
  if (body.tracking !== undefined) fields.tracking_number = String(body.tracking);

  const result = await updateOrder(new SupabaseOrdersStore(createDb(c.env)), String(body.id ?? ""), fields);
  return result.ok ? ok(c, { message: "Order updated" }) : fail(c, result.error!, result.status);
});

ordersRoute.delete("/api/orders.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const store = new SupabaseOrdersStore(createDb(c.env));

  if (body.delete_all) {
    const result = await deleteAllOrders(store);
    return result.ok ? ok(c, { message: "All orders deleted" }) : fail(c, result.error!, result.status);
  }
  const result = await deleteOrder(store, String(body.id ?? ""));
  return result.ok ? ok(c, { message: "Order deleted" }) : fail(c, result.error!, result.status);
});
