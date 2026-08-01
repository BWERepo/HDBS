// Hono route for /api/email_log.php. See src/ops.ts's header for why deploy_log.php and
// github_log.php aren't ported here.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseEmailLogStore } from "../db";
import { isValidAdminToken } from "../auth";
import { listEmailLog, logEmail, clearEmailLog } from "../ops";

export const opsRoute = new Hono<{ Bindings: Env }>();

async function requireAdmin(c: { env: Env; req: { header(name: string): string | undefined } }): Promise<boolean> {
  return isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token"));
}

opsRoute.get("/api/email_log.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const result = await listEmailLog(new SupabaseEmailLogStore(createDb(c.env)), {
    orderId: c.req.query("order_id") || undefined,
    type: c.req.query("type") || undefined,
  });
  return ok(c, result.data);
});

opsRoute.post("/api/email_log.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const result = await logEmail(new SupabaseEmailLogStore(createDb(c.env)), {
    email_type: body.email_type as string | undefined,
    sent_to: body.sent_to as string | undefined,
    order_id: body.order_id as string | undefined,
    subject: body.subject as string | undefined,
    status: body.status as string | undefined,
    error_msg: body.error_msg as string | undefined,
  });
  return result.ok ? ok(c, { message: "Logged" }) : fail(c, result.error!, result.status);
});

opsRoute.delete("/api/email_log.php", async (c) => {
  if (!(await requireAdmin(c))) return fail(c, "Unauthorized", 401);
  const result = await clearEmailLog(new SupabaseEmailLogStore(createDb(c.env)));
  return result.ok ? ok(c, { message: "Email log cleared" }) : fail(c, result.error!, result.status);
});
