// Business records: ports api/capital_equipment.php (equipment ledger + receipt upload) and
// api/business_docs.php (resale certificate / business license upload). Entirely admin-gated in
// the PHP — every action here assumes the caller has already required admin.
//
// Both receipt/document files go to R2_PRIVATE: no public URL, admin-gated only, reproducing the
// PHP's above-webroot storage (../capital_equipment_receipts/, ../business_documents/). Unlike
// products.ts/studio.ts's deferred image uploads, this IS fully implemented — R2_PRIVATE already
// exists (auto-provisioned alongside R2_PUBLIC) and there's no external dependency blocking it.
//
// business_docs.php's metadata is a JSON blob in the `settings` table (key 'biz_documents'), not
// a dedicated table — reuses settings.ts's SettingsStore rather than a new one.

import type { SettingsStore } from "./settings";

export interface CapitalEquipmentRow {
  id: number;
  description: string;
  purchase_date: string;
  purchase_price: number;
  receipt_filename: string | null;
  receipt_orig_name: string | null;
  created_at: string | null;
}

export interface CapitalEquipmentDto {
  id: number;
  description: string;
  purchase_date: string;
  purchase_price: number;
  has_receipt: boolean;
  receipt_orig_name: string;
}

export interface BusinessResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface CapitalEquipmentStore {
  listItems(): Promise<CapitalEquipmentRow[]>;
  getItem(id: number): Promise<CapitalEquipmentRow | null>;
  insertItem(description: string, purchaseDate: string, price: number): Promise<number>;
  updateItem(id: number, description: string, purchaseDate: string, price: number): Promise<void>;
  deleteItem(id: number): Promise<void>;
  setReceiptMeta(id: number, filename: string | null, origName: string | null): Promise<void>;

  putReceiptFile(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getReceiptFile(key: string): Promise<Uint8Array | null>;
  deleteReceiptFile(key: string): Promise<void>;
}

// ── Shared file-upload helpers (also used by business_docs below) ──

export type DetectedFileType = "pdf" | "jpg" | "png";

/** Decodes a `data:<mime>;base64,<data>` URL, capping at `maxBytes`. Pure/testable — no R2/DOM
 *  dependency. */
export function decodeDataUrl(dataUrl: string, maxBytes: number): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return { ok: false, error: "Invalid file data" };
  let binary: string;
  try {
    binary = atob(m[2]!);
  } catch {
    return { ok: false, error: "Could not decode file" };
  }
  if (binary.length === 0) return { ok: false, error: "Could not decode file" };
  if (binary.length > maxBytes) return { ok: false, error: `File too large (max ${Math.round(maxBytes / (1024 * 1024))}MB)` };
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { ok: true, bytes };
}

/** Validates by magic bytes, not the client-reported mime type — same three formats every
 *  upload path in this codebase accepts (products, studio, business docs, receipts). */
export function detectFileType(bytes: Uint8Array): DetectedFileType | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf"; // %PDF
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}

export function mimeForFileType(type: DetectedFileType): string {
  return type === "pdf" ? "application/pdf" : type === "png" ? "image/png" : "image/jpeg";
}

/** Strips control characters and HTML/quote-significant characters — this value is later
 *  rendered in the admin UI and echoed in a Content-Disposition header. */
export function sanitizeFilename(name: string, fallback: string, maxLen = 200): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\x00-\x1F\x7F"'<>]/g, "").trim().slice(0, maxLen);
  return cleaned === "" ? fallback : cleaned;
}

