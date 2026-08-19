// Product catalog: ports api/products.php's GET (public/admin shared catalog read), POST
// (create/update, including the base64 image-upload path), and DELETE actions.
//
// Written against a small store interface, exactly like src/auth.ts and src/settings.ts.
//
// ── Image-slot processing (saveProduct's img1/img2/img3 handling) ──
// This does NOT reuse src/lib/file-upload.ts's decodeDataUrl wholesale, because api/products.php's
// per-slot validation has genuinely different semantics from the business_docs/capital_equipment
// single-file uploads that module was built for:
//   - The size cap is on the BASE64 TEXT length (`strlen($m[2]) > 4MB*4/3`), not the decoded byte
//     count.
//   - A slot whose value merely CONTAINS "data:image" but doesn't match the full
//     `data:image/(\w+);base64,(.+)` pattern, or decodes to invalid base64, is silently emptied
//     (`$saved_imgs[] = ''`) rather than failing the request.
//   - A slot with a BAD MAGIC BYTE, in contrast, aborts the ENTIRE save with a 400 — none of the
//     three slots get their (would-be) URL, and the product row is never written.
//   detectFileType() IS reused for the actual magic-byte check, since that logic is identical.
//
// One faithfully-preserved PHP quirk, not a bug this port introduces: validation and the R2 write
// happen per-slot, in order, exactly like the PHP's per-slot file_put_contents() inside its loop.
// If slot 3 fails magic-byte validation after slots 1-2 already validated and wrote successfully,
// slots 1-2's R2 objects are NOT rolled back (matching the PHP's disk-write timing exactly) even
// though the product row itself is never saved — an orphaned-but-harmless R2 object, the same
// orphaning the live PHP has always produced on Hostinger. Not treated as a bug to fix, only to
// document (contrast with, e.g., send_confirm.php's missing requireAdmin() in email.ts, which WAS
// a deliberate security fix — this has no such consequence).
//
// URLs: api/products.php:65 hardcoded the production domain into the stored URL. This port stores
// a root-relative path instead (`/product_images/<filename>`), matching what migration 0009
// already normalized every existing row to — so new uploads land in the same shape as migrated
// ones, and staging/production each resolve the path against their own R2 bucket via
// src/routes/media.ts rather than one hardcoded domain.

import { detectFileType } from "./lib/file-upload";

/**
 * Shape of a row from the `products` table (see supabase/migrations/0002_catalog.sql). `sell`
 * and `coming_soon` are real Postgres booleans — see mapProductForResponse for why the response
 * layer coerces them back to 1/0.
 */
export interface ProductRow {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  category: string | null;
  badge: string | null;
  weight: number | null;
  size: string | null;
  sell: boolean;
  donated: boolean;
  img1: string | null;
  img2: string | null;
  img3: string | null;
  ship_mode: string | null;
  ship_fixed: number | null;
  coming_soon: boolean;
  cogm: number | null;
  launch_date: string | null;
}

/** The shape js/store.js and js/admin-products.js actually consume. */
export interface ProductDto {
  id: string;
  name: string;
  desc: string;
  price: number;
  stock: number;
  cat: string;
  badge: string;
  weight: number;
  size: string;
  sell: 0 | 1;
  donated: 0 | 1;
  imgs: [string, string, string];
  hasImg: boolean;
  sku: string;
  ship_mode: string;
  ship_fixed: number;
  coming_soon: 0 | 1;
  cogm: number | null;
  launch_date: string;
}

export interface ProductsStore {
  listProducts(): Promise<ProductRow[]>;
  /** Insert-or-update by id, matching MySQL's `ON DUPLICATE KEY UPDATE`. */
  upsertProduct(row: ProductRow): Promise<void>;
  /** No R2 cleanup on delete — matches api/products.php's DELETE, which never removed image files. */
  deleteProduct(id: string): Promise<void>;
  putProductImage(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Ports products_csv.php's `mode=replace` import: `DELETE FROM products` with no R2 cleanup,
   *  same reasoning as deleteProduct above. */
  deleteAllProducts(): Promise<void>;
}

export interface ProductResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

/** The raw request body shape, matching `$d` in api/products.php's POST handler. */
export interface ProductInput {
  id?: string;
  name?: string;
  sku?: string;
  desc?: string;
  price?: number | string;
  stock?: number | string;
  cat?: string;
  badge?: string;
  weight?: number | string;
  size?: string;
  sell?: unknown;
  donated?: unknown;
  imgs?: [string?, string?, string?];
  ship_mode?: string;
  ship_fixed?: number | string;
  coming_soon?: unknown;
  cogm?: number | string;
  launch_date?: string;
}

const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const IMG_COLUMNS = ["img1", "img2", "img3"] as const;
// Mirrors PHP's `strlen($m[2]) > 4 * 1024 * 1024 * 4 / 3` — a cap on the BASE64 TEXT length
// (accounting for base64's ~4/3 size overhead), not the decoded byte count.
const MAX_BASE64_IMAGE_LENGTH = Math.floor((4 * 1024 * 1024 * 4) / 3);

/**
 * PHP's `(int)` cast is lenient in ways `Number()`/`parseInt()` alone are not identical to, but
 * every real caller here is JSON (a boolean, a number, or a numeric-looking string from a form
 * field) — never an arbitrary non-numeric string — so this only needs to handle those three cases.
 */
function toIntFlag(v: unknown): 0 | 1 {
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = typeof v === "number" ? v : parseInt(String(v ?? "0"), 10);
  return Number.isFinite(n) && n !== 0 ? 1 : 0;
}

/** PHP `empty()` semantics for the JSON-shaped values this codebase's front end actually sends. */
function phpNotEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return false;
  if (v === 0 || v === "0" || v === "") return false;
  return true;
}

