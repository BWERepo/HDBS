// Hono route for POST /api/contact.php.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseContactStore, SupabaseSettingsStore } from "../db";
import { submitContactForm } from "../contact";
import { resolveBizProfile } from "../lib/biz-profile";
import { createEmailSender } from "../lib/email-sender";

export const contactRoute = new Hono<{ Bindings: Env }>();

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

contactRoute.post("/api/contact.php", async (c) => {
  const db = createDb(c.env);
  const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
  const ip = c.req.header("CF-Connecting-IP") ?? "";

  const bizProfileRaw = await new SupabaseSettingsStore(db).getSetting("biz_profile");
  const bizName = resolveBizProfile(bizProfileRaw).name;

  const result = await submitContactForm(
    new SupabaseContactStore(db),
    createEmailSender(c.env.EMAIL_MODE),
    bizName,
    { name: body.name as string | undefined, email: body.email as string | undefined, subject: body.subject as string | undefined, message: body.message as string | undefined },
    await sha256Hex(`contact_${ip}`)
  );
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});