/** Strips quote/CRLF characters for safe use in a Content-Disposition header value. */
export function sanitizeDispositionName(name: string): string {
  return name.replace(/["\r\n]/g, "");
}

// ── capital_equipment ──

function toItemDto(row: CapitalEquipmentRow): CapitalEquipmentDto {
  return {
    id: row.id,
    description: row.description,
    purchase_date: row.purchase_date,
    purchase_price: Number(row.purchase_price),
    has_receipt: !!row.receipt_filename,
    receipt_orig_name: row.receipt_orig_name ?? "",
  };
}

/** Ports api/capital_equipment.php's GET action. */
export async function listCapitalEquipment(store: CapitalEquipmentStore): Promise<BusinessResult<{ items: CapitalEquipmentDto[] }>> {
  const rows = await store.listItems();
  return { ok: true, data: { items: rows.map(toItemDto) } };
}

/** Ports api/capital_equipment.php's POST (add) action. */
export async function addCapitalEquipment(
  store: CapitalEquipmentStore,
  description: string,
  purchaseDate: string,
  price: number
): Promise<BusinessResult<{ id: number }>> {
  const desc = description.trim();
  const date = purchaseDate.trim();
  if (!desc || !date || !(price > 0)) return { ok: false, error: "Description, purchase date, and a price greater than zero are required" };
  const id = await store.insertItem(desc, date, price);
  return { ok: true, data: { id } };
}

/** Ports api/capital_equipment.php's PUT action. */
export async function updateCapitalEquipment(
  store: CapitalEquipmentStore,
  id: number,
  description: string,
  purchaseDate: string,
  price: number
): Promise<BusinessResult> {
  const desc = description.trim();
  const date = purchaseDate.trim();
  if (!id || !desc || !date || !(price > 0)) return { ok: false, error: "Missing fields" };
  await store.updateItem(id, desc, date, price);
  return { ok: true };
}

function receiptKey(row: Pick<CapitalEquipmentRow, "receipt_filename">): string | null {
  return row.receipt_filename ? `capital_equipment_receipts/${row.receipt_filename}` : null;
}

/** Ports api/capital_equipment.php's DELETE action (also removes the receipt file, if any). */
export async function deleteCapitalEquipment(store: CapitalEquipmentStore, id: number): Promise<BusinessResult> {
  if (!id) return { ok: false, error: "Missing id" };
  const row = await store.getItem(id);
  const key = row ? receiptKey(row) : null;
  if (key) await store.deleteReceiptFile(key);
  await store.deleteItem(id);
  return { ok: true };
}

/** Ports api/capital_equipment.php's `action=upload_receipt`. */
export async function uploadCapitalEquipmentReceipt(
  store: CapitalEquipmentStore,
  id: number,
  dataUrl: string,
  clientFilename: string,
  now: number = Date.now()
): Promise<BusinessResult> {
  if (!id) return { ok: false, error: "Missing id" };
  const decoded = decodeDataUrl(dataUrl, 5 * 1024 * 1024);
  if (!decoded.ok) return { ok: false, error: decoded.error, status: 400 };
  const type = detectFileType(decoded.bytes);
  if (!type) return { ok: false, error: "Only PDF, JPG, or PNG files are accepted", status: 400 };

  const row = await store.getItem(id);
  if (!row) return { ok: false, error: "Item not found", status: 404 };

  const oldKey = receiptKey(row);
  if (oldKey) await store.deleteReceiptFile(oldKey);

  const filename = `receipt_${id}_${now}.${type}`;
  await store.putReceiptFile(`capital_equipment_receipts/${filename}`, decoded.bytes, mimeForFileType(type));

  const origName = sanitizeFilename(clientFilename || "receipt", "receipt");
  await store.setReceiptMeta(id, filename, origName);
  return { ok: true };
}

/** Ports api/capital_equipment.php's `action=download_receipt`. */
export async function downloadCapitalEquipmentReceipt(
  store: CapitalEquipmentStore,
  id: number
): Promise<BusinessResult<{ bytes: Uint8Array; mime: string; dispositionName: string }>> {
  if (!id) return { ok: false, error: "Missing id" };
  const row = await store.getItem(id);
  if (!row?.receipt_filename) return { ok: false, error: "No receipt on file", status: 404 };
  const bytes = await store.getReceiptFile(`capital_equipment_receipts/${row.receipt_filename}`);
  if (!bytes) return { ok: false, error: "File not found", status: 404 };

  const ext = row.receipt_filename.split(".").pop()?.toLowerCase();
  const mime = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";
  const dispositionName = sanitizeDispositionName(row.receipt_orig_name || row.receipt_filename);
  return { ok: true, data: { bytes, mime, dispositionName } };
}

/** Ports api/capital_equipment.php's `action=delete_receipt` (item itself stays). */
export async function deleteCapitalEquipmentReceipt(store: CapitalEquipmentStore, id: number): Promise<BusinessResult> {
  if (!id) return { ok: false, error: "Missing id" };
  const row = await store.getItem(id);
  const key = row ? receiptKey(row) : null;
  if (key) await store.deleteReceiptFile(key);
  await store.setReceiptMeta(id, null, null);
  return { ok: true };
}

// ── business_docs (settings-blob metadata + R2_PRIVATE files) ──

export const BUSINESS_DOC_TYPES = { resale_cert: "Sales Tax Resale Certificate", business_license: "Business License" } as const;
export type BusinessDocType = keyof typeof BUSINESS_DOC_TYPES;

export interface BusinessDocMeta {
  filename: string;
  orig_name: string;
  mime: string;
  size: number;
  uploaded_at: string;
}

export interface BusinessDocsFileStore {
  putReceiptFile(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getReceiptFile(key: string): Promise<Uint8Array | null>;
  deleteReceiptFile(key: string): Promise<void>;
}

async function getBizDocsMeta(settingsStore: Pick<SettingsStore, "getSetting">): Promise<Partial<Record<BusinessDocType, BusinessDocMeta>>> {
  const raw = await settingsStore.getSetting("biz_documents");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<Record<BusinessDocType, BusinessDocMeta>>;
  } catch {
    return {};
  }
}
async function saveBizDocsMeta(settingsStore: Pick<SettingsStore, "setSetting">, meta: Partial<Record<BusinessDocType, BusinessDocMeta>>): Promise<void> {
  await settingsStore.setSetting("biz_documents", JSON.stringify(meta));
}

/** Ports api/business_docs.php's `action=list`. */
export async function listBusinessDocs(settingsStore: Pick<SettingsStore, "getSetting">): Promise<BusinessResult<{ documents: Partial<Record<BusinessDocType, BusinessDocMeta>> }>> {
  return { ok: true, data: { documents: await getBizDocsMeta(settingsStore) } };
}

/** Ports api/business_docs.php's `action=upload`. */
export async function uploadBusinessDoc(
  settingsStore: Pick<SettingsStore, "getSetting" | "setSetting">,
  fileStore: BusinessDocsFileStore,
  docType: string,
  dataUrl: string,
  clientFilename: string,
  now: Date = new Date()
): Promise<BusinessResult<{ document: BusinessDocMeta }>> {
  if (!(docType in BUSINESS_DOC_TYPES)) return { ok: false, error: "Invalid document type", status: 400 };
  const type = docType as BusinessDocType;

  const decoded = decodeDataUrl(dataUrl, 5 * 1024 * 1024);
  if (!decoded.ok) return { ok: false, error: decoded.error, status: 400 };
  const fileType = detectFileType(decoded.bytes);
  if (!fileType) return { ok: false, error: "Only PDF, JPG, or PNG files are accepted", status: 400 };

  const meta = await getBizDocsMeta(settingsStore);
  const existing = meta[type];
  if (existing?.filename) await fileStore.deleteReceiptFile(`business_documents/${existing.filename}`);

  const filename = `${type}_${now.getTime()}.${fileType}`;
  const mime = mimeForFileType(fileType);
  await fileStore.putReceiptFile(`business_documents/${filename}`, decoded.bytes, mime);

  const doc: BusinessDocMeta = {
    filename,
    orig_name: (clientFilename || "document").trim(),
    mime,
    size: decoded.bytes.length,
    uploaded_at: now.toISOString().slice(0, 19).replace("T", " "),
  };
  meta[type] = doc;
  await saveBizDocsMeta(settingsStore, meta);
  return { ok: true, data: { document: doc } };
}

/** Ports api/business_docs.php's `action=download`. */
export async function downloadBusinessDoc(
  settingsStore: Pick<SettingsStore, "getSetting">,
  fileStore: BusinessDocsFileStore,
  docType: string
): Promise<BusinessResult<{ bytes: Uint8Array; mime: string; dispositionName: string }>> {
  if (!(docType in BUSINESS_DOC_TYPES)) return { ok: false, error: "Invalid document type", status: 400 };
  const meta = await getBizDocsMeta(settingsStore);
  const doc = meta[docType as BusinessDocType];
  if (!doc?.filename) return { ok: false, error: "No document on file", status: 404 };
  const bytes = await fileStore.getReceiptFile(`business_documents/${doc.filename}`);
  if (!bytes) return { ok: false, error: "File not found", status: 404 };
  return { ok: true, data: { bytes, mime: doc.mime || "application/octet-stream", dispositionName: sanitizeDispositionName(doc.orig_name) } };
}

/** Ports api/business_docs.php's `action=delete`. */
export async function deleteBusinessDoc(
  settingsStore: Pick<SettingsStore, "getSetting" | "setSetting">,
  fileStore: BusinessDocsFileStore,
  docType: string
): Promise<BusinessResult> {
  if (!(docType in BUSINESS_DOC_TYPES)) return { ok: false, error: "Invalid document type", status: 400 };
  const type = docType as BusinessDocType;
  const meta = await getBizDocsMeta(settingsStore);
  if (meta[type]?.filename) {
    await fileStore.deleteReceiptFile(`business_documents/${meta[type]!.filename}`);
    delete meta[type];
    await saveBizDocsMeta(settingsStore, meta);
  }
  return { ok: true };
}

// ── In-memory test double ──
export class CapitalEquipmentStoreFake implements CapitalEquipmentStore {
  items: CapitalEquipmentRow[] = [];
  files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  private nextId = 1;

  async listItems(): Promise<CapitalEquipmentRow[]> {
    return this.items.slice().sort((a, b) => b.purchase_date.localeCompare(a.purchase_date) || b.id - a.id);
  }
  async getItem(id: number): Promise<CapitalEquipmentRow | null> {
    return this.items.find((i) => i.id === id) ?? null;
  }
  async insertItem(description: string, purchaseDate: string, price: number): Promise<number> {
    const id = this.nextId++;
    this.items.push({ id, description, purchase_date: purchaseDate, purchase_price: price, receipt_filename: null, receipt_orig_name: null, created_at: new Date().toISOString() });
    return id;
  }
  async updateItem(id: number, description: string, purchaseDate: string, price: number): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.description = description;
      item.purchase_date = purchaseDate;
      item.purchase_price = price;
    }
  }
  async deleteItem(id: number): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id);
  }
  async setReceiptMeta(id: number, filename: string | null, origName: string | null): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (item) {
      item.receipt_filename = filename;
      item.receipt_orig_name = origName;
    }
  }
  async putReceiptFile(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.files.set(key, { bytes, contentType });
  }
  async getReceiptFile(key: string): Promise<Uint8Array | null> {
    return this.files.get(key)?.bytes ?? null;
  }
  async deleteReceiptFile(key: string): Promise<void> {
    this.files.delete(key);
  }
}

export class BusinessDocsFileStoreFake implements BusinessDocsFileStore {
  files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async putReceiptFile(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.files.set(key, { bytes, contentType });
  }
  async getReceiptFile(key: string): Promise<Uint8Array | null> {
    return this.files.get(key)?.bytes ?? null;
  }
  async deleteReceiptFile(key: string): Promise<void> {
    this.files.delete(key);
  }
}
