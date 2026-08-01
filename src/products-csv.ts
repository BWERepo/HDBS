// Product CSV export/import: ports api/products_csv.php in full.

import { parseCsv, toCsv } from "./lib/csv";
import type { ProductRow, ProductsStore } from "./products";

const CSV_COLUMNS = [
  "id",
  "sku",
  "name",
  "description",
  "price",
  "cogm",
  "launch_date",
  "stock",
  "category",
  "badge",
  "weight",
  "size",
  "sell",
  "img1",
  "img2",
  "img3",
  "ship_mode",
  "ship_fixed",
  "coming_soon",
] as const;

/** Ports csvSafe(): a cell starting with =, +, -, @ (or a leading tab/CR) is interpreted as a
 *  formula by Excel/Sheets when the file is opened — prefix with a single quote so it's always
 *  treated as literal text. */
function csvSafe(value: string): string {
  if (value !== "" && /^[=+\-@\t\r]/.test(value)) return `'${value}`;
  return value;
}

/** Ports products_csv.php's GET (export) action: every product, ordered by category then name. */
export async function exportProductsCsv(store: ProductsStore): Promise<string> {
  const rows = (await store.listProducts()).slice().sort((a, b) => (a.category ?? "").localeCompare(b.category ?? "") || a.name.localeCompare(b.name));

  const cells: (string | number)[][] = [CSV_COLUMNS.slice()];
  for (const r of rows) {
    const raw: Record<(typeof CSV_COLUMNS)[number], string | number> = {
      id: r.id,
      sku: r.sku ?? "",
      name: r.name,
      description: r.description ?? "",
      price: r.price,
      cogm: r.cogm ?? "",
      launch_date: r.launch_date ?? "",
      stock: r.stock,
      category: r.category ?? "",
      badge: r.badge ?? "",
      weight: r.weight ?? "",
      size: r.size ?? "",
      sell: r.sell ? 1 : 0,
      img1: r.img1 ?? "",
      img2: r.img2 ?? "",
      img3: r.img3 ?? "",
      ship_mode: r.ship_mode ?? "",
      ship_fixed: r.ship_fixed ?? "",
      coming_soon: r.coming_soon ? 1 : 0,
    };
    cells.push(CSV_COLUMNS.map((col) => csvSafe(String(raw[col]))));
  }
  return toCsv(cells);
}

export interface ImportProductsResult {
  ok: boolean;
  error?: string;
  imported?: number;
  mode?: "merge" | "replace";
}

const REQUIRED_COLUMNS = ["id", "name", "price", "stock", "category"];

/** PHP `!empty()` semantics for a CSV cell string: undefined, "", and the literal "0" all count
 *  as empty. */
function phpNotEmpty(v: string | undefined): boolean {
  return v !== undefined && v !== "" && v !== "0";
}

/** Ports products_csv.php's POST (import) action: parses the uploaded CSV, validates required
 *  columns, and upserts every row (or replaces the whole catalog first, in 'replace' mode). */
export async function importProductsCsv(store: ProductsStore, csvText: string, mode: "merge" | "replace"): Promise<ImportProductsResult> {
  const table = parseCsv(csvText).filter((row) => !(row.length === 1 && row[0] === ""));
  const [headerRow, ...dataRows] = table;
  if (!headerRow) return { ok: false, error: "Empty CSV" };

  const headers = headerRow.map((h) => h.trim());
  for (const req of REQUIRED_COLUMNS) {
    if (!headers.includes(req)) return { ok: false, error: `Missing required column: ${req}` };
  }

  const rows: Record<string, string>[] = [];
  for (const row of dataRows) {
    if (row.length !== headers.length) continue; // matches the PHP's silent skip on a malformed row
    const record: Record<string, string> = {};
    headers.forEach((h, i) => (record[h] = row[i] ?? ""));
    rows.push(record);
  }
  if (rows.length === 0) return { ok: false, error: "No data rows found" };

  if (mode === "replace") await store.deleteAllProducts();

  let count = 0;
  for (const r of rows) {
    const price = Number(r.price ?? 0) || 0;
    const defaultCogm = price * 0.5;
    // PHP `!empty($r['cogm'])` — a blank cell OR a literal "0" both count as empty and fall back
    // to the default; only phpNotEmpty(cogm) below is a real, present value.
    const product: ProductRow = {
      id: (r.id ?? "").trim(),
      sku: (r.sku ?? "").trim(),
      name: (r.name ?? "").trim(),
      description: (r.description ?? "").trim(),
      price,
      cogm: phpNotEmpty(r.cogm) ? Number(r.cogm) : defaultCogm,
      launch_date: phpNotEmpty(r.launch_date) ? r.launch_date!.trim() : "2026-07-01",
      stock: Math.trunc(Number(r.stock ?? 0)) || 0,
      category: (r.category ?? "").trim(),
      badge: (r.badge ?? "").trim(),
      weight: Number(r.weight ?? 0) || 0,
      size: (r.size ?? "").trim(),
      // PHP: `(int)($r['sell'] ?? 1)`. array_combine() always sets the key when the CSV has a
      // "sell" column — even for a blank cell — so `?? 1` only ever fires when the column is
      // absent entirely; a present-but-blank cell casts to (int)'' = 0, not the 1 default.
      sell: r.sell === undefined ? true : (parseInt(r.sell, 10) || 0) !== 0,
      img1: (r.img1 ?? "").trim(),
      img2: (r.img2 ?? "").trim(),
      img3: (r.img3 ?? "").trim(),
      ship_mode: (r.ship_mode ?? "weight").trim() === "fixed" ? "fixed" : "weight",
      ship_fixed: Number(r.ship_fixed ?? 0) || 0,
      coming_soon: !!r.coming_soon && r.coming_soon.trim() !== "0",
    };
    await store.upsertProduct(product);
    count++;
  }

  return { ok: true, imported: count, mode };
}