/**
 * Processes the three image slots exactly like api/products.php's POST loop: an already-a-URL
 * value passes through, an empty value stays empty, a `data:image/...;base64,...` value is
 * decoded/validated/written to R2, and a slot that merely CONTAINS "data:image" without matching
 * the full pattern (or fails to base64-decode) is silently emptied — see this file's header for
 * why a bad MAGIC BYTE, in contrast, aborts the whole save.
 */
async function processProductImages(
  store: ProductsStore,
  productId: string,
  imgs: [string, string, string]
): Promise<{ ok: true; saved: [string, string, string] } | { ok: false; error: string }> {
  const saved: string[] = [];

  for (let i = 0; i < 3; i++) {
    const val = imgs[i] ?? "";
    if (!val) {
      saved.push("");
      continue;
    }
    if (!val.includes("data:image")) {
      saved.push(val); // already a URL (a fresh upload's own past URL, or an untouched slot)
      continue;
    }

    const m = /^data:image\/(\w+);base64,(.+)$/s.exec(val);
    if (!m) {
      saved.push(""); // contains "data:image" but malformed — matches the PHP's `else` branch
      continue;
    }

    const base64Data = m[2]!;
    if (base64Data.length > MAX_BASE64_IMAGE_LENGTH) {
      return { ok: false, error: "Image too large (max 4MB)" };
    }

    let bytes: Uint8Array;
    try {
      const binary = atob(base64Data);
      bytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
    } catch {
      saved.push(""); // invalid base64 — matches `base64_decode(..., true)` returning false
      continue;
    }

    const fileType = detectFileType(bytes);
    if (fileType !== "jpg" && fileType !== "png") {
      // Aborts the ENTIRE save, matching the PHP's fail() here — not a per-slot empty.
      return { ok: false, error: "Invalid image format — only JPEG and PNG are accepted" };
    }

    const filename = `prod_${productId}_${IMG_COLUMNS[i]}.${fileType}`;
    await store.putProductImage(`product_images/${filename}`, bytes, fileType === "png" ? "image/png" : "image/jpeg");
    saved.push(`/product_images/${filename}`);
  }

  return { ok: true, saved: saved as [string, string, string] };
}

/** Ports api/products.php's `POST` action (create or update). Caller must have already required admin. */
export async function saveProduct(
  store: ProductsStore,
  input: ProductInput
): Promise<ProductResult<{ message: string }>> {
  const id = input.id ?? "";
  const name = input.name ?? "";
  if (!id || !name) return { ok: false, error: "Missing id or name" };
  // The id is embedded in image filenames — restrict to a safe charset (no path traversal).
  if (!PRODUCT_ID_PATTERN.test(id)) return { ok: false, error: "Invalid product id", status: 400 };

  const imgs: [string, string, string] = [input.imgs?.[0] ?? "", input.imgs?.[1] ?? "", input.imgs?.[2] ?? ""];
  const processed = await processProductImages(store, id, imgs);
  if (!processed.ok) return { ok: false, error: processed.error, status: 400 };

  const price = Number(input.price ?? 0);
  const defaultCogm = price * 0.5;
  // `isset($d['cogm'])`: the key must be PRESENT (and non-null) — an explicit 0 uses 0, only an
  // absent/null key falls back to the price-based default.
  const cogm = input.cogm !== undefined && input.cogm !== null ? Number(input.cogm) : defaultCogm;
  // `isset($d['sell']) ? (int)$d['sell'] : 1` — same present-vs-absent distinction as cogm.
  const sell = input.sell !== undefined && input.sell !== null ? toIntFlag(input.sell) : 1;
  const donated = phpNotEmpty(input.donated);
  // A donated item is never sellable — enforced here too (not just via the admin form's own
  // uncheck-Sell-when-Donated-is-checked behavior), so a donated product can't end up sellable
  // through any other path that posts sell:1 without also clearing donated.
  const finalSell = donated ? false : sell === 1;

  await store.upsertProduct({
    id,
    sku: input.sku ?? "",
    name,
    description: input.desc ?? "",
    price,
    stock: Math.trunc(Number(input.stock ?? 0)),
    category: input.cat ?? "",
    badge: input.badge ?? "",
    weight: Number(input.weight ?? 0),
    size: input.size ?? "",
    sell: finalSell,
    donated,
    img1: processed.saved[0],
    img2: processed.saved[1],
    img3: processed.saved[2],
    ship_mode: input.ship_mode === "fixed" ? "fixed" : "weight",
    ship_fixed: Number(input.ship_fixed ?? 0),
    coming_soon: phpNotEmpty(input.coming_soon),
    cogm,
    launch_date: input.launch_date ?? "2026-07-01",
  });

  return { ok: true, data: { message: "Product saved" } };
}

