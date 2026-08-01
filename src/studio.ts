// Design Studio: content items, page-copy config, and commission inquiries. Ports api/studio.php.
// Same store-interface + fake pattern as everywhere else.
//
// Deliberately deferred: studioSaveImage's actual file write (api/studio.php's studioSaveImage()
// saves a base64 upload to disk). Like products.ts/settings.ts's image uploads, this needs R2,
// not a verbatim port of disk-write code. A `data:` URL image value is rejected with a clear
// "not yet available" error for now; an already-URL value passes through unchanged (editing an
// item's text without touching its image keeps working).
//
// studio_seed.php is a stale, unused duplicate of the studioSeed()/table-DDL that's ALSO defined
// inline in studio.php itself (studio.php never requires studio_seed.php) — ported from the
// inline version (studio.php's), which is the one actually running, not the file-level duplicate.

import { escapeHtml } from "./lib/html-escape";
import type { EmailSender } from "./lib/email-sender";
import type { SettingsStore } from "./settings";

export const STUDIO_SECTIONS = ["service", "gallery", "project", "testimonial", "faq"] as const;
export type StudioSection = (typeof STUDIO_SECTIONS)[number];
export const PROJECT_STATUSES = ["inquiry", "started", "in_progress", "completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

const SECTION_ORDER: Record<string, number> = Object.fromEntries(STUDIO_SECTIONS.map((s, i) => [s, i]));

export interface StudioItemRow {
  id: number;
  section: string;
  title: string;
  data: string | null;
  image: string;
  sort_order: number;
  active: boolean;
  created_at: string | null;
}

export interface StudioItemDto {
  id: number;
  section: string;
  title: string;
  data: unknown;
  image: string;
  sort_order: number;
  active: 0 | 1;
}

export interface StudioInquiryRow {
  id: number;
  created_at: string | null;
  name: string;
  email: string;
  phone: string;
  project_type: string;
  budget: string;
  timeline: string;
  description: string | null;
  contact_pref: string;
  inspiration: string | null;
  status: string;
  ip: string;
  due_date: string | null;
}

export interface StudioNoteRow {
  id: number;
  project_id: number;
  note_text: string;
  created_at: string | null;
}

export interface StudioResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface StudioStore {
  listItems(): Promise<StudioItemRow[]>;
  countItemsBySection(section: string): Promise<number>;
  insertItem(row: Pick<StudioItemRow, "section" | "title" | "data" | "sort_order">): Promise<number>;
  updateItem(id: number, fields: Partial<Pick<StudioItemRow, "title" | "data" | "image" | "sort_order" | "active">>): Promise<void>;
  updateItemSortOrder(id: number, sortOrder: number): Promise<void>;
  deleteItem(id: number): Promise<void>;

  listInquiries(): Promise<StudioInquiryRow[]>;
  listAllNotes(): Promise<StudioNoteRow[]>;
  insertInquiry(row: Omit<StudioInquiryRow, "id" | "created_at">): Promise<number>;
  updateInquiryStatus(id: number, status: string): Promise<void>;
  updateInquiryDueDate(id: number, dueDate: string | null): Promise<void>;
  deleteInquiry(id: number): Promise<void>; // cascades notes, per the FK
  insertNote(projectId: number, noteText: string): Promise<StudioNoteRow>;
  deleteNote(id: number): Promise<void>;

  getRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null>;
  setRateLimit(key: string, attempts: number, lastAt: number): Promise<void>;
  logEmail(entry: { emailType: string; sentTo: string; subject: string; status: "sent" | "failed" | "sink"; body: string }): Promise<void>;
}

const INQUIRY_RATE_LIMIT_MAX = 5;
const INQUIRY_RATE_LIMIT_WINDOW_SECONDS = 900;

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Ports dsFormatNoteTime: UTC -> America/New_York, 'M j, Y g:i A' (e.g. "Jul 3, 2026 1:37 PM"). */
function formatNoteTime(utcDatetime: string | null): string {
  if (!utcDatetime) return "";
  const d = new Date(utcDatetime);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")} ${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

/** Ports dsDefaultDueDate: a starting point from the customer's chosen timeline phrase. */
function defaultDueDate(timeline: string, now: Date = new Date()): string | null {
  const t = timeline.toLowerCase();
  let days: number | null = null;
  if (t.includes("two weeks")) days = 14;
  else if (t.includes("a month")) days = 30;
  if (days === null) return null;
  const d = new Date(now.getTime() + days * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function toItemDto(row: StudioItemRow): StudioItemDto {
  let parsed: unknown = [];
  if (row.data) {
    try {
      parsed = JSON.parse(row.data);
    } catch {
      parsed = [];
    }
  }
  return { id: row.id, section: row.section, title: row.title, data: parsed, image: row.image, sort_order: row.sort_order, active: row.active ? 1 : 0 };
}

/** Ensures the starter service/FAQ content exists (idempotent — checked by count, matching the
 *  PHP's studioSeed()). Placeholder copy only; galleries/projects/testimonials are never seeded. */
export async function ensureStudioSeeded(store: StudioStore): Promise<void> {
  if ((await store.countItemsBySection("service")) === 0) {
    const services: [string, string, string, string][] = [
      ["Custom Tote Bags", "Handcrafted tote bags made from premium fabrics, including one-of-a-kind themed designs.", "Everyday use, gifts, shopping, travel, and special occasions.", "Corvette, floral, seasonal, patriotic, and personalized designs."],
      ["Crossbody Bags", "Stylish, lightweight bags designed for everyday convenience and hands-free carrying.", "Travel, festivals, shopping, and daily use.", "Compact crossbody bags with zipper pockets and adjustable straps."],
      ["Custom Bags", "Handmade bags in a variety of styles beyond totes and crossbodies, built around your fabric and features.", "Handbags, wristlets, pouches, and everyday carry.", "A quilted wristlet, a zippered pouch set, or a one-of-a-kind handbag."],
      ["Custom Quilts", "Beautiful handmade quilts created for family heirlooms, gifts, and everyday comfort.", "Weddings, baby showers, anniversaries, and home décor.", "Lap quilts, baby quilts, memory quilts, and seasonal designs."],
      ["Custom Embroidery", "Personalize bags, towels, blankets, hats, and more with names, monograms, or custom designs.", "Birthdays, weddings, businesses, and personalized gifts.", "Monograms, custom names, logos, and decorative embroidery."],
      ["Memory Keepsakes", "Transform meaningful clothing or fabric into treasured keepsakes you'll cherish for years.", "Memorial gifts, baby clothes, graduation shirts, and family memories.", "T-shirt quilts, memory pillows, keepsake bags, and embroidered remembrance gifts."],
      ["Custom Sewing Projects", "Have an idea? Let's create something completely unique just for you.", "Special requests and custom commissions.", "If you can imagine it, we'll work together to bring it to life."],
    ];
    for (const [i, [title, desc, ideal, example]] of services.entries()) {
      await store.insertItem({ section: "service", title, data: JSON.stringify({ desc, ideal, example }), sort_order: i });
    }
  }

  if ((await store.countItemsBySection("faq")) === 0) {
    const faqs: [string, string][] = [
      ["How much does a custom commission cost?", "Every project is quoted individually based on size, materials, and the time involved. After you share your idea, Suzi will send a clear quote before any work begins — no surprises."],
      ["How long will my project take?", "Timelines vary by project type and current workload. You'll get an estimated completion date with your quote, and Suzi keeps you updated at every stage."],
      ["Can I request changes during the process?", "Yes. Every commission includes a refinement stage where you review the work in progress and request adjustments before final delivery."],
      ["Who owns the finished artwork?", "You receive the finished piece, and for design work the print and usage rights are agreed up front. Suzi may share photos of the work in her portfolio unless you ask otherwise."],
      ["Do you ship?", "Yes — finished pieces are carefully packed and shipped to you. Local pickup or delivery may also be available in the Knoxville, TN area."],
      ["Can I get digital files?", "For design work like logos and branding you'll receive the standard digital files you need. Digital copies of artwork are available on request."],
      ["Can you make something that isn't listed here?", "Almost certainly. If it's creative, just ask — custom requests are the heart of the Design Studio."],
      ["What happens in the consultation?", "A friendly conversation — by email, phone, or text, whichever you prefer — about your vision, budget, and timeline. There's no commitment until you approve the quote."],
      ["How does payment work?", "Payment details are agreed along with your quote — typically a portion up front with the balance on completion. Options are discussed during the consultation."],
      ["What is it like working together?", "Personal and collaborative. You work one-on-one with Suzi from first idea to final delivery, and she reads and answers every message herself."],
    ];
    for (const [i, [question, answer]] of faqs.entries()) {
      await store.insertItem({ section: "faq", title: question, data: JSON.stringify({ answer }), sort_order: i });
    }
  }
}

/** Ports api/studio.php's public GET action: seeded items + page-copy config. */
export async function getStudioPage(
  store: StudioStore,
  settingsStore: Pick<SettingsStore, "getSetting">
): Promise<StudioResult<{ items: StudioItemDto[]; config: unknown }>> {
  await ensureStudioSeeded(store);
  const rows = await store.listItems();
  const items = rows
    .slice()
    .sort((a, b) => (SECTION_ORDER[a.section] ?? 99) - (SECTION_ORDER[b.section] ?? 99) || a.sort_order - b.sort_order || a.id - b.id)
    .map(toItemDto);
  const cfgRaw = await settingsStore.getSetting("studio_config");
  let config: unknown = null;
  if (cfgRaw) {
    try {
      config = JSON.parse(cfgRaw);
    } catch {
      config = null;
    }
  }
  return { ok: true, data: { items, config } };
}

/** Ports api/studio.php's admin GET ?action=inquiries. Caller must have already required admin. */
export async function listStudioInquiries(store: StudioStore): Promise<StudioResult<{ inquiries: Record<string, unknown>[] }>> {
  const [rows, notes] = await Promise.all([store.listInquiries(), store.listAllNotes()]);
  const notesByProject = new Map<number, { id: number; note_text: string; created_at: string }[]>();
  for (const n of notes.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id - a.id)) {
    const list = notesByProject.get(n.project_id) ?? [];
    list.push({ id: n.id, note_text: n.note_text, created_at: formatNoteTime(n.created_at) });
    notesByProject.set(n.project_id, list);
  }

  const inquiries = rows
    .slice()
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.id - a.id)
    .map((r) => ({
      ...r,
      inspiration: r.inspiration ? (safeJsonParse(r.inspiration) ?? null) : null,
      notes: notesByProject.get(r.id) ?? [],
    }));
  return { ok: true, data: { inquiries } };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface InquiryInput {
  name?: string;
  email?: string;
  description?: string;
  phone?: string;
  project_type?: string;
  budget?: string;
  timeline?: string;
  contact_pref?: string;
  inspiration?: { picks?: { id?: string; title?: string; image?: string }[]; links?: string } | null;
}

/** Ports api/studio.php's `action=inquire`. Public. Reuses contact.ts's email-notification shape. */
export async function submitStudioInquiry(
  store: StudioStore,
  sender: EmailSender,
  bizName: string,
  input: InquiryInput,
  rateLimitKey: string,
  clientIp: string,
  now: Date = new Date()
): Promise<StudioResult<{ message: string }>> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const row = (await store.getRateLimit(rateLimitKey)) ?? { attempts: 0, lastAt: 0 };
  if (row.attempts >= INQUIRY_RATE_LIMIT_MAX && nowSec - row.lastAt < INQUIRY_RATE_LIMIT_WINDOW_SECONDS) {
    const mins = Math.ceil((INQUIRY_RATE_LIMIT_WINDOW_SECONDS - (nowSec - row.lastAt)) / 60);
    return { ok: false, error: `Too many requests. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, status: 429 };
  }
  const attempts = row.attempts >= INQUIRY_RATE_LIMIT_MAX ? 1 : row.attempts + 1;
  await store.setRateLimit(rateLimitKey, attempts, nowSec);

  const name = (input.name ?? "").trim();
  const email = (input.email ?? "").trim();
  const description = (input.description ?? "").trim();
  if (!name || !email || !description) return { ok: false, error: "Name, email and a project description are required" };
  if (!isValidEmail(email)) return { ok: false, error: "Invalid email address" };

  const phone = (input.phone ?? "").trim();
  const projectType = (input.project_type ?? "").trim();
  const budget = (input.budget ?? "").trim();
  const timeline = (input.timeline ?? "").trim();
  const contactPref = (input.contact_pref ?? "").trim();
  const inspiration = input.inspiration ?? null;

  const newId = await store.insertInquiry({
    name,
    email,
    phone,
    project_type: projectType,
    budget,
    timeline,
    description,
    contact_pref: contactPref,
    inspiration: inspiration ? JSON.stringify(inspiration) : null,
    status: "inquiry",
    ip: clientIp,
    due_date: defaultDueDate(timeline, now),
  });

  const to = "handmadedesignsbysuzi@yahoo.com";
  const fullSubject = `Design Studio Inquiry: ${projectType || "New Project"} — ${name}`;
  const html = buildInquiryEmailHtml(bizName, { name, email, phone, projectType, budget, timeline, description, inspiration });
  const result = await sender.send(to, fullSubject, html);
  await store.logEmail({ emailType: "Studio Inquiry", sentTo: to, subject: fullSubject, status: result.status, body: html });

  // The inquiry is stored either way — don't fail the visitor if only the email relay hiccuped.
  return { ok: true, data: { message: "Inquiry received" } };
}

/** Ports api/studio.php's inquiry-notification HTML template. */
export function buildInquiryEmailHtml(
  bizName: string,
  fields: {
    name: string;
    email: string;
    phone: string;
    projectType: string;
    budget: string;
    timeline: string;
    description: string;
    inspiration: InquiryInput["inspiration"];
  }
): string {
  const b = escapeHtml(bizName);
  const n = escapeHtml(fields.name);
  const e = escapeHtml(fields.email);
  const desc = escapeHtml(fields.description);

  let picksHtml = "";
  if (fields.inspiration?.picks?.length) {
    for (const p of fields.inspiration.picks) {
      const pt = escapeHtml(p.title ?? "");
      const pim = escapeHtml(p.image ?? "");
      picksHtml += `<div style='display:inline-block;margin:4px;text-align:center'>${
        pim ? `<img src='${pim}' width='64' height='64' style='object-fit:cover;border-radius:8px;display:block'>` : ""
      }<div style='font-size:11px;color:#6b6040;max-width:72px'>${pt}</div></div>`;
    }
  }
  const linksTxt = escapeHtml((fields.inspiration?.links ?? "").trim());

  const rows = [
    `<tr><td style='padding:5px 0;color:#6b6040;width:110px'>From</td><td style='padding:5px 0;font-weight:600'>${n}</td></tr>`,
    `<tr><td style='padding:5px 0;color:#6b6040'>Email</td><td style='padding:5px 0'><a href='mailto:${e}' style='color:#a07810'>${e}</a></td></tr>`,
    fields.phone ? `<tr><td style='padding:5px 0;color:#6b6040'>Phone</td><td style='padding:5px 0'>${escapeHtml(fields.phone)}</td></tr>` : "",
    fields.projectType ? `<tr><td style='padding:5px 0;color:#6b6040'>Project type</td><td style='padding:5px 0'>${escapeHtml(fields.projectType)}</td></tr>` : "",
    fields.budget ? `<tr><td style='padding:5px 0;color:#6b6040'>Budget</td><td style='padding:5px 0'>${escapeHtml(fields.budget)}</td></tr>` : "",
    fields.timeline ? `<tr><td style='padding:5px 0;color:#6b6040'>Timeline</td><td style='padding:5px 0'>${escapeHtml(fields.timeline)}</td></tr>` : "",
  ].join("");

  return `<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:0;background:#fffdf0;font-family:sans-serif'>
<div style='max-width:560px;margin:30px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:linear-gradient(135deg,#a07810,#d4a017);padding:24px 28px;text-align:center'>
    <div style='color:#fff;font-size:20px;font-style:italic;font-weight:600'>${b}</div>
    <div style='color:rgba(255,255,255,.85);font-size:13px;margin-top:4px'>New Design Studio Inquiry</div>
  </div>
  <div style='padding:24px 28px'>
    <table style='width:100%;font-size:14px;color:#2d2220;border-collapse:collapse;margin-bottom:20px'>${rows}</table>
    <div style='background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:16px;font-size:14px;color:#2d2220;line-height:1.7;white-space:pre-wrap'>${desc}</div>${
      picksHtml ? `<div style='margin-top:14px'><div style='font-size:12px;color:#6b6040;margin-bottom:4px'>Inspiration picks</div>${picksHtml}</div>` : ""
    }${
      linksTxt ? `<div style='margin-top:14px;font-size:13px;color:#2d2220'><span style='color:#6b6040'>Inspiration links:</span><br>${linksTxt}</div>` : ""
    }
    <div style='margin-top:20px;padding:12px 16px;background:#fff8e1;border:1px solid #e8d070;border-radius:8px;font-size:13px;color:#7a5f00'>
      Click the email address above to respond directly to ${n}. This inquiry is also saved in the back office under Design Studio &gt; Inquiries.
    </div>
  </div>
  <div style='background:#2d2220;padding:14px 28px;text-align:center'>
    <div style='color:rgba(255,255,255,.5);font-size:12px'>${b} &nbsp;&middot;&nbsp; Knoxville, TN</div>
  </div>
</div>
</body></html>`;
}

// ── Admin content management ──

export interface SaveItemInput {
  section?: string;
  id?: number;
  title?: string;
  data?: unknown;
  sort_order?: number;
  active?: boolean;
  image?: string;
}

/** Resolves an image field the way api/studio.php's studioSaveImage() did, minus the actual file
 *  write (see this file's header — that needs R2, not a verbatim port). */
function resolveImage(value: string | undefined): { ok: true; url: string } | { ok: false; error: string } {
  if (!value) return { ok: true, url: "" };
  if (!value.startsWith("data:image")) return { ok: true, url: value }; // already a URL
  return { ok: false, error: "Image upload not yet available on this environment — pending R2 wiring" };
}

/** Ports api/studio.php's `action=save_item`. Caller must have already required admin. */
export async function saveStudioItem(store: StudioStore, input: SaveItemInput): Promise<StudioResult<{ id: number }>> {
  const section = input.section ?? "";
  if (!(STUDIO_SECTIONS as readonly string[]).includes(section)) return { ok: false, error: "Invalid section" };
  const title = (input.title ?? "").trim();
  if (!title) return { ok: false, error: "Title is required" };

  const dataJson = JSON.stringify(input.data ?? []);
  const sortOrder = Number(input.sort_order ?? 0);
  const active = !!input.active;

  const image = resolveImage(input.image);
  if (!image.ok) return { ok: false, error: image.error };

  let id = input.id ?? 0;
  if (!id) {
    id = await store.insertItem({ section, title, data: dataJson, sort_order: sortOrder });
  }
  await store.updateItem(id, { title, data: dataJson, image: image.url, sort_order: sortOrder, active });
  return { ok: true, data: { id } };
}

/** Ports api/studio.php's `action=delete_item`. Caller must have already required admin. Image
 *  file cleanup is skipped (no R2 wiring for uploads yet, so nothing to clean up in practice). */
export async function deleteStudioItem(store: StudioStore, id: number): Promise<StudioResult> {
  if (!id) return { ok: false, error: "Missing id" };
  await store.deleteItem(id);
  return { ok: true };
}

/** Ports api/studio.php's `action=reorder`. Caller must have already required admin. */
export async function reorderStudioItems(store: StudioStore, order: (number | string)[]): Promise<StudioResult> {
  for (let i = 0; i < order.length; i++) {
    await store.updateItemSortOrder(Number(order[i]), i);
  }
  return { ok: true };
}

/** Ports api/studio.php's `action=save_config`. Caller must have already required admin. */
export async function saveStudioConfig(
  settingsStore: Pick<SettingsStore, "setSetting">,
  config: Record<string, unknown> | null
): Promise<StudioResult> {
  if (!config || typeof config !== "object") return { ok: false, error: "Missing config" };
  const hero = config.hero as { image?: string } | undefined;
  if (hero?.image) {
    const resolved = resolveImage(hero.image);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    hero.image = resolved.url;
  }
  await settingsStore.setSetting("studio_config", JSON.stringify(config));
  return { ok: true };
}

/** Ports api/studio.php's `action=inquiry_status`. Caller must have already required admin. */
export async function setInquiryStatus(store: StudioStore, id: number, status: string): Promise<StudioResult> {
  if (!id || !(PROJECT_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Missing id or invalid status" };
  await store.updateInquiryStatus(id, status);
  return { ok: true };
}

/** Ports api/studio.php's `action=set_due_date`. Caller must have already required admin. */
export async function setInquiryDueDate(store: StudioStore, id: number, dueDate: string): Promise<StudioResult> {
  if (!id) return { ok: false, error: "Missing id" };
  const trimmed = dueDate.trim();
  if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ok: false, error: "Invalid date" };
  await store.updateInquiryDueDate(id, trimmed || null);
  return { ok: true };
}

/** Ports api/studio.php's `action=delete_project`. Caller must have already required admin. */
export async function deleteStudioProject(store: StudioStore, id: number): Promise<StudioResult> {
  if (!id) return { ok: false, error: "Missing id" };
  await store.deleteInquiry(id); // cascades notes, per the FK
  return { ok: true };
}

/** Ports api/studio.php's `action=add_note`. Caller must have already required admin. */
export async function addStudioNote(
  store: StudioStore,
  projectId: number,
  noteText: string
): Promise<StudioResult<{ note: { id: number; note_text: string; created_at: string } }>> {
  const text = noteText.trim();
  if (!projectId || !text) return { ok: false, error: "Missing project_id or note_text" };
  const note = await store.insertNote(projectId, text);
  return { ok: true, data: { note: { id: note.id, note_text: note.note_text, created_at: formatNoteTime(note.created_at) } } };
}

/** Ports api/studio.php's `action=delete_note`. Caller must have already required admin. */
export async function deleteStudioNote(store: StudioStore, id: number): Promise<StudioResult> {
  if (!id) return { ok: false, error: "Missing id" };
  await store.deleteNote(id);
  return { ok: true };
}

// ── In-memory test double ──
export class StudioStoreFake implements StudioStore {
  items: StudioItemRow[] = [];
  inquiries: StudioInquiryRow[] = [];
  notes: StudioNoteRow[] = [];
  rateLimits = new Map<string, { attempts: number; lastAt: number }>();
  emailLogs: { emailType: string; sentTo: string; subject: string; status: string; body: string }[] = [];
  private nextItemId = 1;
  private nextInquiryId = 1;
  private nextNoteId = 1;

  async listItems(): Promise<StudioItemRow[]> {
    return this.items;
  }
  async countItemsBySection(section: string): Promise<number> {
    return this.items.filter((i) => i.section === section).length;
  }
  async insertItem(row: Pick<StudioItemRow, "section" | "title" | "data" | "sort_order">): Promise<number> {
    const id = this.nextItemId++;
    this.items.push({ id, image: "", active: true, created_at: new Date().toISOString(), ...row });
    return id;
  }
  async updateItem(id: number, fields: Partial<Pick<StudioItemRow, "title" | "data" | "image" | "sort_order" | "active">>): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (item) Object.assign(item, fields);
  }
  async updateItemSortOrder(id: number, sortOrder: number): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (item) item.sort_order = sortOrder;
  }
  async deleteItem(id: number): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id);
  }

  async listInquiries(): Promise<StudioInquiryRow[]> {
    return this.inquiries;
  }
  async listAllNotes(): Promise<StudioNoteRow[]> {
    return this.notes;
  }
  async insertInquiry(row: Omit<StudioInquiryRow, "id" | "created_at">): Promise<number> {
    const id = this.nextInquiryId++;
    this.inquiries.push({ id, created_at: new Date().toISOString(), ...row });
    return id;
  }
  async updateInquiryStatus(id: number, status: string): Promise<void> {
    const inq = this.inquiries.find((i) => i.id === id);
    if (inq) inq.status = status;
  }
  async updateInquiryDueDate(id: number, dueDate: string | null): Promise<void> {
    const inq = this.inquiries.find((i) => i.id === id);
    if (inq) inq.due_date = dueDate;
  }
  async deleteInquiry(id: number): Promise<void> {
    this.inquiries = this.inquiries.filter((i) => i.id !== id);
    this.notes = this.notes.filter((n) => n.project_id !== id); // mirrors the real FK's cascade
  }
  async insertNote(projectId: number, noteText: string): Promise<StudioNoteRow> {
    const note: StudioNoteRow = { id: this.nextNoteId++, project_id: projectId, note_text: noteText, created_at: new Date().toISOString() };
    this.notes.push(note);
    return note;
  }
  async deleteNote(id: number): Promise<void> {
    this.notes = this.notes.filter((n) => n.id !== id);
  }

  async getRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null> {
    return this.rateLimits.get(key) ?? null;
  }
  async setRateLimit(key: string, attempts: number, lastAt: number): Promise<void> {
    this.rateLimits.set(key, { attempts, lastAt });
  }
  async logEmail(entry: { emailType: string; sentTo: string; subject: string; status: "sent" | "failed" | "sink"; body: string }): Promise<void> {
    this.emailLogs.push(entry);
  }
}
