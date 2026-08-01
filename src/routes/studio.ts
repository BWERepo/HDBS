// Hono route for /api/studio.php — action-dispatch for POST, plain GET (public items+config,
// or admin ?action=inquiries), matching the PHP.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseStudioStore, SupabaseSettingsStore } from "../db";
import { isValidAdminToken } from "../auth";
import {
  getStudioPage,
  listStudioInquiries,
  submitStudioInquiry,
  saveStudioItem,
  deleteStudioItem,
  reorderStudioItems,
  saveStudioConfig,
  setInquiryStatus,
  setInquiryDueDate,
  deleteStudioProject,
  addStudioNote,
  deleteStudioNote,
} from "../studio";
import { resolveBizProfile } from "../lib/biz-profile";
import { createEmailSender } from "../lib/email-sender";

export const studioRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

studioRoute.get("/api/studio.php", async (c) => {
  const db = createDb(c.env);
  const store = new SupabaseStudioStore(db);

  if (c.req.query("action") === "inquiries") {
    if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
    const result = await listStudioInquiries(store);
    return ok(c, result.data);
  }

  const result = await getStudioPage(store, new SupabaseSettingsStore(db));
  return ok(c, result.data);
});

studioRoute.post("/api/studio.php", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const action = typeof body.action === "string" ? body.action : "";
  const store = new SupabaseStudioStore(db);

  if (action === "inquire") {
    const ip = c.req.header("CF-Connecting-IP") ?? "";
    const bizProfileRaw = await new SupabaseSettingsStore(db).getSetting("biz_profile");
    const bizName = resolveBizProfile(bizProfileRaw).name;
    const result = await submitStudioInquiry(
      store,
      createEmailSender(c.env.EMAIL_MODE, c.env.RESEND_API_KEY, bizName),
      bizName,
      {
        name: body.name as string | undefined,
        email: body.email as string | undefined,
        description: body.description as string | undefined,
        phone: body.phone as string | undefined,
        project_type: body.project_type as string | undefined,
        budget: body.budget as string | undefined,
        timeline: body.timeline as string | undefined,
        contact_pref: body.contact_pref as string | undefined,
        inspiration: (body.inspiration ?? null) as never,
      },
      await sha256Hex(`studio_${ip}`),
      ip
    );
    return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
  }

  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);

  switch (action) {
    case "save_item": {
      const result = await saveStudioItem(store, {
        section: body.section as string | undefined,
        id: body.id !== undefined ? Number(body.id) : undefined,
        title: body.title as string | undefined,
        data: body.data,
        sort_order: body.sort_order !== undefined ? Number(body.sort_order) : undefined,
        active: !!body.active,
        image: body.image as string | undefined,
      });
      return result.ok ? ok(c, { message: "Saved", id: result.data!.id }) : fail(c, result.error!, result.status);
    }
    case "delete_item": {
      const result = await deleteStudioItem(store, Number(body.id ?? 0));
      return result.ok ? ok(c, { message: "Deleted" }) : fail(c, result.error!, result.status);
    }
    case "reorder": {
      const result = await reorderStudioItems(store, Array.isArray(body.order) ? (body.order as (number | string)[]) : []);
      return result.ok ? ok(c, { message: "Order saved" }) : fail(c, result.error!, result.status);
    }
    case "save_config": {
      const result = await saveStudioConfig(new SupabaseSettingsStore(db), (body.config ?? null) as Record<string, unknown> | null);
      return result.ok ? ok(c, { message: "Page copy saved" }) : fail(c, result.error!, result.status);
    }
    case "inquiry_status": {
      const result = await setInquiryStatus(store, Number(body.id ?? 0), String(body.status ?? ""));
      return result.ok ? ok(c, { message: "Status updated" }) : fail(c, result.error!, result.status);
    }
    case "set_due_date": {
      const result = await setInquiryDueDate(store, Number(body.id ?? 0), String(body.due_date ?? ""));
      return result.ok ? ok(c, { message: "Due date updated" }) : fail(c, result.error!, result.status);
    }
    case "delete_project": {
      const result = await deleteStudioProject(store, Number(body.id ?? 0));
      return result.ok ? ok(c, { message: "Project deleted" }) : fail(c, result.error!, result.status);
    }
    case "add_note": {
      const result = await addStudioNote(store, Number(body.project_id ?? 0), String(body.note_text ?? ""));
      return result.ok ? ok(c, { message: "Note added", note: result.data!.note }) : fail(c, result.error!, result.status);
    }
    case "delete_note": {
      const result = await deleteStudioNote(store, Number(body.id ?? 0));
      return result.ok ? ok(c, { message: "Note deleted" }) : fail(c, result.error!, result.status);
    }
    default:
      return fail(c, "Unknown action", 400);
  }
});
