// EMAIL_MODE dispatch + the actual Resend call. Extracted because contact.ts, studio.ts, and now
// email.ts's order-confirmation resend all need to send an outbound email, and none should
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
// Requires RESEND_API_KEY + a verified sending domain, neither of which exist yet — the `live`
// path is real, working code, but genuinely untestable until those exist. `sink` mode (already
// running on staging) needs neither and is what every live-verification in this project has used
// so far.

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

const RESEND_FROM_ADDRESS = "orders@mail.handmadedesignsbysuzi.com";
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
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${safeFromName} <${RESEND_FROM_ADDRESS}>`,
          to: safeTo,
          reply_to: REPLY_TO,
          subject: safeSubject,
          html: finalHtml,
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
