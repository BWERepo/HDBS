// Tax reference data + sweep bookkeeping: ports api/tn_city_tax.php (city/county tax rate
// CRUD) and api/tax_sweep.php (marking orders as remitted to the state).
//
// Deliberately NOT ported here: api/fetch_tax.php (calls the live Square API to reconcile an
// order's tax amount) and api/tn_tax.php (already confirmed dead/broken — queries a table
// deliberately dropped from production, see PROJECT_STATUS.md finding 2). Both are genuinely
// payment-adjacent or dead code, not tax business logic.
//
// Same store-interface + fake pattern as auth.ts/settings.ts/products.ts/orders.ts.

export interface TnCityTaxRow {
  id: number;
  city: string;
  county: string;
  tax_rate: number;
}

export interface PendingTaxOrder {
  id: string;
  order_date: string | null;
  tax_amount: number;
}

export interface TaxSweepRow {
  id: number;
  sweep_date: string;
  period_from: string;
  period_to: string;
  order_count: number;
  total_tax: number;
  order_ids: string | null;
  order_details: string | null;
  created_at: string | null;
}

export interface TaxResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface TaxStore {
  /** Case-insensitive city/county search, matching MySQL's *_ai_ci collation — the real
   *  Supabase adapter must use .ilike(), not .like(), to preserve this. */
  listCities(search: string): Promise<TnCityTaxRow[]>;
  upsertCity(city: string, county: string, taxRate: number): Promise<void>;
  deleteCity(id: number): Promise<void>;

  listPendingTaxOrders(): Promise<PendingTaxOrder[]>;
  listSweeps(): Promise<TaxSweepRow[]>;
  insertSweep(sweep: Omit<TaxSweepRow, "id" | "created_at">): Promise<number>;
  markOrdersSwept(orderIds: string[], sweptAt: string): Promise<void>;
  updateSweep(id: number, fields: Partial<Pick<TaxSweepRow, "sweep_date" | "total_tax" | "order_count">>): Promise<void>;
  deleteSweep(id: number): Promise<void>;
}

// ── tn_city_tax ──

/** Ports api/tn_city_tax.php's GET action. Public — no admin check, matching the PHP. */
export async function listCities(store: TaxStore, search = ""): Promise<TaxResult<{ cities: TnCityTaxRow[] }>> {
  const cities = await store.listCities(search.trim());
  return { ok: true, data: { cities } };
}

/** Ports api/tn_city_tax.php's POST action. Caller must have already required admin. */
export async function saveCity(store: TaxStore, city: string, county: string, taxRate: number | null): Promise<TaxResult> {
  const c = city.trim();
  const co = county.trim();
  if (!c || !co || taxRate === null) return { ok: false, error: "Missing city, county, or tax_rate" };
  await store.upsertCity(c, co, taxRate);
  return { ok: true };
}

/** Ports api/tn_city_tax.php's DELETE action. Caller must have already required admin. */
export async function deleteCity(store: TaxStore, id: number): Promise<TaxResult> {
  if (!id) return { ok: false, error: "Missing id" };
  await store.deleteCity(id);
  return { ok: true };
}

// ── tax_sweep ──

export type PendingSweep =
  | { pending: false; message: string }
  | {
      pending: true;
      count: number;
      total_tax: number;
      date_from: string | null;
      date_to: string | null;
      order_ids: string[];
      order_details: { id: string; date: string | null; tax: number }[];
    };

/** Ports api/tax_sweep.php's GET (no ?action) — unswept orders awaiting a sweep. */
export async function getPendingSweep(store: TaxStore): Promise<PendingSweep> {
  const rows = await store.listPendingTaxOrders();
  if (rows.length === 0) return { pending: false, message: "No unswept tax orders found." };

  const totalTax = rows.reduce((sum, r) => sum + r.tax_amount, 0);
  return {
    pending: true,
    count: rows.length,
    total_tax: Math.round(totalTax * 100) / 100,
    date_from: rows[0]!.order_date,
    date_to: rows[rows.length - 1]!.order_date,
    order_ids: rows.map((r) => r.id),
    order_details: rows.map((r) => ({ id: r.id, date: r.order_date, tax: Math.round(r.tax_amount * 100) / 100 })),
  };
}

/** Ports api/tax_sweep.php's GET ?action=history. */
export async function getSweepHistory(store: TaxStore): Promise<TaxResult<{ sweeps: TaxSweepRow[] }>> {
  return { ok: true, data: { sweeps: await store.listSweeps() } };
}

