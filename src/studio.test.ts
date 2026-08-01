import { describe, it, expect, beforeEach } from "vitest";
import {
  ensureStudioSeeded,
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
  buildInquiryEmailHtml,
  StudioStoreFake,
} from "./studio";
import type { EmailSender, EmailSendResult } from "./lib/email-sender";
import { SettingsStoreFake } from "./settings";

class FakeEmailSender implements EmailSender {
  result: EmailSendResult = { sent: true, status: "sink" };
  async send(): Promise<EmailSendResult> {
    return this.result;
  }
}

let store: StudioStoreFake;
let settings: SettingsStoreFake;
let sender: FakeEmailSender;

beforeEach(() => {
  store = new StudioStoreFake();
  settings = new SettingsStoreFake();
  sender = new FakeEmailSender();
});

describe("ensureStudioSeeded / getStudioPage", () => {
  it("seeds 7 services and 10 faqs when empty", async () => {
    await ensureStudioSeeded(store);
    expect(await store.countItemsBySection("service")).toBe(7);
    expect(await store.countItemsBySection("faq")).toBe(10);
  });

  it("does not reseed if service items already exist", async () => {
    await store.insertItem({ section: "service", title: "Existing", data: "{}", sort_order: 0 });
    await ensureStudioSeeded(store);
    expect(await store.countItemsBySection("service")).toBe(1);
  });

  it("orders items by section priority, then sort_order, then id", async () => {
    await store.insertItem({ section: "faq", title: "F", data: null, sort_order: 0 });
    await store.insertItem({ section: "service", title: "S2", data: null, sort_order: 1 });
    await store.insertItem({ section: "service", title: "S1", data: null, sort_order: 0 });
    const result = await getStudioPage(store, settings);
    expect(result.data?.items.map((i) => i.title)).toEqual(["S1", "S2", "F"]);
  });

  it("coerces active to 0/1, and parses data JSON", async () => {
    await store.insertItem({ section: "service", title: "S", data: JSON.stringify({ desc: "hi" }), sort_order: 0 });
    const result = await getStudioPage(store, settings);
    const item = result.data!.items[0]!;
    expect(item.active).toBe(1);
    expect(item.data).toEqual({ desc: "hi" });
  });

  it("returns null config when studio_config is unset, parsed config otherwise", async () => {
    const before = await getStudioPage(store, settings);
    expect(before.data?.config).toBeNull();
    await settings.setSetting("studio_config", JSON.stringify({ hero: { headline: "Hi" } }));
    const after = await getStudioPage(store, settings);
    expect(after.data?.config).toEqual({ hero: { headline: "Hi" } });
  });
});

describe("submitStudioInquiry", () => {
  it("requires name, email, and description", async () => {
    expect((await submitStudioInquiry(store, sender, "Biz", { email: "a@x.com", description: "d" }, "k", "1.2.3.4")).ok).toBe(false);
    expect((await submitStudioInquiry(store, sender, "Biz", { name: "N", description: "d" }, "k", "1.2.3.4")).ok).toBe(false);
    expect((await submitStudioInquiry(store, sender, "Biz", { name: "N", email: "a@x.com" }, "k", "1.2.3.4")).ok).toBe(false);
  });

  it("rejects an invalid email", async () => {
    const result = await submitStudioInquiry(store, sender, "Biz", { name: "N", email: "bad", description: "d" }, "k", "1.2.3.4");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid email/);
  });

  it("stores the inquiry and always succeeds even if the email send fails", async () => {
    sender.result = { sent: false, status: "failed" };
    const result = await submitStudioInquiry(store, sender, "Biz", { name: "Jane", email: "a@x.com", description: "A quilt" }, "k", "1.2.3.4");
    expect(result.ok).toBe(true);
    expect(store.inquiries).toHaveLength(1);
    expect(store.emailLogs[0]!.status).toBe("failed");
  });

  it("computes a due_date from 'two weeks' or 'a month' timeline phrases", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    await submitStudioInquiry(store, sender, "Biz", { name: "A", email: "a@x.com", description: "d", timeline: "in about two weeks" }, "k1", "1.1.1.1", now);
    await submitStudioInquiry(store, sender, "Biz", { name: "B", email: "b@x.com", description: "d", timeline: "within a month" }, "k2", "1.1.1.1", now);
    await submitStudioInquiry(store, sender, "Biz", { name: "C", email: "c@x.com", description: "d", timeline: "no rush" }, "k3", "1.1.1.1", now);
    expect(store.inquiries[0]!.due_date).toBe("2026-01-15");
    expect(store.inquiries[1]!.due_date).toBe("2026-01-31");
    expect(store.inquiries[2]!.due_date).toBeNull();
  });

  it("records the client IP", async () => {
    await submitStudioInquiry(store, sender, "Biz", { name: "A", email: "a@x.com", description: "d" }, "k", "9.9.9.9");
    expect(store.inquiries[0]!.ip).toBe("9.9.9.9");
  });

  it("defaults status to 'inquiry'", async () => {
    await submitStudioInquiry(store, sender, "Biz", { name: "A", email: "a@x.com", description: "d" }, "k", "1.1.1.1");
    expect(store.inquiries[0]!.status).toBe("inquiry");
  });

  it("rate limits at 5 per 15 minutes per key", async () => {
    const now = new Date(1000 * 1000);
    for (let i = 0; i < 5; i++) {
      const result = await submitStudioInquiry(store, sender, "Biz", { name: "A", email: "a@x.com", description: "d" }, "sameKey", "1.1.1.1", now);
      expect(result.ok).toBe(true);
    }
    const blocked = await submitStudioInquiry(store, sender, "Biz", { name: "A", email: "a@x.com", description: "d" }, "sameKey", "1.1.1.1", new Date(now.getTime() + 5000));
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe(429);
  });
});

