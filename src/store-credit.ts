// Store credit: a per-customer balance, spendable at checkout the same way a coupon discount is
// applied (orders.ts's `_credit` line item). New feature, not a PHP port — same store-interface +
// fake pattern as every other module in this migration.
//
// Coupons are percent-off only, so nothing currently deposits into this balance — the crediting
// side (`credit_store_account` in supabase/migrations/0012_coupons.sql) is unused going forward.
// The debit/spend side stays live: any balance a customer already has (or gets by some future
// mechanism) remains spendable here.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface StoreCreditTransactionRow {
  id: number;
  customer_email: string;
  amount: number; // positive = credited, negative = spent
  reason: string;
  order_id: string | null;
  created_at: string | null;
}

export interface StoreCreditStore {
  /** Atomic: caps the debit at whatever balance actually exists; returns the amount actually
   *  applied (0 if the customer has no account or no balance). */
  debitIfAvailable(email: string, requestedAmount: number): Promise<{ ok: boolean; applied: number }>;
  insertTransaction(row: Omit<StoreCreditTransactionRow, "id" | "created_at">): Promise<void>;
  getBalance(email: string): Promise<number>;
  listTransactionsByEmail(email: string): Promise<StoreCreditTransactionRow[]>;
}

export interface StoreCreditResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

/** PREVIEW ONLY. Public but token-gated at the route (see routes/coupons.ts). */
export async function getStoreCreditBalance(store: StoreCreditStore, email: string): Promise<StoreCreditResult<{ balance: number }>> {
  return { ok: true, data: { balance: await store.getBalance(email) } };
}

/**
 * The real, authoritative debit — called from orders.ts's createOrder the same way redeemCoupon
 * is: after the order/items exist, using the order's own server-computed (post-coupon) subtotal.
 */
export async function spendStoreCredit(store: StoreCreditStore, email: string, requestedAmount: number, orderId: string): Promise<StoreCreditResult<{ applied: number }>> {
  const result = await store.debitIfAvailable(email, requestedAmount);
  if (!result.ok || result.applied <= 0) return { ok: false, error: "Store credit could not be applied" };
  await store.insertTransaction({ customer_email: email, amount: -result.applied, reason: "Applied at checkout", order_id: orderId });
  return { ok: true, data: { applied: result.applied } };
}

export async function myStoreCreditTransactions(store: StoreCreditStore, email: string): Promise<StoreCreditResult<{ balance: number; transactions: StoreCreditTransactionRow[] }>> {
  const [balance, rows] = await Promise.all([store.getBalance(email), store.listTransactionsByEmail(email)]);
  return { ok: true, data: { balance, transactions: rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")) } };
}

// ── In-memory test double ──
export class StoreCreditStoreFake implements StoreCreditStore {
  accounts = new Set<string>(); // emails with a customer account
  balances = new Map<string, number>();
  transactions: StoreCreditTransactionRow[] = [];
  private nextId = 1;

  async debitIfAvailable(email: string, requestedAmount: number): Promise<{ ok: boolean; applied: number }> {
    const target = email.toLowerCase();
    const balance = this.balances.get(target) ?? 0;
    if (balance <= 0) return { ok: false, applied: 0 };
    const applied = Math.min(balance, requestedAmount);
    this.balances.set(target, round2(balance - applied));
    return { ok: true, applied };
  }
  async insertTransaction(row: Omit<StoreCreditTransactionRow, "id" | "created_at">): Promise<void> {
    this.transactions.push({ ...row, id: this.nextId++, created_at: new Date().toISOString() });
  }
  async getBalance(email: string): Promise<number> {
    return this.balances.get(email.toLowerCase()) ?? 0;
  }
  async listTransactionsByEmail(email: string): Promise<StoreCreditTransactionRow[]> {
    const target = email.toLowerCase();
    return this.transactions.filter((t) => t.customer_email.toLowerCase() === target);
  }
}
