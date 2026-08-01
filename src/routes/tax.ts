// Hono routes for GET/POST/DELETE /api/tn_city_tax.php and GET/POST/PUT/DELETE
// /api/tax_sweep.php. See src/tax.ts's header for what's deliberately not ported
// (fetch_tax.php, tn_tax.php).

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseTaxStore } from "../db";
import { isValidAdminToken } from "../auth";
import { listCities, saveCity, deleteCity, getPendingSweep, getSweepHistory, createSweep, editSweep, removeSweep } from "../tax";

export const taxRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

taxRoute.get("/api/tn_city_tax.php", async (c) => {
  const db = createDb(c.env);
  const search = c.req.query("search") ?? "";
  const result = await listCities(new SupabaseTaxStore(db), search);
  return ok(c, result.data);
});

taxRoute.post("/api/tn_city_tax.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const rate = body.tax_rate !== undefined ? Number(body.tax_rate) : null;
  const result = await saveCity(new SupabaseTaxStore(createDb(c.env)), String(body.city ?? ""), String(body.county ?? ""), rate);
  return result.ok ? ok(c, { city: body.city, county: body.county, tax_rate: rate }) : fail(c, result.error!, result.status);
});

taxRoute.delete("/api/tn_city_tax.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await deleteCity(new SupabaseTaxStore(createDb(c.env)), Number(body.id ?? 0));
  return result.ok ? ok(c, { deleted: body.id }) : fail(c, result.error!, result.status);
});

taxRoute.get("/api/tax_sweep.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const store = new SupabaseTaxStore(createDb(c.env));
  if (c.req.query("action") === "history") {
    const result = await getSweepHistory(store);
    return ok(c, result.data);
  }
  return ok(c, await getPendingSweep(store));
});

taxRoute.post("/api/tax_sweep.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await createSweep(new SupabaseTaxStore(createDb(c.env)), {
    order_ids: Array.isArray(body.order_ids) ? (body.order_ids as string[]) : [],
    count: body.count !== undefined ? Number(body.count) : undefined,
    total_tax: body.total_tax !== undefined ? Number(body.total_tax) : undefined,
    date_from: body.date_from as string | undefined,
    date_to: body.date_to as string | undefined,
    order_details: body.order_details,
  });
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});

taxRoute.put("/api/tax_sweep.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const fields: Record<string, unknown> = {};
  if (body.sweep_date !== undefined) fields.sweep_date = body.sweep_date;
  if (body.total_tax !== undefined) fields.total_tax = Number(body.total_tax);
  if (body.order_count !== undefined) fields.order_count = Number(body.order_count);
  const result = await editSweep(new SupabaseTaxStore(createDb(c.env)), Number(body.id ?? 0), fields);
  return result.ok ? ok(c, { updated: true }) : fail(c, result.error!, result.status);
});

taxRoute.delete("/api/tax_sweep.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await removeSweep(new SupabaseTaxStore(createDb(c.env)), Number(body.id ?? 0));
  return result.ok ? ok(c, { deleted: true }) : fail(c, result.error!, result.status);
});