describe("buildInquiryEmailHtml", () => {
  it("escapes fields and includes inspiration picks/links when present", () => {
    const html = buildInquiryEmailHtml("Biz", {
      name: "<b>Jane</b>",
      email: "jane@example.com",
      phone: "555-1234",
      projectType: "Quilt",
      budget: "$100",
      timeline: "two weeks",
      description: "A memory quilt",
      inspiration: { picks: [{ id: "p1", title: "Tote", image: "http://x/img.jpg" }], links: "http://example.com" },
    });
    expect(html).not.toContain("<b>Jane</b>");
    expect(html).toContain("&lt;b&gt;Jane&lt;/b&gt;");
    expect(html).toContain("Inspiration picks");
    expect(html).toContain("http://example.com");
  });
});

describe("listStudioInquiries", () => {
  it("groups notes by project, newest first, with formatted timestamps", async () => {
    const id = await store.insertInquiry({
      name: "A", email: "a@x.com", phone: "", project_type: "", budget: "", timeline: "",
      description: "d", contact_pref: "", inspiration: null, status: "inquiry", ip: "", due_date: null,
    });
    await store.insertNote(id, "First note");
    await store.insertNote(id, "Second note");
    const result = await listStudioInquiries(store);
    const inquiry = result.data!.inquiries[0]! as { notes: { note_text: string }[] };
    expect(inquiry.notes.map((n) => n.note_text)).toEqual(["Second note", "First note"]);
  });

  it("parses inspiration JSON back into an object", async () => {
    await store.insertInquiry({
      name: "A", email: "a@x.com", phone: "", project_type: "", budget: "", timeline: "",
      description: "d", contact_pref: "", inspiration: JSON.stringify({ links: "x" }), status: "inquiry", ip: "", due_date: null,
    });
    const result = await listStudioInquiries(store);
    expect((result.data!.inquiries[0] as { inspiration: unknown }).inspiration).toEqual({ links: "x" });
  });
});

