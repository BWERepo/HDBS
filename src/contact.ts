// Contact form: ports api/contact.php. Validation, HTML email template, and the rate limit are
// pure/testable business logic; the actual send is delegated to an EmailSender (see
// lib/email-sender.ts's header for why full Resend integration isn't built here).

import { escapeHtml } from "./lib/html-escape";
import type { EmailSender } from "./lib/email-sender";

export interface ContactResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface ContactInput {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
}

export interface ContactStore {
  getRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null>;
  setRateLimit(key: string, attempts: number, lastAt: number): Promise<void>;
  logEmail(entry: { emailType: string; sentTo: string; subject: string; status: "sent" | "failed" | "sink"; body: string }): Promise<void>;
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 900;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Ports api/contact.php's inline HTML template, byte-for-byte structure (colors/layout match
 *  the gold/brown palette used across every transactional email in this codebase). */
export function buildContactEmailHtml(bizName: string, name: string, email: string, subject: string, message: string): string {
  const n = escapeHtml(name);
  const e = escapeHtml(email);
  const s = escapeHtml(subject);
  const m = escapeHtml(message);
  const b = escapeHtml(bizName);
  return `<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#fffdf0;font-family:sans-serif'>
<div style='max-width:560px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:linear-gradient(135deg,#a07810,#d4a017);padding:24px 28px;text-align:center'>
    <div style='color:#fff;font-size:20px;font-style:italic;font-weight:600'>${b}</div>
    <div style='color:rgba(255,255,255,.85);font-size:13px;margin-top:4px'>New Contact Form Message</div>
  </div>
  <div style='padding:24px 28px'>
    <table style='width:100%;font-size:14px;color:#2d2220;border-collapse:collapse;margin-bottom:20px'>
      <tr><td style='padding:5px 0;color:#6b6040;width:70px'>From</td><td style='padding:5px 0;font-weight:600'>${n}</td></tr>
      <tr><td style='padding:5px 0;color:#6b6040'>Email</td><td style='padding:5px 0'><a href='mailto:${e}' style='color:#a07810'>${e}</a></td></tr>
      <tr><td style='padding:5px 0;color:#6b6040'>Subject</td><td style='padding:5px 0'>${s}</td></tr>
    </table>
    <div style='background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:16px;font-size:14px;color:#2d2220;line-height:1.7;white-space:pre-wrap'>${m}</div>
    <div style='margin-top:20px;padding:12px 16px;background:#fff8e1;border:1px solid #e8d070;border-radius:8px;font-size:13px;color:#7a5f00'>
      Click the email address above to respond directly to ${n}
    </div>
  </div>
  <div style='background:#2d2220;padding:14px 28px;text-align:center'>
    <div style='color:rgba(255,255,255,.5);font-size:12px'>${b} &nbsp;&middot;&nbsp; Knoxville, TN</div>
  </div>
</div>
</body></html>`;
}

/** Ports api/contact.php's whole POST action. `rateLimitKey` is the caller's per-IP key. */
export async function submitContactForm(
  store: ContactStore,
  sender: EmailSender,
  bizName: string,
  input: ContactInput,
  rateLimitKey: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<ContactResult<{ message: string }>> {
  const row = (await store.getRateLimit(rateLimitKey)) ?? { attempts: 0, lastAt: 0 };
  if (row.attempts >= RATE_LIMIT_MAX && now - row.lastAt < RATE_LIMIT_WINDOW_SECONDS) {
    const mins = Math.ceil((RATE_LIMIT_WINDOW_SECONDS - (now - row.lastAt)) / 60);
    return { ok: false, error: `Too many requests. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, status: 429 };
  }
  const attempts = row.attempts >= RATE_LIMIT_MAX ? 1 : row.attempts + 1;
  await store.setRateLimit(rateLimitKey, attempts, now);

  const name = (input.name ?? "").trim();
  const email = (input.email ?? "").trim();
  const subject = (input.subject ?? "").trim() || "Message from Website";
  const message = (input.message ?? "").trim();

  if (!name || !email || !message) return { ok: false, error: "Name, email and message are required" };
  if (!isValidEmail(email)) return { ok: false, error: "Invalid email address" };

  const to = "handmadedesignsbysuzi@yahoo.com";
  const fullSubject = `Website Contact: ${subject || "New Message"} — ${name}`;
  const html = buildContactEmailHtml(bizName, name, email, subject, message);

  const result = await sender.send(to, fullSubject, html);
  await store.logEmail({ emailType: "Contact Form", sentTo: to, subject: fullSubject, status: result.status, body: html });

  if (result.sent) return { ok: true, data: { message: "Message sent" } };
  return { ok: false, error: "Failed to send — please email us directly at handmadedesignsbysuzi@yahoo.com", status: 500 };
}
