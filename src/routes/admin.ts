// Hono route for POST /api/admin.php — action-dispatch, exactly like the PHP file it replaces.
//
// The front end is NOT being rewritten (js/auth.js:159 calls apiFetch('admin.php', 'POST',
// {action:'login', ...})), so this stays a single path with an `action` field in the body rather
// than becoming REST-per-action. Only the actions ported so far (src/auth.ts, src/settings.ts)
// are wired, along with the admin log viewer (read_log/clear_log/get_error_log, backed by
// src/app-log.ts's app_log table — see that file's header for why a real table exists at all).
// Every other admin.php action (get_version, github_token, smtp, db browser — the last one the
// migration plan recommends dropping entirely) is still TODO and returns 501 so it's visibly
// unimplemented rather than a bare 404 that looks like a routing bug.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseSettingsStore, SupabaseAppLogStore } from "../db";
import * as auth from "../auth";
import { getSettingValue, setSettingValue } from "../settings";
import { readLog, clearLog, getErrorLog } from "../app-log";

export const adminRoute = new Hono<{ Bindings: Env }>();

function adminToken(c: { req: { header(name: string): string | undefined } }): string {
  return c.req.header("X-Admin-Token") ?? "";
}

adminRoute.post("/api/admin.php", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const action = typeof body.action === "string" ? body.action : "";
  const db = createDb(c.env);
  const authStore = new SupabaseAdminAuthStore(db);

  switch (action) {
    case "login": {
      const result = await auth.login(authStore, String(body.password ?? ""));
      return result.ok ? ok(c, { token: result.data!.token }) : fail(c, result.error!, result.status);
    }

    case "logout": {
      await auth.logout(authStore, adminToken(c));
      return ok(c, { message: "Logged out" });
    }

    case "change_password": {
      const result = await auth.changePassword(
        authStore,
        adminToken(c),
        String(body.current ?? ""),
        String(body.next ?? ""),
        String(body.confirm ?? "")
      );
      return result.ok ? ok(c, { message: "Password changed" }) : fail(c, result.error!, result.status);
    }

    case "get_sec_question": {
      const result = await auth.getSecurityQuestion(authStore);
      return result.ok ? ok(c, { question: result.data!.question }) : fail(c, result.error!, result.status);
    }

    case "verify_sec_answer":
    case "reset_password": {
      const verified = await auth.verifySecurityAnswer(authStore, String(body.answer ?? ""));
      if (!verified.ok) return fail(c, verified.error!, verified.status);
      if (action === "verify_sec_answer") return ok(c, { message: "Verified" });
      const reset = await auth.resetPasswordViaSecurityAnswer(authStore, String(body.new_password ?? ""));
      return reset.ok ? ok(c, { message: "Password reset" }) : fail(c, reset.error!, reset.status);
    }

    case "save_sec_question": {
      const result = await auth.saveSecurityQuestion(
        authStore,
        String(body.question ?? ""),
        String(body.answer ?? ""),
        String(body.answer2 ?? "")
      );
      return result.ok ? ok(c, { message: "Security question saved" }) : fail(c, result.error!, result.status);
    }

    case "get_setting": {
      const key = String(body.key ?? "");
      const isAdmin = await auth.isValidAdminToken(authStore, adminToken(c));
      const settingsStore = new SupabaseSettingsStore(db, c.env.R2_PUBLIC);
      const result = await getSettingValue(settingsStore, key, isAdmin);
      return result.ok ? ok(c, { value: result.data!.value }) : fail(c, result.error!, result.status);
    }

    case "set_setting":
    case "save_setting": {
      if (!(await auth.isValidAdminToken(authStore, adminToken(c)))) {
        return fail(c, "Session expired. Please log in again.", 401);
      }
      const key = String(body.key ?? "");
      const value = String(body.value ?? "");
      const settingsStore = new SupabaseSettingsStore(db, c.env.R2_PUBLIC);
      const result = await setSettingValue(settingsStore, key, value);
      if (!result.ok) return fail(c, result.error!, result.status);
      // Matches api/admin.php:284's version_updated_at stamp on either version field.
      if (key === "major_version" || key === "minor_version") {
        await settingsStore.setSetting("version_updated_at", new Date().toISOString());
      }
      return ok(c, { message: "Setting saved" });
    }

    case "read_log": {
      if (!(await auth.isValidAdminToken(authStore, adminToken(c)))) {
        return fail(c, "Session expired. Please log in again.", 401);
      }
      const result = await readLog(new SupabaseAppLogStore(db), String(body.file ?? ""));
      return result.ok ? ok(c, result.data!) : fail(c, result.error!, result.status);
    }

    case "clear_log": {
      if (!(await auth.isValidAdminToken(authStore, adminToken(c)))) {
        return fail(c, "Session expired. Please log in again.", 401);
      }
      const result = await clearLog(new SupabaseAppLogStore(db), String(body.file ?? ""));
      return result.ok ? ok(c, { message: "Log cleared" }) : fail(c, result.error!, result.status);
    }

    case "get_error_log": {
      if (!(await auth.isValidAdminToken(authStore, adminToken(c)))) {
        return fail(c, "Session expired. Please log in again.", 401);
      }
      const result = await getErrorLog(new SupabaseAppLogStore(db));
      return result.ok ? ok(c, result.data!) : fail(c, result.error!, result.status);
    }

    default:
      return fail(c, `Action "${action}" not yet ported`, 501);
  }
});
