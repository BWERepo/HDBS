// Hono routes for /api/capital_equipment.php and /api/business_docs.php. Both are entirely
// admin-gated in the PHP.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseCapitalEquipmentStore, R2BusinessDocsFileStore, SupabaseSettingsStore } from "../db";
import { isValidAdminToken } from "../auth";
import {
  listCapitalEquipment,
  addCapitalEquipment,
  updateCapitalEquipment,
  deleteCapitalEquipment,
  uploadCapitalEquipmentReceipt,
  downloadCapitalEquipmentReceipt,
  deleteCapitalEquipmentReceipt,
  listBusinessDocs,
  uploadBusinessDoc,
  downloadBusinessDoc,
  deleteBusinessDoc,
} from "../business";

export const businessRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

function fileResponse(bytes: Uint8Array, mime: string, dispositionName: string): Response {
  return new Response(bytes, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${dispositionName}"`,
      "Content-Length": String(bytes.length),
    },
  });
}

// ── capital_equipment.php ──

businessRoute.get("/api/capital_equipment.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const db = createDb(c.env);
  const result = await listCapitalEquipment(new SupabaseCapitalEquipmentStore(db, c.env.R2_PRIVATE));
  return ok(c, result.data);
});

businessRoute.post("/api/capital_equipment.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const db = createDb(c.env);
  const store = new SupabaseCapitalEquipmentStore(db, c.env.R2_PRIVATE);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "upload_receipt") {
    const result = await uploadCapitalEquipmentReceipt(store, Number(body.id ?? 0), String(body.data ?? ""), String(body.filename ?? ""));
    return result.ok ? ok(c, { message: "Receipt uploaded" }) : fail(c, result.error!, result.status);
  }
  if (action === "download_receipt") {
    const result = await downloadCapitalEquipmentReceipt(store, Number(body.id ?? 0));
    if (!result.ok) return fail(c, result.error!, result.status);
    return fileResponse(result.data!.bytes, result.data!.mime, result.data!.dispositionName);
  }
  if (action === "delete_receipt") {
    const result = await deleteCapitalEquipmentReceipt(store, Number(body.id ?? 0));
    return result.ok ? ok(c, { message: "Receipt removed" }) : fail(c, result.error!, result.status);
  }

  const result = await addCapitalEquipment(store, String(body.description ?? ""), String(body.purchase_date ?? ""), Number(body.purchase_price ?? 0));
  return result.ok ? ok(c, { message: "Item added", id: result.data!.id }) : fail(c, result.error!, result.status);
});

businessRoute.put("/api/capital_equipment.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await updateCapitalEquipment(
    new SupabaseCapitalEquipmentStore(createDb(c.env), c.env.R2_PRIVATE),
    Number(body.id ?? 0),
    String(body.description ?? ""),
    String(body.purchase_date ?? ""),
    Number(body.purchase_price ?? 0)
  );
  return result.ok ? ok(c, { message: "Item updated" }) : fail(c, result.error!, result.status);
});

businessRoute.delete("/api/capital_equipment.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await deleteCapitalEquipment(new SupabaseCapitalEquipmentStore(createDb(c.env), c.env.R2_PRIVATE), Number(body.id ?? 0));
  return result.ok ? ok(c, { message: "Item deleted" }) : fail(c, result.error!, result.status);
});

// ── business_docs.php — single action-dispatch endpoint, POST-only in the PHP (list included) ──

businessRoute.post("/api/business_docs.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const db = createDb(c.env);
  const settingsStore = new SupabaseSettingsStore(db);
  const fileStore = new R2BusinessDocsFileStore(c.env.R2_PRIVATE);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const action = typeof body.action === "string" ? body.action : "";

  switch (action) {
    case "list": {
      const result = await listBusinessDocs(settingsStore);
      return ok(c, result.data);
    }
    case "upload": {
      const result = await uploadBusinessDoc(settingsStore, fileStore, String(body.doc_type ?? ""), String(body.data ?? ""), String(body.filename ?? ""));
      return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
    }
    case "download": {
      const result = await downloadBusinessDoc(settingsStore, fileStore, String(body.doc_type ?? ""));
      if (!result.ok) return fail(c, result.error!, result.status);
      return fileResponse(result.data!.bytes, result.data!.mime, result.data!.dispositionName);
    }
    case "delete": {
      const result = await deleteBusinessDoc(settingsStore, fileStore, String(body.doc_type ?? ""));
      return result.ok ? ok(c, { message: "Deleted" }) : fail(c, result.error!, result.status);
    }
    default:
      return fail(c, "Unknown action", 400);
  }
});
