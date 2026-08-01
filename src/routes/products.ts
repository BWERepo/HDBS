// Hono route for /api/products.php — GET (public/admin shared catalog read), POST (admin-only
// create/update, including the base64 image-upload path), DELETE (admin-only).

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseProductsStore } from "../db";
import { isValidAdminToken } from "../auth";
import { listProducts, saveProduct, deleteProduct, type ProductInput } from "../products";

export const productsRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

productsRoute.get("/api/products.php", async (c) => {
  const db = createDb(c.env);
  const isAdmin = await requireAdmin(c);
  const products = await listProducts(new SupabaseProductsStore(db, c.env.R2_PUBLIC), isAdmin);
  return ok(c, { products });
});

productsRoute.post("/api/products.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const store = new SupabaseProductsStore(createDb(c.env), c.env.R2_PUBLIC);
  const input = await c.req.json().catch(() => ({}) as ProductInput);
  const result = await saveProduct(store, input);
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});

productsRoute.delete("/api/products.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const store = new SupabaseProductsStore(createDb(c.env), c.env.R2_PUBLIC);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await deleteProduct(store, String(body.id ?? ""));
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});
