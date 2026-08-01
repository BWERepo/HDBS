// Hono route for GET /api/products.php — the public/admin shared catalog read.
//
// POST (create/update) and DELETE are not wired yet — they carry the base64 product-image upload
// logic that needs rewriting against R2, not a verbatim port (see src/products.ts's header).

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseProductsStore } from "../db";
import { isValidAdminToken } from "../auth";
import { listProducts } from "../products";

export const productsRoute = new Hono<{ Bindings: Env }>();

productsRoute.get("/api/products.php", async (c) => {
  const db = createDb(c.env);
  const isAdmin = await isValidAdminToken(new SupabaseAdminAuthStore(db), c.req.header("X-Admin-Token"));
  const products = await listProducts(new SupabaseProductsStore(db), isAdmin);
  return ok(c, { products });
});

productsRoute.on(["POST", "DELETE"], "/api/products.php", (c) =>
  fail(c, "Not yet ported — pending R2 image handling", 501)
);
