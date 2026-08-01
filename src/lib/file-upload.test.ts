import { describe, it, expect } from "vitest";
import { decodeDataUrl, detectFileType, mimeForFileType, sanitizeFilename, sanitizeDispositionName } from "./file-upload";

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
