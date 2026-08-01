import { describe, it, expect, beforeEach } from "vitest";
import {
  decodeDataUrl,
  detectFileType,
  mimeForFileType,
  sanitizeFilename,
  sanitizeDispositionName,
  listCapitalEquipment,
  addCapitalEquipment,
  updateCapitalEquipment,
  deleteCapitalEquipment,
  uploadCapitalEquipmentReceipt,
  downloadCapitalEquipmentReceipt,
  deleteCapitalEquipmentReceipt,
  listBusinessDocs,
  uploadBusinessDoc,
  downloadBusinessDoc,
  deleteBusinessDoc,
  CapitalEquipmentStoreFake,
  BusinessDocsFileStoreFake,
} from "./business";
import { SettingsStoreFake } from "./settings";

function makeDataUrl(bytes: number[]): string {
  const binary = String.fromCharCode(...bytes);
  return `data:application/octet-stream;base64,${btoa(binary)}`;
}
const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]; // "%PDF-1.4"
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BOGUS_BYTES = [0x00, 0x01, 0x02, 0x03];

describe("decodeDataUrl", () => {
  it("rejects a non-data-URL string", () => {
    expect(decodeDataUrl("not a data url", 1000).ok).toBe(false);
  });

  it("decodes valid base64 to the original bytes", () => {
    const result = decodeDataUrl(makeDataUrl(PDF_BYTES), 1000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.from(result.bytes)).toEqual(PDF_BYTES);
  });

  it("rejects data over the byte cap", () => {
    const bigBytes = new Array(2000).fill(0);
    const result = decodeDataUrl(makeDataUrl(bigBytes), 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/i);
  });
});

describe("detectFileType / mimeForFileType", () => {
  it("detects PDF, JPEG, and PNG by magic bytes", () => {
    expect(detectFileType(new Uint8Array(PDF_BYTES))).toBe("pdf");
    expect(detectFileType(new Uint8Array(JPEG_BYTES))).toBe("jpg");
    expect(detectFileType(new Uint8Array(PNG_BYTES))).toBe("png");
  });

  it("rejects an unrecognized format", () => {
    expect(detectFileType(new Uint8Array(BOGUS_BYTES))).toBeNull();
  });

  it("maps each type to the correct mime", () => {
    expect(mimeForFileType("pdf")).toBe("application/pdf");
    expect(mimeForFileType("jpg")).toBe("image/jpeg");
    expect(mimeForFileType("png")).toBe("image/png");
  });
});

describe("sanitizeFilename / sanitizeDispositionName", () => {
  it("strips control chars and quote/angle-bracket characters", () => {
    expect(sanitizeFilename('a"b<c>d\'e', "fallback")).toBe("abcde");
  });

  it("falls back when the cleaned name is empty", () => {
    expect(sanitizeFilename('"<>', "fallback")).toBe("fallback");
  });

  it("truncates to the max length", () => {
    expect(sanitizeFilename("x".repeat(300), "fallback", 10)).toHaveLength(10);
  });

  it("sanitizeDispositionName strips quotes and CRLF", () => {
    expect(sanitizeDispositionName('evil"\r\nname')).toBe("evilname");
  });
});

