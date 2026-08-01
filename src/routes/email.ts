// Hono route for POST /send_confirm.php — admin-triggered resend of an order confirmation
// (or a preview render). Also used internally by routes/orders.ts's in-person-paid order
// creation, matching how the PHP curled this same endpoint.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseEmailOrderStore, SupabaseSettingsStore } from "../db";
import { isValidAdminToken } from "../auth";
import { sendOrderConfirmationEmail } from "../email";
import { resolveBizProfile } from "../lib/biz-profile";
import { createEmailSender } from "../lib/email-sender";

export const emailRoute = new Hono<{ Bindings: Env }>();

// ⚠️ Deliberate fix, not a literal port: the live send_confirm.php has NO requireAdmin() call at
// all despite its own comment calling it admin-only — anyone who found the URL could resend (or
// leak, via the preview mode) any order's confirmation email. Gating it here closes that gap;
// the admin UI already sends X-Admin-Token on every other call, so this costs it nothing.
emailRoute.post("/send_confirm.php", async (c) => {
  const db = createDb(c.env);
  if (!(await isValidAdminToken(new SupabaseAdminAuthStore(db), c.req.header("X-Admin-Token")))) {
    return fail(c, "Unauthorized", 401);
  }
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";

  const bizProfileRaw = await new SupabaseSettingsStore(db).getSetting("biz_profile");
  const biz = resolveBizProfile(bizProfileRaw);

  const result = await sendOrderConfirmationEmail(
    new SupabaseEmailOrderStore(db),
    createEmailSender(c.env.EMAIL_MODE, c.env.RESEND_API_KEY, biz.name),
    biz.name,
    biz.email,
    orderId,
    { preview: !!body.preview }
  );

  if (!result.ok && result.error === "Missing order_id") return fail(c, result.error);
  if (!result.ok && result.error === "Order not found") return fail(c, result.error);
  // Matches send_confirm.php: a failed SEND still returns success:false but with status/to info,
  // not a hard error — the caller (admin UI) shows the failure inline rather than a thrown error.
  return ok(c, { success: result.ok, status: "ok", to: result.data?.to, preview: result.data?.preview, html: result.data?.html, subject: result.data?.subject });
});
