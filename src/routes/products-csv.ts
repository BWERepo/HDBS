// Hono routes for GET/POST /api/products_csv.php — CSV export/import, admin-only.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseProductsStore } from "../db";
import { isValidAdminToken } from "../auth";
import { exportProductsCsv, importProductsCsv } from "../products-csv";

export const productsCsvRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

productsCsvRoute.get("/api/products_csv.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const store = new SupabaseProductsStore(createDb(c.env), c.env.R2_PUBLIC);
  const csv = await exportProductsCsv(store);
  const filename = `products_${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

productsCsvRoute.post("/api/products_csv.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("csv");
  if (!file || typeof file === "string") return fail(c, "No file uploaded");
  const mode = form?.get("mode") === "replace" ? "replace" : "merge";

  const store = new SupabaseProductsStore(createDb(c.env), c.env.R2_PUBLIC);
  const result = await importProductsCsv(store, await file.text(), mode);
  return result.ok ? ok(c, { imported: result.imported, mode: result.mode }) : fail(c, result.error!);
});
