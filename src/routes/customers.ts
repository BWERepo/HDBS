// Hono route for /api/customers.php — action-dispatch, matching how the PHP (and every JS call
// site: js/auth.js, js/admin-orders.js, js/admin-misc.js, js/store.js) already uses it: GET with
// ?action=list for the admin list, everything else POST with `action` in the body.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseCustomersStore, SupabaseOrdersStore } from "../db";
import { isValidAdminToken } from "../auth";
import {
  listCustomers,
  registerCustomer,
  loginCustomer,
  getCustomerSecurityQuestion,
  resetCustomerPassword,
  changeCustomerPassword,
  incrementOrderCount,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  cancelOrder,
} from "../customers";

export const customersRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

customersRoute.get("/api/customers.php", async (c) => {
  if (c.req.query("action") !== "list") return fail(c, "Unknown action", 400);
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const result = await listCustomers(new SupabaseCustomersStore(createDb(c.env)));
  return ok(c, result.data);
});

customersRoute.post("/api/customers.php", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const action = typeof body.action === "string" ? body.action : "";
  const db = createDb(c.env);
  const customersStore = new SupabaseCustomersStore(db);
  const ip = c.req.header("CF-Connecting-IP") ?? "";

  switch (action) {
    case "register": {
      const rateLimitKey = await sha256Hex(`register_ip_${ip}`);
      const result = await registerCustomer(
        customersStore,
        {
          em: String(body.em ?? ""),
          pw: String(body.pw ?? ""),
          fn: body.fn as string | undefined,
          ln: body.ln as string | undefined,
          ph: body.ph as string | undefined,
          secQ: body.secQ as string | undefined,
          secA: body.secA as string | undefined,
        },
        rateLimitKey,
        c.env.ORDER_TOKEN_SECRET
      );
      return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
    }

    case "login": {
      const email = String(body.em ?? "").toLowerCase().trim();
      const result = await loginCustomer(customersStore, email, String(body.pw ?? ""), `login_${email}`, c.env.ORDER_TOKEN_SECRET);
      return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
    }

    case "get_sec_question": {
      const result = await getCustomerSecurityQuestion(customersStore, String(body.em ?? ""));
      return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
    }

    case "reset_password": {
      const email = String(body.em ?? "").toLowerCase().trim();
      const result = await resetCustomerPassword(customersStore, email, String(body.answer ?? ""), String(body.new_pw ?? ""), `reset_${email}`);
      return result.ok ? ok(c, { message: "Password reset successfully" }) : fail(c, result.error!, result.status);
    }

    case "change_password": {
      const id = String(body.id ?? "");
      const result = await changeCustomerPassword(customersStore, id, String(body.old_pw ?? ""), String(body.new_pw ?? ""), `changepw_${id}`);
      return result.ok ? ok(c, { message: "Password updated" }) : fail(c, result.error!, result.status);
    }

    case "inc_orders": {
      const result = await incrementOrderCount(new SupabaseOrdersStore(db), customersStore, String(body.em ?? ""), String(body.order_id ?? ""));
      return result.ok ? ok(c, {}) : fail(c, result.error!, result.status);
    }

    case "add_customer": {
      if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
      const result = await addCustomer(customersStore, {
        em: String(body.em ?? ""),
        pw: body.pw as string | undefined,
        fn: body.fn as string | undefined,
        ln: body.ln as string | undefined,
        ph: body.ph as string | undefined,
      });
      return result.ok ? ok(c, { id: result.data!.id, message: "Customer added" }) : fail(c, result.error!, result.status);
    }

    case "update_customer": {
      if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
      const result = await updateCustomer(customersStore, String(body.id ?? ""), {
        fn: body.fn as string | undefined,
        ln: body.ln as string | undefined,
        em: body.em as string | undefined,
        ph: body.ph as string | undefined,
      });
      return result.ok ? ok(c, { message: "Customer updated" }) : fail(c, result.error!, result.status);
    }

    case "delete_customer": {
      if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
      const result = await deleteCustomer(customersStore, String(body.id ?? ""));
      return result.ok ? ok(c, { message: "Customer deleted" }) : fail(c, result.error!, result.status);
    }

    case "cancel_order": {
      const result = await cancelOrder(
        new SupabaseOrdersStore(db),
        String(body.order_id ?? ""),
        String(body.cancel_token ?? ""),
        c.env.ORDER_TOKEN_SECRET
      );
      return result.ok ? ok(c, { message: "Order cancelled" }) : fail(c, result.error!, result.status);
    }

    default:
      return fail(c, "Unknown action", 400);
  }
});