export interface CreateSweepInput {
  order_ids: string[];
  count?: number;
  total_tax?: number;
  date_from?: string;
  date_to?: string;
  order_details?: unknown;
}

/**
 * Ports api/tax_sweep.php's POST action: records a sweep and stamps every included order's
 * tax_swept_date. order_ids/order_details are stored as opaque JSON text, exactly as the PHP's
 * json_encode() did — NOT comma-separated (the migration's own column comment says
 * "comma-separated", which doesn't match the PHP's actual json_encode() call; the wire format
 * from the live PHP is the source of truth here, not the comment).
 */
export async function createSweep(store: TaxStore, input: CreateSweepInput, now: Date = new Date()): Promise<TaxResult<{ sweep_id: number; updated: number; sweep_date: string }>> {
  if (!input.order_ids || input.order_ids.length === 0) return { ok: false, error: "Missing order_ids" };

  const today = now.toISOString().slice(0, 10);
  const nowIso = now.toISOString();
  const sweepId = await store.insertSweep({
    sweep_date: today,
    period_from: input.date_from ?? today,
    period_to: input.date_to ?? today,
    order_count: input.count ?? input.order_ids.length,
    total_tax: input.total_tax ?? 0,
    order_ids: JSON.stringify(input.order_ids),
    order_details: input.order_details !== undefined ? JSON.stringify(input.order_details) : null,
  });
  await store.markOrdersSwept(input.order_ids, nowIso);
  return { ok: true, data: { sweep_id: sweepId, updated: input.order_ids.length, sweep_date: today } };
}

/** Ports api/tax_sweep.php's PUT action. Caller must have already required admin. */
export async function editSweep(
  store: TaxStore,
  id: number,
  fields: { sweep_date?: string; total_tax?: number; order_count?: number }
): Promise<TaxResult> {
  if (!id) return { ok: false, error: "Missing id" };
  if (Object.keys(fields).length === 0) return { ok: false, error: "Nothing to update" };
  await store.updateSweep(id, fields);
  return { ok: true };
}

/** Ports api/tax_sweep.php's DELETE action. Caller must have already required admin. */
export async function removeSweep(store: TaxStore, id: number): Promise<TaxResult> {
  if (!id) return { ok: false, error: "Missing id" };
  await store.deleteSweep(id);
  return { ok: true };
}

// ── In-memory test double ──
export class TaxStoreFake implements TaxStore {
  cities: TnCityTaxRow[] = [];
  pendingOrders: PendingTaxOrder[] = [];
  sweeps: TaxSweepRow[] = [];
  private nextCityId = 1;
  private nextSweepId = 1;

  async listCities(search: string): Promise<TnCityTaxRow[]> {
    const s = search.toLowerCase();
    return this.cities
      .filter((c) => !s || c.city.toLowerCase().includes(s) || c.county.toLowerCase().includes(s))
      .sort((a, b) => a.city.localeCompare(b.city));
  }
  async upsertCity(city: string, county: string, taxRate: number): Promise<void> {
    // Conflict target is the (city, county) PAIR, matching MySQL's UNIQUE KEY city_county —
    // the same city name in a different county is a distinct row, not an update.
    const existing = this.cities.find((c) => c.city === city && c.county === county);
    if (existing) {
      existing.tax_rate = taxRate;
    } else {
      this.cities.push({ id: this.nextCityId++, city, county, tax_rate: taxRate });
    }
  }
  async deleteCity(id: number): Promise<void> {
    this.cities = this.cities.filter((c) => c.id !== id);
  }

  async listPendingTaxOrders(): Promise<PendingTaxOrder[]> {
    return this.pendingOrders;
  }
  async listSweeps(): Promise<TaxSweepRow[]> {
    return this.sweeps;
  }
  async insertSweep(sweep: Omit<TaxSweepRow, "id" | "created_at">): Promise<number> {
    const id = this.nextSweepId++;
    this.sweeps.unshift({ ...sweep, id, created_at: new Date().toISOString() });
    return id;
  }
  async markOrdersSwept(orderIds: string[]): Promise<void> {
    this.pendingOrders = this.pendingOrders.filter((o) => !orderIds.includes(o.id));
  }
  async updateSweep(id: number, fields: Partial<Pick<TaxSweepRow, "sweep_date" | "total_tax" | "order_count">>): Promise<void> {
    const row = this.sweeps.find((s) => s.id === id);
    if (row) Object.assign(row, fields);
  }
  async deleteSweep(id: number): Promise<void> {
    this.sweeps = this.sweeps.filter((s) => s.id !== id);
  }
}
