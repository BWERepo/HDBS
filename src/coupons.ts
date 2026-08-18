// Coupons: a named batch generates `quantity` individually-tracked, single-use random codes, one
// printed per physical copy. New feature, not a PHP port — written against a small store
// interface + in-memory fake, same shape as every other module in this migration (customers.ts,
// orders.ts, products.ts).
//
// ── A batch is a label, not a redeemable code ──
// `name` is purely an admin-facing label (e.g. "Fall Sale Flyer"). The thing a customer actually
// types at checkout is one of the `quantity` random codes generated when the batch is created
// (see coupon_codes in supabase/migrations/0014_coupon_codes.sql) — there is no single shared code
// anymore.
//
// ── Each code is single-use, full stop ──
// `coupon_codes.redeemed_at is null` means unused. Once redeemed, a code is done — no quantity
// pool, no per-customer-per-code tracking needed, since a code can only ever be used once by
// anyone (mirrors how a real printed paper coupon works). redeem_code_if_available atomically
// checks-and-consumes a code in one round trip (see supabase/migrations/0014_coupon_codes.sql).
//
// ── Never trust a client-supplied discount ──
// validateCoupon is a PREVIEW only (used by the storefront's "Apply" button before the order
// exists) and never mutates anything. The real, authoritative discount is computed server-side
// inside orders.ts's createOrder from the order's own real subtotal, then redeemCoupon() performs
// the actual atomic mutation — mirrors payments.ts's "never trust the client total" rule.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface CouponBatchRow {
  id: number;
  name: string;
  amount: number; // percent, 1-100
  quantity: number;
  active: boolean;
  expires_at: string | null;
  created_at: string | null;
  used_count: number;
}

export interface CouponCodeRow {
  code: string;
  batch_id: number;
  order_id: string | null;
  customer_email: string | null;
  discount_amount: number | null;
  redeemed_at: string | null;
  created_at: string | null;
}

/** What's needed to preview/redeem one code, without fetching the whole batch row. */
export interface CouponCodeLookup {
  code: string;
  redeemed_at: string | null;
  batch_active: boolean;
  batch_amount: number;
  batch_expires_at: string | null;
}

export interface CouponBatchDto {
  id: number;
  name: string;
  amount: number;
  created: number; // quantity
  used: number;
  expires_at: string | null;
  active: boolean;
}

export interface CouponsStore {
  insertBatch(row: Omit<CouponBatchRow, "id" | "used_count">): Promise<number>;
  insertCodes(rows: { code: string; batch_id: number }[]): Promise<void>;
  listBatches(): Promise<CouponBatchRow[]>;
  getBatch(id: number): Promise<CouponBatchRow | null>;
  setActive(id: number, active: boolean): Promise<void>;
  updateBatch(id: number, fields: { amount: number; expires_at: string | null }): Promise<void>;
  /** Caller must have already confirmed used_count === 0 — the DB's FK (coupon_codes.batch_id)
   *  would reject an in-use batch's codes being orphaned anyway, but checking first gives a
   *  friendlier error than a raw FK-violation message. */
  deleteBatch(id: number): Promise<void>;
  listCodesByBatch(id: number): Promise<CouponCodeRow[]>;

  codeExists(code: string): Promise<boolean>;
  getCodeForValidation(code: string): Promise<CouponCodeLookup | null>;
  /** Atomic: true only if the code existed, was unused, and its batch was active/not expired.
   *  Stamps order_id/customer_email/discount_amount/redeemed_at on the code row in the same
   *  operation. */
  redeemCodeIfAvailable(code: string, orderId: string, email: string | null, discountAmount: number): Promise<{ ok: boolean }>;
  listCodesByEmail(email: string): Promise<CouponCodeRow[]>;
}

export interface CouponsResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export interface CreateCouponInput {
  name: string;
  amount: number;
  quantity: number;
  expires_at?: string | null;
}

/** Caller must have already required admin. Generates `quantity` distinct random codes — codes
 *  are globally unique (coupon_codes.code is the primary key), not just unique within the batch. */
export async function createCoupon(store: CouponsStore, input: CreateCouponInput, now: Date = new Date()): Promise<CouponsResult<{ id: number; codes: string[] }>> {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Please enter a name for this coupon" };
  if (!(input.amount > 0)) return { ok: false, error: "Amount must be greater than 0" };
  if (input.amount > 100) return { ok: false, error: "Percent coupons cannot exceed 100%" };
  const quantity = Math.floor(Number(input.quantity));
  if (!(quantity >= 1 && quantity <= 500)) return { ok: false, error: "Quantity must be between 1 and 500" };

  const id = await store.insertBatch({
    name,
    amount: round2(input.amount),
    quantity,
    active: true,
    expires_at: input.expires_at ?? null,
    created_at: now.toISOString(),
  });

  const codes: string[] = [];
  for (let i = 0; i < quantity; i++) {
    let code: string;
    do {
      code = randomCode();
    } while (codes.includes(code) || (await store.codeExists(code)));
    codes.push(code);
  }
  await store.insertCodes(codes.map((code) => ({ code, batch_id: id })));

  return { ok: true, data: { id, codes } };
}