describe("saveStudioItem", () => {
  it("rejects an invalid section", async () => {
    const result = await saveStudioItem(store, { section: "bogus", title: "T" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid section/);
  });

  it("requires a title", async () => {
    const result = await saveStudioItem(store, { section: "service", title: "" });
    expect(result.ok).toBe(false);
  });

  it("creates a new item when no id is given", async () => {
    const result = await saveStudioItem(store, { section: "gallery", title: "New Gallery Item" });
    expect(result.ok).toBe(true);
    expect(store.items).toHaveLength(1);
    expect(store.items[0]!.title).toBe("New Gallery Item");
  });

  it("updates an existing item when an id is given", async () => {
    const created = await saveStudioItem(store, { section: "gallery", title: "Original" });
    await saveStudioItem(store, { section: "gallery", id: created.data!.id, title: "Updated" });
    expect(store.items).toHaveLength(1);
    expect(store.items[0]!.title).toBe("Updated");
  });

  it("passes through an already-URL image unchanged", async () => {
    const result = await saveStudioItem(store, { section: "gallery", title: "T", image: "https://example.com/img.jpg" });
    expect(result.ok).toBe(true);
    expect(store.items[0]!.image).toBe("https://example.com/img.jpg");
  });

  it("rejects a data: URL image (upload not yet wired to R2)", async () => {
    const result = await saveStudioItem(store, { section: "gallery", title: "T", image: "data:image/jpeg;base64,abc" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not yet available/);
  });
});

describe("deleteStudioItem / reorderStudioItems", () => {
  it("deleteStudioItem requires an id", async () => {
    expect((await deleteStudioItem(store, 0)).ok).toBe(false);
  });

  it("reorderStudioItems sets sort_order to each id's position", async () => {
    const a = await store.insertItem({ section: "gallery", title: "A", data: null, sort_order: 0 });
    const b = await store.insertItem({ section: "gallery", title: "B", data: null, sort_order: 1 });
    await reorderStudioItems(store, [b, a]);
    expect(store.items.find((i) => i.id === a)!.sort_order).toBe(1);
    expect(store.items.find((i) => i.id === b)!.sort_order).toBe(0);
  });
});

describe("saveStudioConfig", () => {
  it("requires a config object", async () => {
    expect((await saveStudioConfig(settings, null)).ok).toBe(false);
  });

  it("saves the config as JSON", async () => {
    await saveStudioConfig(settings, { hero: { headline: "Hi" } });
    expect(JSON.parse((await settings.getSetting("studio_config"))!)).toEqual({ hero: { headline: "Hi" } });
  });

  it("rejects a data: URL hero image", async () => {
    const result = await saveStudioConfig(settings, { hero: { image: "data:image/jpeg;base64,abc" } });
    expect(result.ok).toBe(false);
  });
});

describe("inquiry admin actions", () => {
  it("setInquiryStatus validates the status against the known list", async () => {
    const id = await store.insertInquiry({
      name: "A", email: "a@x.com", phone: "", project_type: "", budget: "", timeline: "",
      description: "d", contact_pref: "", inspiration: null, status: "inquiry", ip: "", due_date: null,
    });
    expect((await setInquiryStatus(store, id, "bogus")).ok).toBe(false);
    expect((await setInquiryStatus(store, id, "started")).ok).toBe(true);
    expect(store.inquiries[0]!.status).toBe("started");
  });

  it("setInquiryDueDate validates YYYY-MM-DD format, and clears with an empty string", async () => {
    const id = await store.insertInquiry({
      name: "A", email: "a@x.com", phone: "", project_type: "", budget: "", timeline: "",
      description: "d", contact_pref: "", inspiration: null, status: "inquiry", ip: "", due_date: null,
    });
    expect((await setInquiryDueDate(store, id, "not-a-date")).ok).toBe(false);
    expect((await setInquiryDueDate(store, id, "2026-08-01")).ok).toBe(true);
    expect(store.inquiries[0]!.due_date).toBe("2026-08-01");
    await setInquiryDueDate(store, id, "");
    expect(store.inquiries[0]!.due_date).toBeNull();
  });

  it("deleteStudioProject cascades its notes", async () => {
    const id = await store.insertInquiry({
      name: "A", email: "a@x.com", phone: "", project_type: "", budget: "", timeline: "",
      description: "d", contact_pref: "", inspiration: null, status: "inquiry", ip: "", due_date: null,
    });
    await store.insertNote(id, "Note");
    await deleteStudioProject(store, id);
    expect(store.inquiries).toEqual([]);
    expect(store.notes).toEqual([]);
  });

  it("addStudioNote requires project_id and note_text, and returns the formatted note", async () => {
    const id = await store.insertInquiry({
      name: "A", email: "a@x.com", phone: "", project_type: "", budget: "", timeline: "",
      description: "d", contact_pref: "", inspiration: null, status: "inquiry", ip: "", due_date: null,
    });
    expect((await addStudioNote(store, 0, "text")).ok).toBe(false);
    expect((await addStudioNote(store, id, "")).ok).toBe(false);
    const result = await addStudioNote(store, id, "A real note");
    expect(result.ok).toBe(true);
    expect(result.data?.note.note_text).toBe("A real note");
  });

  it("deleteStudioNote requires an id", async () => {
    expect((await deleteStudioNote(store, 0)).ok).toBe(false);
  });
});
