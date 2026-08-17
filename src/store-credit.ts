// Store credit: a per-customer balance, credited when a dollar coupon's face value exceeds what
// an order actually needed (see coupons.ts's header), spendable at a later checkout the same way a
// coupon discount is applied (orders.ts's `_credit` line item). New feature, not a PHP port — same
// store-interface + fake pattern as every other module in this migration.

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
  /** Adds `amount` to the customer's balance and returns true — or false if no customer account
   *  matches that email (guest orders simply don't collect it). */
  creditIfAccountExists(email: string, amount: number, reason: string, orderId: string): Promise<boolean>;
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

/** Called from orders.ts's createOrder after a dollar coupon redemption leaves a difference
 *  between its face value and what the order actually used. No-op (and no ledger entry) when the
 *  order's email has no matching customer account. */
export async function creditLeftoverToAccount(store: StoreCreditStore, email: string | null, amount: number, orderId: string): Promise<void> {
  if (!email || !(amount > 0)) return;
  const credited = await store.creditIfAccountExists(email, round2(amount), "Unused coupon balance", orderId);
  if (credited) await store.insertTransaction({ customer_email: email, amount: round2(amount), reason: "Unused coupon balance", order_id: orderId });
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

  async creditIfAccountExists(email: string, amount: number, _reason: string, _orderId: string): Promise<boolean> {
    const target = email.toLowerCase();
    if (!this.accounts.has(target)) return false;
    this.balances.set(target, round2((this.balances.get(target) ?? 0) + amount));
    return true;
  }
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
