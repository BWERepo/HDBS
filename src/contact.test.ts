import { describe, it, expect, beforeEach } from "vitest";
import { submitContactForm, buildContactEmailHtml, type ContactStore } from "./contact";
import type { EmailSender, EmailSendResult } from "./lib/email-sender";

class ContactStoreFake implements ContactStore {
  rateLimits = new Map<string, { attempts: number; lastAt: number }>();
  logs: { emailType: string; sentTo: string; subject: string; status: string; body: string }[] = [];

  async getRateLimit(key: string) {
    return this.rateLimits.get(key) ?? null;
  }
  async setRateLimit(key: string, attempts: number, lastAt: number) {
    this.rateLimits.set(key, { attempts, lastAt });
  }
  async logEmail(entry: { emailType: string; sentTo: string; subject: string; status: "sent" | "failed" | "sink"; body: string }) {
    this.logs.push(entry);
  }
}

class FakeEmailSender implements EmailSender {
  result: EmailSendResult = { sent: true, status: "sink", html: "" };
  sentTo: string | null = null;
  async send(to: string): Promise<EmailSendResult> {
    this.sentTo = to;
    return this.result;
  }
}

let store: ContactStoreFake;
let sender: FakeEmailSender;

beforeEach(() => {
  store = new ContactStoreFake();
  sender = new FakeEmailSender();
});

describe("buildContactEmailHtml", () => {
  it("escapes HTML in every field to prevent injection", () => {
    const html = buildContactEmailHtml("Biz", "<script>alert(1)</script>", "e@x.com", "s", "m");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes the message body and a mailto link", () => {
    const html = buildContactEmailHtml("Biz", "Jane", "jane@example.com", "Question", "Hello there");
    expect(html).toContain("Hello there");
    expect(html).toContain("mailto:jane@example.com");
  });
});

describe("submitContactForm", () => {
  it("requires name, email, and message", async () => {
    expect((await submitContactForm(store, sender, "Biz", { name: "", email: "a@x.com", message: "hi" }, "k")).ok).toBe(false);
    expect((await submitContactForm(store, sender, "Biz", { name: "Jane", email: "", message: "hi" }, "k")).ok).toBe(false);
    expect((await submitContactForm(store, sender, "Biz", { name: "Jane", email: "a@x.com", message: "" }, "k")).ok).toBe(false);
  });

  it("rejects an invalid email", async () => {
    const result = await submitContactForm(store, sender, "Biz", { name: "Jane", email: "not-an-email", message: "hi" }, "k");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid email/);
  });

  it("defaults subject to 'Message from Website'", async () => {
    await submitContactForm(store, sender, "Biz", { name: "Jane", email: "a@x.com", message: "hi" }, "k");
    expect(store.logs[0]!.subject).toContain("Message from Website");
  });

  it("sends successfully and logs the email", async () => {
    const result = await submitContactForm(store, sender, "Biz", { name: "Jane", email: "a@x.com", subject: "Hi", message: "hello" }, "k");
    expect(result.ok).toBe(true);
    expect(sender.sentTo).toBe("handmadedesignsbysuzi@yahoo.com");
    expect(store.logs).toHaveLength(1);
    expect(store.logs[0]!.status).toBe("sink");
  });

  it("reports failure (without throwing) when the sender fails, and still logs it", async () => {
    sender.result = { sent: false, status: "failed", html: "" };
    const result = await submitContactForm(store, sender, "Biz", { name: "Jane", email: "a@x.com", message: "hello" }, "k");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Failed to send/);
    expect(store.logs[0]!.status).toBe("failed");
  });

  it("rate limits at 5 per 15 minutes per key", async () => {
    const now = 1000;
    for (let i = 0; i < 5; i++) {
      const result = await submitContactForm(store, sender, "Biz", { name: "Jane", email: "a@x.com", message: "hello" }, "sameKey", now);
      expect(result.ok).toBe(true);
    }
    const blocked = await submitContactForm(store, sender, "Biz", { name: "Jane", email: "a@x.com", message: "hello" }, "sameKey", now + 5);
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe(429);
  });
});
