// EMAIL_MODE dispatch + the actual live-send call. Extracted because contact.ts, studio.ts, and
// now email.ts's order-confirmation resend all need to send an outbound email, and none should
// duplicate this decision or the logo-splice/CRLF-guard contract mailer.php's sendEmail()
// applies to literally everything.
//
// mailer.php's sendEmail() splices the logo and strips CR/LF UNCONDITIONALLY, and does so via a
// by-reference $html mutation — the caller's own variable changes, so anything logged to
// email_log afterward reflects the spliced version, not the pre-logo template. That's why the
// splice/strip happen HERE, centrally, and why EmailSendResult returns the final `html` for the
// caller to log — the TS equivalent of PHP's by-reference mutation.
//
// Sending domain per the migration plan: mail.handmadedesignsbysuzi.com (not the apex — isolates
// reputation from Hostinger mail), Reply-To the real mailbox so replies still reach Suzi.
//
// ── Resend -> Brevo, 2026-08-01 ──
// Originally built against Resend, but Resend's free tier caps an account at one verified
// sending domain, and this Cloudflare/Resend account already had one from a sibling project — a
// second domain needs a $20/mo plan upgrade. Brevo's free plan has no such per-account domain cap
// (confirmed by actually adding a second domain via their API, not by reading marketing copy) and
// covers this project's volume (300 emails/day free), so `LiveEmailSender` now calls Brevo's
// `POST /v3/smtp/email` instead of Resend's `/emails`. `BREVO_API_KEY` replaces `RESEND_API_KEY`
// in `Env`; `mail.handmadedesignsbysuzi.com` is authenticated and verified on Brevo, confirmed
// with a real test send (Brevo's own event log showed requests -> delivered -> opened).

import { spliceLogoHeader, stripCrlf } from "./email-format";

export interface EmailSendResult {
  sent: boolean;
  status: "sent" | "failed" | "sink";
  /** The actual HTML that was (or would be) sent — logo-spliced. Log this, not the pre-splice
   *  template, so email_log reflects what a recipient actually saw. */
  html: string;
}

export interface EmailSender {
  send(to: string | string[], subject: string, html: string): Promise<EmailSendResult>;
}

export class SinkEmailSender implements EmailSender {
  async send(_to: string | string[], _subject: string, html: string): Promise<EmailSendResult> {
    return { sent: true, status: "sink", html: spliceLogoHeader(html) };
  }
}

const SEND_FROM_ADDRESS = "orders@mail.handmadedesignsbysuzi.com";
const REPLY_TO = "handmadedesignsbysuzi@yahoo.com";

export class LiveEmailSender implements EmailSender {
  constructor(
    private apiKey: string,
    private fromName: string
  ) {}

  async send(to: string | string[], subject: string, html: string): Promise<EmailSendResult> {
    const finalHtml = spliceLogoHeader(html);
    const safeTo = (Array.isArray(to) ? to : [to]).map(stripCrlf);
    const safeSubject = stripCrlf(subject);
    const safeFromName = stripCrlf(this.fromName);

    try {
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: { name: safeFromName, email: SEND_FROM_ADDRESS },
          to: safeTo.map((email) => ({ email })),
          replyTo: { email: REPLY_TO },
          subject: safeSubject,
          htmlContent: finalHtml,
        }),
      });
      return { sent: res.ok, status: res.ok ? "sent" : "failed", html: finalHtml };
    } catch {
      return { sent: false, status: "failed", html: finalHtml };
    }
  }
}

export function createEmailSender(emailMode: "live" | "sink", apiKey: string, fromName: string): EmailSender {
  return emailMode === "sink" ? new SinkEmailSender() : new LiveEmailSender(apiKey, fromName);
}
