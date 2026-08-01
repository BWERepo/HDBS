// Minimal EMAIL_MODE dispatch, extracted here because contact.ts's contact form AND studio.ts's
// commission-inquiry notification both need to send an outbound email, and neither should
// duplicate this decision.
//
// Full Resend integration (logo splice, templates, DKIM-aligned sending domain) is Phase 4's
// email.ts — deliberately not built here. What IS built: the EMAIL_MODE=sink path the plan
// describes ("render the full HTML, write the email_log row with status='sink', return success
// WITHOUT calling Resend"), which is genuinely usable today since staging already runs with
// EMAIL_MODE=sink and no RESEND_API_KEY exists yet. The 'live' path is a clearly-marked stub —
// wire it to Resend when email.ts lands; until then it correctly reports failure rather than
// silently pretending to send.

export interface EmailSendResult {
  sent: boolean;
  status: "sent" | "failed" | "sink";
}

export interface EmailSender {
  send(to: string, subject: string, html: string): Promise<EmailSendResult>;
}

export class SinkEmailSender implements EmailSender {
  async send(): Promise<EmailSendResult> {
    return { sent: true, status: "sink" };
  }
}

/** TODO(email.ts, Phase 4): call Resend. Until then, correctly reports failure — the email
 *  simply isn't sent — rather than claiming success for something that didn't happen. */
export class LiveEmailSender implements EmailSender {
  async send(): Promise<EmailSendResult> {
    return { sent: false, status: "failed" };
  }
}

export function createEmailSender(emailMode: "live" | "sink"): EmailSender {
  return emailMode === "sink" ? new SinkEmailSender() : new LiveEmailSender();
}