describe("capital equipment CRUD", () => {
  let store: CapitalEquipmentStoreFake;
  beforeEach(() => {
    store = new CapitalEquipmentStoreFake();
  });

  it("addCapitalEquipment requires description, date, and a positive price", async () => {
    expect((await addCapitalEquipment(store, "", "2026-01-01", 10)).ok).toBe(false);
    expect((await addCapitalEquipment(store, "Sewing machine", "", 10)).ok).toBe(false);
    expect((await addCapitalEquipment(store, "Sewing machine", "2026-01-01", 0)).ok).toBe(false);
  });

  it("adds and lists an item, mapped to the DTO shape", async () => {
    await addCapitalEquipment(store, "Sewing machine", "2026-01-01", 215.21);
    const result = await listCapitalEquipment(store);
    expect(result.data?.items).toEqual([
      { id: 1, description: "Sewing machine", purchase_date: "2026-01-01", purchase_price: 215.21, has_receipt: false, receipt_orig_name: "" },
    ]);
  });

  it("updateCapitalEquipment requires an id and validates fields the same way", async () => {
    await addCapitalEquipment(store, "Machine", "2026-01-01", 100);
    expect((await updateCapitalEquipment(store, 0, "M", "2026-01-01", 100)).ok).toBe(false);
    const result = await updateCapitalEquipment(store, 1, "Updated", "2026-02-01", 150);
    expect(result.ok).toBe(true);
    expect((await store.getItem(1))?.description).toBe("Updated");
  });

  it("deleteCapitalEquipment requires an id and removes the row", async () => {
    await addCapitalEquipment(store, "Machine", "2026-01-01", 100);
    expect((await deleteCapitalEquipment(store, 0)).ok).toBe(false);
    await deleteCapitalEquipment(store, 1);
    expect(await store.getItem(1)).toBeNull();
  });
});

