// Hono routes for the payment flow: POST /api/process_payment.php (Square), POST
// /api/paypal_create.php + POST /api/paypal_capture.php (PayPal), POST /api/square-webhook.php
// (async backstop). All four are public — a normal (non-test_mode) checkout charge has no auth
// requirement, same as the PHP; test_mode is gated on the admin token inside src/payments.ts
// itself, not at this route layer.

import { Hono } from "hono";
import type { Env } from "../types";
import { apiHosts } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseOrdersStore, SupabaseCustomersStore, SupabaseSettingsStore, SupabaseEmailOrderStore, SupabaseAppLogStore } from "../db";
import { isValidAdminToken } from "../auth";
import { resolveBizProfile } from "../lib/biz-profile";
import { createEmailSender } from "../lib/email-sender";
import { createSquareGateway } from "../lib/square-gateway";
import { createPaypalGateway } from "../lib/paypal-gateway";
import { chargeOrderWithSquare, createPaypalOrderForCheckout, capturePaypalOrderForCheckout, verifySquareWebhookSignature, handleSquareWebhookEvent } from "../payments";

export const paymentsRoute = new Hono<{ Bindings: Env }>();

async function loadBiz(db: ReturnType<typeof createDb>, r2: Env["R2_PUBLIC"]) {
  const raw = await new SupabaseSettingsStore(db, r2).getSetting("biz_profile");
  const resolved = resolveBizProfile(raw);
  return { name: resolved.name, email: resolved.email };
}

paymentsRoute.post("/api/process_payment.php", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const isAdmin = await isValidAdminToken(new SupabaseAdminAuthStore(db), c.req.header("X-Admin-Token"));
  const biz = await loadBiz(db, c.env.R2_PUBLIC);

  const result = await chargeOrderWithSquare(
    new SupabaseOrdersStore(db),
    createSquareGateway(c.env.SQUARE_TOKEN, apiHosts(c.env).square),
    new SupabaseCustomersStore(db),
    new SupabaseEmailOrderStore(db),
    createEmailSender(c.env.EMAIL_MODE, c.env.BREVO_API_KEY, biz.name),
    biz,
    c.env.SQUARE_LOCATION_ID,
    { order_id: body.order_id as string | undefined, source_id: body.source_id as string | undefined, test_mode: !!body.test_mode },
    isAdmin,
    new Date(),
    new SupabaseAppLogStore(db)
  );
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});

paymentsRoute.post("/api/paypal_create.php", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const isAdmin = await isValidAdminToken(new SupabaseAdminAuthStore(db), c.req.header("X-Admin-Token"));
  const biz = await loadBiz(db, c.env.R2_PUBLIC);

  const result = await createPaypalOrderForCheckout(
    new SupabaseOrdersStore(db),
    createPaypalGateway(c.env.PAYPAL_CLIENT_ID, c.env.PAYPAL_SECRET, apiHosts(c.env).paypal),
    new SupabaseSettingsStore(db, c.env.R2_PUBLIC),
    biz.name,
    { order_id: body.order_id as string | undefined, test_mode: !!body.test_mode },
    isAdmin,
    new SupabaseAppLogStore(db)
  );
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});

paymentsRoute.post("/api/paypal_capture.php", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const isAdmin = await isValidAdminToken(new SupabaseAdminAuthStore(db), c.req.header("X-Admin-Token"));
  const biz = await loadBiz(db, c.env.R2_PUBLIC);

  const result = await capturePaypalOrderForCheckout(
    new SupabaseOrdersStore(db),
    createPaypalGateway(c.env.PAYPAL_CLIENT_ID, c.env.PAYPAL_SECRET, apiHosts(c.env).paypal),
    new SupabaseCustomersStore(db),
    new SupabaseSettingsStore(db, c.env.R2_PUBLIC),
    new SupabaseEmailOrderStore(db),
    createEmailSender(c.env.EMAIL_MODE, c.env.BREVO_API_KEY, biz.name),
    biz,
    {
      order_id: body.order_id as string | undefined,
      paypal_order_id: body.paypal_order_id as string | undefined,
      test_mode: !!body.test_mode,
    },
    isAdmin,
    new Date(),
    new SupabaseAppLogStore(db)
  );
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});

// Square calls this directly (not through apiFetch/CORS) — a raw POST with its own HMAC
// signature header, so this route reads the raw body itself rather than c.req.json().
paymentsRoute.post("/api/square-webhook.php", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("X-Square-HmacSha256-Signature") ?? "";
  const callbackUrl = `${new URL(c.req.url).origin}/api/square-webhook.php`;

  if (!c.env.SQUARE_WEBHOOK_SIG_KEY) return c.text("Webhook key not configured", 500);
  if (!(await verifySquareWebhookSignature(rawBody, signature, c.env.SQUARE_WEBHOOK_SIG_KEY, callbackUrl))) {
    return c.text(signature ? "Invalid signature" : "Missing signature", 403);
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.text("Invalid payload", 400);
  }
  if (!event || typeof event !== "object" || !("type" in event)) return c.text("Missing event type", 400);

  const db = createDb(c.env);
  await handleSquareWebhookEvent(new SupabaseOrdersStore(db), event as Parameters<typeof handleSquareWebhookEvent>[1], new SupabaseAppLogStore(db));

  return c.text("OK", 200);
});
