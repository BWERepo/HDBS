// Hono routes for POST /api/coupons.php (single-file multi-action, same convention as
// customers.php: `action` in the body picks the operation).

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseCouponsStore, SupabaseSettingsStore, SupabaseStoreCreditStore } from "../db";
import { isValidAdminToken } from "../auth";
import { createCoupon, listCoupons, deactivateCoupon, editCoupon, deleteCoupon, listCouponCodes, validateCoupon, myCouponRedemptions } from "../coupons";
import { getStoreCreditBalance, myStoreCreditTransactions } from "../store-credit";
import { verifyOrderToken } from "../lib/order-token";
import { decodeBase64Image } from "../lib/file-upload";

export const couponsRoute = new Hono<{ Bindings: Env }>();

const TEMPLATE_KEY = "coupon_templates/template";
const TEMPLATE_SETTING = "coupon_image";

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

couponsRoute.post("/api/coupons.php", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const action = String(body.action ?? "");
  const db = createDb(c.env);
  const store = new SupabaseCouponsStore(db);

  if (action === "validate") {
    const result = await validateCoupon(store, String(body.code ?? ""), Number(body.subtotal ?? 0), body.email ? String(body.email) : undefined);
    return result.ok ? ok(c, { discount: result.data!.discount, code: result.data!.code }) : fail(c, result.error!, 400);
  }

  if (action === "my_redemptions") {
    const email = await verifyOrderToken(String(body.token ?? ""), c.env.ORDER_TOKEN_SECRET);
    if (!email) return fail(c, "Invalid or expired token", 403);
    const result = await myCouponRedemptions(store, email);
    return ok(c, { redemptions: result.data!.redemptions });
  }

  if (action === "credit_balance") {
    const email = await verifyOrderToken(String(body.token ?? ""), c.env.ORDER_TOKEN_SECRET);
    if (!email) return fail(c, "Invalid or expired token", 403);
    const result = await getStoreCreditBalance(new SupabaseStoreCreditStore(db), email);
    return ok(c, { balance: result.data!.balance });
  }

  if (action === "my_credit_history") {
    const email = await verifyOrderToken(String(body.token ?? ""), c.env.ORDER_TOKEN_SECRET);
    if (!email) return fail(c, "Invalid or expired token", 403);
    const result = await myStoreCreditTransactions(new SupabaseStoreCreditStore(db), email);
    return ok(c, { balance: result.data!.balance, transactions: result.data!.transactions });
  }

  if (action === "get_template") {
    const settings = new SupabaseSettingsStore(db, c.env.R2_PUBLIC);
    const image = await settings.getSetting(TEMPLATE_SETTING);
    return ok(c, { image });
  }

  // Every remaining action is admin-only.
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);

  if (action === "create") {
    const result = await createCoupon(store, {
      name: String(body.name ?? ""),
      amount: Number(body.amount ?? 0),
      quantity: Number(body.quantity ?? 0),
      expires_at: body.expires_at ? String(body.expires_at) : null,
    });
    return result.ok ? ok(c, { id: result.data!.id, codes: result.data!.codes }) : fail(c, result.error!, result.status ?? 400);
  }

  if (action === "list") {
    const result = await listCoupons(store);
    return ok(c, { coupons: result.data!.coupons });
  }

  if (action === "deactivate") {
    const result = await deactivateCoupon(store, Number(body.id ?? 0));
    return result.ok ? ok(c, { message: "Coupon deactivated" }) : fail(c, result.error!, 400);
  }

  if (action === "update") {
    const result = await editCoupon(store, Number(body.id ?? 0), {
      amount: Number(body.amount ?? 0),
      expires_at: body.expires_at ? String(body.expires_at) : null,
    });
    return result.ok ? ok(c, { message: "Coupon updated" }) : fail(c, result.error!, 400);
  }

  if (action === "delete") {
    const result = await deleteCoupon(store, Number(body.id ?? 0));
    return result.ok ? ok(c, { message: "Coupon deleted" }) : fail(c, result.error!, 400);
  }

  if (action === "codes") {
    const result = await listCouponCodes(store, Number(body.id ?? 0));
    return result.ok ? ok(c, { codes: result.data!.codes }) : fail(c, result.error!, 400);
  }

  if (action === "upload_template") {
    const decoded = decodeBase64Image(String(body.image ?? ""));
    if (!decoded.ok) return fail(c, "Invalid image file", 400);
    const settings = new SupabaseSettingsStore(db, c.env.R2_PUBLIC);
    // A fixed key here would be served with the media route's `Cache-Control:
    // max-age=31536000, immutable` (see routes/media.ts) — overwriting the same URL's bytes
    // would never actually reach a browser/edge cache that already has it. Each upload gets its
    // own key instead, so the new image is a genuinely new, uncached URL.
    const previous = await settings.getSetting(TEMPLATE_SETTING);
    const key = `${TEMPLATE_KEY}-${Date.now()}.${decoded.fileType}`;
    await settings.putImage(key, decoded.bytes, decoded.fileType === "png" ? "image/png" : "image/jpeg");
    await settings.setSetting(TEMPLATE_SETTING, `/${key}`);
    if (previous && previous !== `/${key}`) await settings.deleteImage(previous.replace(/^\//, ""));
    return ok(c, { path: `/${key}` });
  }

  return fail(c, "Unknown action", 400);
});
