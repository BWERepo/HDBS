// Hono routes for /api/reviews.php and /api/faqs.php.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseReviewsStore, SupabaseFaqsStore } from "../db";
import { isValidAdminToken } from "../auth";
import { listReviews, submitReview, updateReviewStatus, deleteReview, listFaqs, addFaq, updateFaq, reorderFaqs, deleteFaq } from "../content";

export const contentRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── reviews.php ──

contentRoute.get("/api/reviews.php", async (c) => {
  const admin = c.req.query("admin") === "1";
  if (admin && !(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const result = await listReviews(new SupabaseReviewsStore(createDb(c.env)), admin);
  return ok(c, result.data);
});

contentRoute.post("/api/reviews.php", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const ip = c.req.header("CF-Connecting-IP") ?? "";
  const result = await submitReview(new SupabaseReviewsStore(createDb(c.env)), await sha256Hex(`review_${ip}`), {
    customer_name: body.customer_name as string | undefined,
    product_name: body.product_name as string | undefined,
    rating: body.rating !== undefined ? Number(body.rating) : undefined,
    review_text: body.review_text as string | undefined,
  });
  return result.ok ? ok(c, { message: "Review submitted — thank you!" }) : fail(c, result.error!, result.status);
});

contentRoute.put("/api/reviews.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await updateReviewStatus(new SupabaseReviewsStore(createDb(c.env)), Number(body.id ?? 0), String(body.status ?? "approved"));
  return result.ok ? ok(c, { message: "Review updated" }) : fail(c, result.error!, result.status);
});

contentRoute.delete("/api/reviews.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await deleteReview(new SupabaseReviewsStore(createDb(c.env)), Number(body.id ?? 0));
  return result.ok ? ok(c, { message: "Review deleted" }) : fail(c, result.error!, result.status);
});

// ── faqs.php ──

contentRoute.get("/api/faqs.php", async (c) => {
  const result = await listFaqs(new SupabaseFaqsStore(createDb(c.env)));
  return ok(c, result.data);
});

contentRoute.post("/api/faqs.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const store = new SupabaseFaqsStore(createDb(c.env));
  if (body.action === "reorder") {
    const result = await reorderFaqs(store, Array.isArray(body.order) ? (body.order as (number | string)[]) : []);
    return result.ok ? ok(c, { message: "Order saved" }) : fail(c, result.error!, result.status);
  }
  const result = await addFaq(store, String(body.question ?? ""), String(body.answer ?? ""), Number(body.sort_order ?? 0));
  return result.ok ? ok(c, { message: "FAQ added" }) : fail(c, result.error!, result.status);
});

contentRoute.put("/api/faqs.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await updateFaq(new SupabaseFaqsStore(createDb(c.env)), Number(body.id ?? 0), String(body.question ?? ""), String(body.answer ?? ""));
  return result.ok ? ok(c, { message: "FAQ updated" }) : fail(c, result.error!, result.status);
});

contentRoute.delete("/api/faqs.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await deleteFaq(new SupabaseFaqsStore(createDb(c.env)), Number(body.id ?? 0));
  return result.ok ? ok(c, { message: "FAQ deleted" }) : fail(c, result.error!, result.status);
});
