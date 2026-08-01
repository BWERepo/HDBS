// Hono route for GET/POST /api/db_backup.php — token-gated (not the admin session token; a
// separate long-lived `backup_token`, matching the PHP exactly, since this exists specifically
// for local tooling like the /BWEHDBSBackup skill to pull a copy without an interactive login).
//
// Ports the PHP's `?download=1` mode only. The plain (no `download`) mode in the PHP emails the
// dump as an attachment via sendEmailWithAttachment() — this codebase's EmailSender
// (src/lib/email-sender.ts) has no attachment support yet (nothing else ported so far has needed
// it), so that mode is deferred rather than shipped half-working with a message that claims an
// attachment exists when it doesn't. Download is also the mode the PHP's own comment calls out as
// the one that actually matters ("the only way to get the dump text at all").

import { Hono, type Context } from "hono";
import type { Env } from "../types";
import { fail, timingSafeEqual } from "../lib/http";
import { createDb, SupabaseSettingsStore, SupabaseDbBackupStore } from "../db";
import { getSettingValue } from "../settings";
import { buildDatabaseBackup, serializeBackupAsJson } from "../db-backup";

export const dbBackupRoute = new Hono<{ Bindings: Env }>();

async function serveBackup(c: Context<{ Bindings: Env }>, token: string): Promise<Response> {
  const db = createDb(c.env);
  const settings = new SupabaseSettingsStore(db, c.env.R2_PUBLIC);

  const stored = await getSettingValue(settings, "backup_token", true);
  if (!stored.ok || !stored.data?.value) return fail(c, "Forbidden", 403);
  if (!token || !timingSafeEqual(token, stored.data.value)) return fail(c, "Forbidden", 403);

  const backup = await buildDatabaseBackup(new SupabaseDbBackupStore(db));
  const json = serializeBackupAsJson(backup);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="hdbs-backup-${date}.json"`,
    },
  });
}

dbBackupRoute.get("/api/db_backup.php", (c) => serveBackup(c, c.req.query("token") ?? ""));

dbBackupRoute.post("/api/db_backup.php", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  return serveBackup(c, (body.token as string | undefined) ?? c.req.query("token") ?? "");
});
