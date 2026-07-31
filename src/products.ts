// Product catalog: read-only listing. Ports api/products.php's GET action (the public/admin
// shared catalog read) — the write/delete actions (POST/DELETE) are a later pass, since they
// involve R2 image upload handling that has no meaning yet without a bucket (see settings.ts's
// header for the same reasoning about biz_profile's image uploads).
//
// Written against a small store interface, exactly like src/auth.ts and src/settings.ts —
// Supabase doesn't exist yet (see PROJECT_STATUS.md), so this is fully unit-tested against an
// in-memory fake and becomes real the moment src/db.ts exists.

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

  async listProducts(): Promise<ProductRow[]> {
    // created_at ASC, matching "ORDER BY created_at ASC" — the fake stores rows already in the
    // order they were inserted, mirroring insertion order as a stand-in for the real column.
    return this.rows;
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
