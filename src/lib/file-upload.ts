// Shared file-upload validation: base64 decoding, magic-byte type detection, and filename
// sanitizing. Every upload path in this codebase needs the same three guarantees — cap the size,
// verify the real file type rather than trust the client-reported mime, and never let a filename
// carry HTML/header-injection-significant characters — so this is one module instead of one copy
// per feature.
//
// Extracted from src/business.ts (capital_equipment.php + business_docs.php's receipt/document
// uploads), which was the first upload path built once R2 existed. src/products.ts's product-image
// upload reuses detectFileType directly but writes its own base64/size-cap logic, because
// api/products.php's validation has different semantics (see products.ts's header) — the size cap
// is on the base64 TEXT length, not decoded bytes, and an invalid-base64 slot silently empties
// rather than failing the request. Sharing detectFileType still avoids two copies of the actual
// magic-byte check.

export type DetectedFileType = "pdf" | "jpg" | "png";

/** Decodes a `data:<mime>;base64,<data>` URL, capping at `maxBytes` of DECODED size. Pure/testable
 *  — no R2/DOM dependency beyond the ambient atob(). */
export function decodeDataUrl(
  dataUrl: string,
  maxBytes: number
): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) return { ok: false, error: "Invalid file data" };
  let binary: string;
  try {
    binary = atob(m[2]!);
  } catch {
    return { ok: false, error: "Could not decode file" };
  }
  if (binary.length === 0) return { ok: false, error: "Could not decode file" };
  if (binary.length > maxBytes) {
    return { ok: false, error: `File too large (max ${Math.round(maxBytes / (1024 * 1024))}MB)` };
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { ok: true, bytes };
}

/** Validates by magic bytes, not the client-reported mime type — the same three formats every
 *  upload path in this codebase accepts (products, studio, business docs, receipts). Products only
 *  accepts jpg/png of these three; business docs/receipts accept all three. */
export function detectFileType(bytes: Uint8Array): DetectedFileType | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf"; // %PDF
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}

export function mimeForFileType(type: DetectedFileType): string {
  return type === "pdf" ? "application/pdf" : type === "png" ? "image/png" : "image/jpeg";
}

/** Strips control characters and HTML/quote-significant characters — this value is later rendered
 *  in the admin UI and echoed in a Content-Disposition header. */
export function sanitizeFilename(name: string, fallback: string, maxLen = 200): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\x00-\x1F\x7F"'<>]/g, "").trim().slice(0, maxLen);
  return cleaned === "" ? fallback : cleaned;
}

/** Strips quote/CRLF characters for safe use in a Content-Disposition header value. */
export function sanitizeDispositionName(name: string): string {
  return name.replace(/["\r\n]/g, "");
}