/** Caller must have already required admin. */
export async function listCoupons(store: CouponsStore): Promise<CouponsResult<{ coupons: CouponBatchDto[] }>> {
  const rows = await store.listBatches();
  return {
    ok: true,
    data: {
      coupons: rows.map((r) => ({
        id: r.id,
        name: r.name,
        amount: Number(r.amount),
        created: r.quantity,
        used: r.used_count,
        expires_at: r.expires_at,
        active: r.active,
      })),
    },
  };
}

/** Caller must have already required admin. */
export async function deactivateCoupon(store: CouponsStore, id: number): Promise<CouponsResult> {
  if (!(await store.getBatch(id))) return { ok: false, error: "Coupon not found" };
  await store.setActive(id, false);
  return { ok: true };
}

export interface EditCouponInput {
  amount: number;
  expires_at?: string | null;
}

/** Caller must have already required admin. Name and quantity are fixed at creation — quantity
 *  is baked into how many codes already exist, and changing it would mean regenerating/discarding
 *  codes that may already be printed and in a customer's hand. */
export async function editCoupon(store: CouponsStore, id: number, input: EditCouponInput): Promise<CouponsResult> {
  const existing = await store.getBatch(id);
  if (!existing) return { ok: false, error: "Coupon not found" };
  if (!(input.amount > 0)) return { ok: false, error: "Amount must be greater than 0" };
  if (input.amount > 100) return { ok: false, error: "Percent coupons cannot exceed 100%" };

  await store.updateBatch(id, { amount: round2(input.amount), expires_at: input.expires_at ?? null });
  return { ok: true };
}

/** Caller must have already required admin. Refuses to delete a batch that's had any code
 *  redeemed — deactivate it instead so redemption history (order_id/email/discount on those
 *  codes) stays intact. */
export async function deleteCoupon(store: CouponsStore, id: number): Promise<CouponsResult> {
  const existing = await store.getBatch(id);
  if (!existing) return { ok: false, error: "Coupon not found" };
  if (existing.used_count > 0) return { ok: false, error: "This coupon has codes that have already been used and can't be deleted — deactivate it instead" };

  await store.deleteBatch(id);
  return { ok: true };
}

function isExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  return expiresAt < now.toISOString().slice(0, 10);
}

export interface CouponPreview {
  code: string;
  discount: number;
}

/** PREVIEW ONLY — never mutates. Public (no admin gate); the storefront's "Apply" button calls
 *  this before an order exists. subtotal is the cart's current pre-tax/shipping subtotal. */
export async function validateCoupon(store: CouponsStore, code: string, subtotal: number, _email?: string, now: Date = new Date()): Promise<CouponsResult<CouponPreview>> {
  if (!code) return { ok: false, error: "Please enter a coupon code" };
  const normalizedCode = code.toUpperCase().trim();
  const lookup = await store.getCodeForValidation(normalizedCode);
  if (!lookup || !lookup.batch_active) return { ok: false, error: "Coupon not found" };
  if (lookup.redeemed_at) return { ok: false, error: "This coupon has already been used" };
  if (isExpired(lookup.batch_expires_at, now)) return { ok: false, error: "This coupon has expired" };
  if (!(subtotal > 0)) return { ok: false, error: "Your cart is empty" };

  const discount = round2(subtotal * (lookup.batch_amount / 100));
  return { ok: true, data: { code: normalizedCode, discount } };
}

/**
 * The real, authoritative redemption — called from orders.ts's createOrder AFTER the order and its
 * real line items already exist, using the order's server-computed subtotal (never a client-sent
 * number). Returns the amount actually applied so the caller can size the `_coupon` line item, or
 * roll back if the code became invalid.
 */
export async function redeemCoupon(
  store: CouponsStore,
  code: string,
  requestedDiscount: number,
  orderId: string,
  email: string | null
): Promise<CouponsResult<{ applied: number }>> {
  const normalizedCode = code.toUpperCase().trim();
  const result = await store.redeemCodeIfAvailable(normalizedCode, orderId, email, requestedDiscount);
  if (!result.ok) return { ok: false, error: "Coupon could not be applied" };
  return { ok: true, data: { applied: requestedDiscount } };
}

export interface RedemptionDto {
  code: string;
  discount: number;
  date: string;
  order_id: string;
}

/** Public, but only reachable via a verified order-token (see routes/coupons.ts) — same trust
 *  model as customers.ts's order-lookup flow. */