describe("capital equipment receipts", () => {
  let store: CapitalEquipmentStoreFake;
  beforeEach(async () => {
    store = new CapitalEquipmentStoreFake();
    await addCapitalEquipment(store, "Machine", "2026-01-01", 100);
  });

  it("uploadCapitalEquipmentReceipt requires an id", async () => {
    expect((await uploadCapitalEquipmentReceipt(store, 0, makeDataUrl(PDF_BYTES), "receipt.pdf")).ok).toBe(false);
  });

  it("rejects an invalid format", async () => {
    const result = await uploadCapitalEquipmentReceipt(store, 1, makeDataUrl(BOGUS_BYTES), "file.bin");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Only PDF, JPG, or PNG/);
  });

  it("rejects when the item doesn't exist", async () => {
    const result = await uploadCapitalEquipmentReceipt(store, 999, makeDataUrl(PDF_BYTES), "r.pdf");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("uploads a valid PDF receipt and stores it", async () => {
    const result = await uploadCapitalEquipmentReceipt(store, 1, makeDataUrl(PDF_BYTES), "My Receipt.pdf", 12345);
    expect(result.ok).toBe(true);
    const item = await store.getItem(1);
    expect(item?.receipt_filename).toBe("receipt_1_12345.pdf");
    expect(item?.receipt_orig_name).toBe("My Receipt.pdf");
  });

  it("replacing a receipt deletes the old file", async () => {
    await uploadCapitalEquipmentReceipt(store, 1, makeDataUrl(PDF_BYTES), "first.pdf", 1000);
    expect(store.files.has("capital_equipment_receipts/receipt_1_1000.pdf")).toBe(true);
    await uploadCapitalEquipmentReceipt(store, 1, makeDataUrl(JPEG_BYTES), "second.jpg", 2000);
    expect(store.files.has("capital_equipment_receipts/receipt_1_1000.pdf")).toBe(false);
    expect(store.files.has("capital_equipment_receipts/receipt_1_2000.jpg")).toBe(true);
  });

  it("downloadCapitalEquipmentReceipt returns the bytes, mime, and sanitized filename", async () => {
    await uploadCapitalEquipmentReceipt(store, 1, makeDataUrl(PDF_BYTES), 'evil"name.pdf', 1000);
    const result = await downloadCapitalEquipmentReceipt(store, 1);
    expect(result.ok).toBe(true);
    expect(result.data?.mime).toBe("application/pdf");
    expect(result.data?.dispositionName).toBe("evilname.pdf");
    expect(Array.from(result.data!.bytes)).toEqual(PDF_BYTES);
  });

  it("downloadCapitalEquipmentReceipt fails with no receipt on file", async () => {
    const result = await downloadCapitalEquipmentReceipt(store, 1);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("deleteCapitalEquipmentReceipt clears metadata and removes the file, keeping the item", async () => {
    await uploadCapitalEquipmentReceipt(store, 1, makeDataUrl(PDF_BYTES), "r.pdf", 1000);
    await deleteCapitalEquipmentReceipt(store, 1);
    const item = await store.getItem(1);
    expect(item).not.toBeNull();
    expect(item?.receipt_filename).toBeNull();
    expect(store.files.has("capital_equipment_receipts/receipt_1_1000.pdf")).toBe(false);
  });

  it("deleteCapitalEquipment also removes the receipt file", async () => {
    await uploadCapitalEquipmentReceipt(store, 1, makeDataUrl(PDF_BYTES), "r.pdf", 1000);
    await deleteCapitalEquipment(store, 1);
    expect(store.files.has("capital_equipment_receipts/receipt_1_1000.pdf")).toBe(false);
  });
});

describe("business docs", () => {
  let settings: SettingsStoreFake;
  let files: BusinessDocsFileStoreFake;
  beforeEach(() => {
    settings = new SettingsStoreFake();
    files = new BusinessDocsFileStoreFake();
  });

  it("lists no documents initially", async () => {
    expect((await listBusinessDocs(settings)).data?.documents).toEqual({});
  });

  it("rejects an invalid doc_type", async () => {
    const result = await uploadBusinessDoc(settings, files, "bogus", makeDataUrl(PDF_BYTES), "f.pdf");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid document type/);
  });

  it("rejects an invalid file format", async () => {
    const result = await uploadBusinessDoc(settings, files, "resale_cert", makeDataUrl(BOGUS_BYTES), "f.bin");
    expect(result.ok).toBe(false);
  });

  it("uploads a document and it appears in the list", async () => {
    const now = new Date("2026-07-04T17:37:36Z");
    const result = await uploadBusinessDoc(settings, files, "resale_cert", makeDataUrl(JPEG_BYTES), "ResaleLicense.jpg", now);
    expect(result.ok).toBe(true);
    expect(result.data?.document.filename).toMatch(/^resale_cert_\d+\.jpg$/);
    const list = await listBusinessDocs(settings);
    expect(list.data?.documents.resale_cert?.orig_name).toBe("ResaleLicense.jpg");
  });

  it("replacing a document deletes the old file", async () => {
    await uploadBusinessDoc(settings, files, "resale_cert", makeDataUrl(JPEG_BYTES), "first.jpg", new Date(1000));
    const firstFilename = (await listBusinessDocs(settings)).data!.documents.resale_cert!.filename;
    await uploadBusinessDoc(settings, files, "resale_cert", makeDataUrl(PDF_BYTES), "second.pdf", new Date(2000));
    expect(files.files.has(`business_documents/${firstFilename}`)).toBe(false);
  });

  it("downloads a document with sanitized disposition name", async () => {
    await uploadBusinessDoc(settings, files, "business_license", makeDataUrl(PDF_BYTES), 'evil"license.pdf');
    const result = await downloadBusinessDoc(settings, files, "business_license");
    expect(result.ok).toBe(true);
    expect(result.data?.dispositionName).toBe("evillicense.pdf");
  });

  it("fails to download when no document is on file", async () => {
    const result = await downloadBusinessDoc(settings, files, "business_license");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("deletes a document and removes it from the metadata + file store", async () => {
    await uploadBusinessDoc(settings, files, "resale_cert", makeDataUrl(PDF_BYTES), "r.pdf");
    await deleteBusinessDoc(settings, files, "resale_cert");
    expect((await listBusinessDocs(settings)).data?.documents.resale_cert).toBeUndefined();
  });

  it("each doc type is independent", async () => {
    await uploadBusinessDoc(settings, files, "resale_cert", makeDataUrl(PDF_BYTES), "resale.pdf");
    await uploadBusinessDoc(settings, files, "business_license", makeDataUrl(JPEG_BYTES), "license.jpg");
    const docs = (await listBusinessDocs(settings)).data!.documents;
    expect(docs.resale_cert?.orig_name).toBe("resale.pdf");
    expect(docs.business_license?.orig_name).toBe("license.jpg");
  });
});
