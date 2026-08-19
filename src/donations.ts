// Donations: a log of products given away rather than sold — a separate record from the
// product's own `donated` flag (src/products.ts). Checking a product's "Donated" checkbox just
// marks that one product as no longer for sale; a donation LOG ENTRY (date, recipient, which
// product) is created separately here, via its own admin screen, so a product can't accidentally
// gain a donation record just from being flagged, and the history isn't lost if the flag is later
// unchecked. Same small store-interface + fake pattern as every other module in this migration.

export interface DonationRow {
  id: number;
  product_id: string;
  donation_date: string; // yyyy-mm-dd
  recipient: string;
  created_at: string | null;
}

export interface DonationDto {
  id: number;
  product_id: string;
  date: string;
  recipient: string;
}

export interface DonationsStore {
  insertDonation(row: Omit<DonationRow, "id" | "created_at">): Promise<number>;
  listDonations(): Promise<DonationRow[]>;
  deleteDonation(id: number): Promise<void>;
  /** Used to validate product_id refers to a real product before logging a donation against it. */
  productExists(productId: string): Promise<boolean>;
}

export interface DonationsResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface CreateDonationInput {
  product_id?: string;
  date?: string;
  recipient?: string;
}

/** Caller must have already required admin. */
export async function createDonation(store: DonationsStore, input: CreateDonationInput): Promise<DonationsResult<{ id: number }>> {
  const productId = (input.product_id ?? "").trim();
  const date = (input.date ?? "").trim();
  const recipient = (input.recipient ?? "").trim();
  if (!productId) return { ok: false, error: "Please select a product" };
  if (!date) return { ok: false, error: "Please enter a date" };
  if (!recipient) return { ok: false, error: "Please enter who the item was donated to" };
  if (!(await store.productExists(productId))) return { ok: false, error: "Product not found" };

  const id = await store.insertDonation({ product_id: productId, donation_date: date, recipient });
  return { ok: true, data: { id } };
}

/** Caller must have already required admin. */
export async function listDonations(store: DonationsStore): Promise<DonationsResult<{ donations: DonationDto[] }>> {
  const rows = await store.listDonations();
  return {
    ok: true,
    data: {
      donations: rows
        .sort((a, b) => (b.donation_date ?? "").localeCompare(a.donation_date ?? ""))
        .map((r) => ({ id: r.id, product_id: r.product_id, date: r.donation_date, recipient: r.recipient })),
    },
  };
}

/** Caller must have already required admin. */
export async function deleteDonation(store: DonationsStore, id: number): Promise<DonationsResult> {
  if (!id) return { ok: false, error: "Missing id" };
  await store.deleteDonation(id);
  return { ok: true };
}

// ── In-memory test double ──
export class DonationsStoreFake implements DonationsStore {
  donations: DonationRow[] = [];
  productIds = new Set<string>();
  private nextId = 1;

  async insertDonation(row: Omit<DonationRow, "id" | "created_at">): Promise<number> {
    const id = this.nextId++;
    this.donations.push({ ...row, id, created_at: new Date().toISOString() });
    return id;
  }
  async listDonations(): Promise<DonationRow[]> {
    return this.donations;
  }
  async deleteDonation(id: number): Promise<void> {
    this.donations = this.donations.filter((d) => d.id !== id);
  }
  async productExists(productId: string): Promise<boolean> {
    return this.productIds.has(productId);
  }
}