export async function myCouponRedemptions(store: CouponsStore, email: string): Promise<CouponsResult<{ redemptions: RedemptionDto[] }>> {
  const rows = await store.listCodesByEmail(email);
  return {
    ok: true,
    data: {
      redemptions: rows
        .filter((r) => r.redeemed_at)
        .sort((a, b) => (b.redeemed_at ?? "").localeCompare(a.redeemed_at ?? ""))
        .map((r) => ({ code: r.code, discount: Number(r.discount_amount ?? 0), date: r.redeemed_at ?? "", order_id: r.order_id ?? "" })),
    },
  };
}

export interface CouponCodeDto {
  code: string;
  used: boolean;
  order_id: string | null;
  email: string | null;
  discount: number | null;
  date: string | null;
}

/** Caller must have already required admin. The admin "View" screen — every code generated for a
 *  batch, used and unused, and which sale a used one belongs to. */
export async function listCouponCodes(store: CouponsStore, batchId: number): Promise<CouponsResult<{ codes: CouponCodeDto[] }>> {
  if (!(await store.getBatch(batchId))) return { ok: false, error: "Coupon not found" };
  const rows = await store.listCodesByBatch(batchId);
  return {
    ok: true,
    data: {
      codes: rows
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((r) => ({
          code: r.code,
          used: !!r.redeemed_at,
          order_id: r.order_id,
          email: r.customer_email,
          discount: r.discount_amount !== null ? Number(r.discount_amount) : null,
          date: r.redeemed_at,
        })),
    },
  };
}

// ── In-memory test double ──
export class CouponsStoreFake implements CouponsStore {
  batches: CouponBatchRow[] = [];
  codes: CouponCodeRow[] = [];
  private nextId = 1;

  async insertBatch(row: Omit<CouponBatchRow, "id" | "used_count">): Promise<number> {
    const id = this.nextId++;
    this.batches.push({ ...row, id, used_count: 0 });
    return id;
  }
  async insertCodes(rows: { code: string; batch_id: number }[]): Promise<void> {
    for (const r of rows) {
      this.codes.push({ code: r.code, batch_id: r.batch_id, order_id: null, customer_email: null, discount_amount: null, redeemed_at: null, created_at: new Date().toISOString() });
    }
  }
  async listBatches(): Promise<CouponBatchRow[]> {
    return this.batches.map((b) => ({ ...b, used_count: this.codes.filter((c) => c.batch_id === b.id && c.redeemed_at).length }));
  }
  async getBatch(id: number): Promise<CouponBatchRow | null> {
    const b = this.batches.find((x) => x.id === id);
    if (!b) return null;
    return { ...b, used_count: this.codes.filter((c) => c.batch_id === id && c.redeemed_at).length };
  }
  async setActive(id: number, active: boolean): Promise<void> {
    const b = this.batches.find((x) => x.id === id);
    if (b) b.active = active;
  }
  async updateBatch(id: number, fields: { amount: number; expires_at: string | null }): Promise<void> {
    const b = this.batches.find((x) => x.id === id);
    if (b) {
      b.amount = fields.amount;
      b.expires_at = fields.expires_at;
    }
  }
  async deleteBatch(id: number): Promise<void> {
    this.batches = this.batches.filter((b) => b.id !== id);
    this.codes = this.codes.filter((c) => c.batch_id !== id);
  }
  async listCodesByBatch(id: number): Promise<CouponCodeRow[]> {
    return this.codes.filter((c) => c.batch_id === id);
  }
  async codeExists(code: string): Promise<boolean> {
    return this.codes.some((c) => c.code === code);
  }
  async getCodeForValidation(code: string): Promise<CouponCodeLookup | null> {
    const c = this.codes.find((x) => x.code === code);
    if (!c) return null;
    const b = this.batches.find((x) => x.id === c.batch_id);
    if (!b) return null;
    return { code: c.code, redeemed_at: c.redeemed_at, batch_active: b.active, batch_amount: b.amount, batch_expires_at: b.expires_at };
  }
  async redeemCodeIfAvailable(code: string, orderId: string, email: string | null, discountAmount: number): Promise<{ ok: boolean }> {
    const c = this.codes.find((x) => x.code === code);
    if (!c || c.redeemed_at) return { ok: false };
    const b = this.batches.find((x) => x.id === c.batch_id);
    if (!b || !b.active) return { ok: false };
    if (isExpired(b.expires_at, new Date())) return { ok: false };
    c.redeemed_at = new Date().toISOString();
    c.order_id = orderId;
    c.customer_email = email;
    c.discount_amount = discountAmount;
    return { ok: true };
  }
  async listCodesByEmail(email: string): Promise<CouponCodeRow[]> {
    const target = email.toLowerCase();
    return this.codes.filter((c) => (c.customer_email ?? "").toLowerCase() === target);
  }
}