/** Ports api/products.php's `DELETE` action. Caller must have already required admin. */
export async function deleteProduct(store: ProductsStore, id: string): Promise<ProductResult<{ message: string }>> {
  if (!id) return { ok: false, error: "Missing id" };
  await store.deleteProduct(id);
  return { ok: true, data: { message: "Product deleted" } };
}

/**
 * Ports api/products.php's per-row GET mapping. `cogm` (cost of goods) is internal margin data —
 * only included for authenticated admin requests, matching `$showCogm = isAdminRequest()` in the
 * PHP. `sell`/`coming_soon` are coerced from Postgres booleans back to 1/0 in this one place, per
 * finding 4 in PROJECT_STATUS.md — the loose `=== 1`-style comparisons throughout the front end
 * are not being touched.
 */
export function mapProductForResponse(row: ProductRow, isAdmin: boolean): ProductDto {
  return {
    id: row.id,
    name: row.name,
    desc: row.description ?? "",
    price: Number(row.price),
    stock: Number(row.stock),
    cat: row.category ?? "",
    badge: row.badge ?? "",
    weight: Number(row.weight ?? 0),
    size: row.size ?? "",
    sell: row.sell ? 1 : 0,
    donated: row.donated ? 1 : 0,
    imgs: [row.img1 ?? "", row.img2 ?? "", row.img3 ?? ""],
    hasImg: !!row.img1,
    sku: row.sku ?? "",
    ship_mode: row.ship_mode ?? "weight",
    ship_fixed: Number(row.ship_fixed ?? 0),
    coming_soon: row.coming_soon ? 1 : 0,
    cogm: isAdmin ? Number(row.cogm ?? 0) : null,
    launch_date: row.launch_date ?? "2026-07-01",
  };
}

/** Ports api/products.php's `GET` action — list every product, mapped for the requester. */
export async function listProducts(store: ProductsStore, isAdmin: boolean): Promise<ProductDto[]> {
  const rows = await store.listProducts();
  return rows.map((row) => mapProductForResponse(row, isAdmin));
}

// ── In-memory test double ──
export class ProductsStoreFake implements ProductsStore {
  rows: ProductRow[] = [];
  images = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async listProducts(): Promise<ProductRow[]> {
    // created_at ASC, matching "ORDER BY created_at ASC" — the fake stores rows already in the
    // order they were inserted, mirroring insertion order as a stand-in for the real column.
    return this.rows;
  }
  async upsertProduct(row: ProductRow): Promise<void> {
    const i = this.rows.findIndex((r) => r.id === row.id);
    if (i === -1) this.rows.push(row);
    else this.rows[i] = row;
  }
  async deleteProduct(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  async deleteAllProducts(): Promise<void> {
    this.rows = [];
  }
  async putProductImage(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.images.set(key, { bytes, contentType });
  }
}

/** Builds a ProductRow with sensible defaults, so tests only specify the fields they care about. */
export function makeProductRow(overrides: Partial<ProductRow> & Pick<ProductRow, "id" | "name">): ProductRow {
  return {
    sku: "",
    description: "",
    price: 0,
    stock: 0,
    category: "",
    badge: "",
    weight: 0,
    size: "",
    sell: true,
    donated: false,
    img1: "",
    img2: "",
    img3: "",
    ship_mode: "weight",
    ship_fixed: 0,
    coming_soon: false,
    cogm: 0,
    launch_date: "2026-07-01",
    ...overrides,
  };
}
