// Coupons: dollar-amount and percent-off promotional codes. New feature, not a PHP port — written
// against a small store interface + in-memory fake, same shape as every other module in this
// migration (customers.ts, orders.ts, products.ts).
//
// ── One code per coupon, not one code per physical copy ──
// A coupon is a single code (admin-supplied or auto-generated) with a `quantity` — the max number
// of times it may be redeemed across all customers. Each use is independently capped at `amount`
// (or the order's subtotal if smaller) — there is no shared dollar pool split across uses.
// "Number created"/"number used" are `quantity`/`used_count`, stored directly on the row and
// incremented atomically on redemption (see redeem_coupon_if_available in
// supabase/migrations/0012_coupons.sql).
//
// ── One redemption per customer per code ──
// coupon_redemptions_code_email_uidx (partial, excludes null emails) enforces this at the DB
// level — the true race-safe backstop. validateCoupon/redeemCoupon both also check it directly so
// the error message is immediate rather than surfacing as a generic insert failure.
//
// ── Leftover becomes store credit, not a coupon-side balance ──
// When a dollar coupon's face value exceeds what an order actually needed, the difference is
// credited to the customer's account (see store-credit.ts) — but only when the order's email
// matches a real customer account; guests simply don't collect it. This replaced an earlier,
// wrong design where the coupon itself carried a shared balance across uses.
//
// ── Never trust a client-supplied discount ──
// validateCoupon is a PREVIEW only (used by the storefront's "Apply" button before the order
// exists) and never mutates anything. The real, authoritative discount is computed server-side
// inside orders.ts's createOrder from the order's own real subtotal, then redeemCoupon() performs
// the actual atomic mutation — mirrors payments.ts's "never trust the client total" rule.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CouponType = "dollar" | "percent";

export interface CouponRow {
  code: string;
  coupon_type: CouponType;
  amount: number;
  quantity: number;
  used_count: number;
  expires_at: string | null;
  active: boolean;
  created_at: string | null;
}

export interface CouponRedemptionRow {
  id: number;
  code: string;
  order_id: string;
  customer_email: string | null;
  discount_amount: number;
  redeemed_at: string | null;
}

export interface CouponDto {
  code: string;
  type: CouponType;
  amount: number;
  created: number;
  used: number;
  expires_at: string | null;
  active: boolean;
}

export interface CouponsStore {
  insertCoupon(row: CouponRow): Promise<void>;
  listCoupons(): Promise<CouponRow[]>;
  setActive(code: string, active: boolean): Promise<void>;

  getCoupon(code: string): Promise<CouponRow | null>;
  /** Whether this email has already redeemed this code — enforces one use per customer per code. */
  hasRedeemed(code: string, email: string): Promise<boolean>;
  /** Atomic: true only if the code existed, wasn't expired/inactive, and had used_count < quantity.
   *  Returns the amount actually applied (equal to requestedDiscount when ok). */
  redeemIfAvailable(code: string, requestedDiscount: number): Promise<{ ok: boolean; applied: number }>;
  insertRedemption(row: Omit<CouponRedemptionRow, "id" | "redeemed_at">): Promise<void>;
  listRedemptionsByEmail(email: string): Promise<CouponRedemptionRow[]>;
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
  code?: string;
  coupon_type: CouponType;
  amount: number;
  quantity: number;
  expires_at?: string | null;
}

/** Caller must have already required admin. */
export async function createCoupon(store: CouponsStore, input: CreateCouponInput, now: Date = new Date()): Promise<CouponsResult<{ code: string }>> {
  if (input.coupon_type !== "dollar" && input.coupon_type !== "percent") return { ok: false, error: "Invalid coupon type" };
  if (!(input.amount > 0)) return { ok: false, error: "Amount must be greater than 0" };
  if (input.coupon_type === "percent" && input.amount > 100) return { ok: false, error: "Percent coupons cannot exceed 100%" };
  const quantity = Math.floor(Number(input.quantity));
  if (!(quantity >= 1 && quantity <= 100000)) return { ok: false, error: "Quantity must be at least 1" };

  let code = (input.code ?? "").toUpperCase().trim();
  if (code) {
    if (!/^[A-Z0-9_-]{3,20}$/.test(code)) return { ok: false, error: "Code must be 3-20 letters, numbers, hyphens, or underscores" };
    if (await store.getCoupon(code)) return { ok: false, error: "That coupon code is already in use" };
  } else {
    do {
      code = randomCode();
    } while (await store.getCoupon(code));
  }

  await store.insertCoupon({
    code,
    coupon_type: input.coupon_type,
    amount: round2(input.amount),
    quantity,
    used_count: 0,
    expires_at: input.expires_at ?? null,
    active: true,
    created_at: now.toISOString(),
  });

  return { ok: true, data: { code } };
}

/** Caller must have already required admin. */
export async function listCoupons(store: CouponsStore): Promise<CouponsResult<{ coupons: CouponDto[] }>> {
  const rows = await store.listCoupons();
  return {
    ok: true,
    data: {
      coupons: rows.map((r) => ({
        code: r.code,
        type: r.coupon_type,
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
export async function deactivateCoupon(store: CouponsStore, code: string): Promise<CouponsResult> {
  if (!code) return { ok: false, error: "Missing coupon code" };
  await store.setActive(code.toUpperCase().trim(), false);
  return { ok: true };
}

function isExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  return expiresAt < now.toISOString().slice(0, 10);
}

export interface CouponPreview {
  code: string;
  type: CouponType;
  discount: number;
}

/** PREVIEW ONLY — never mutates. Public (no admin gate); the storefront's "Apply" button calls
 *  this before an order exists. subtotal is the cart's current pre-tax/shipping subtotal. email is
 *  optional (a guest hasn't necessarily filled it in yet when previewing) — when present, the
 *  once-per-customer check runs here too so the checkout UI can show an immediate error. */
export async function validateCoupon(store: CouponsStore, code: string, subtotal: number, email?: string, now: Date = new Date()): Promise<CouponsResult<CouponPreview>> {
  if (!code) return { ok: false, error: "Please enter a coupon code" };
  const normalizedCode = code.toUpperCase().trim();
  const coupon = await store.getCoupon(normalizedCode);
  if (!coupon || !coupon.active) return { ok: false, error: "Coupon not found" };
  if (isExpired(coupon.expires_at, now)) return { ok: false, error: "This coupon has expired" };
  if (coupon.used_count >= coupon.quantity) return { ok: false, error: "This coupon has already been fully used" };
  if (!(subtotal > 0)) return { ok: false, error: "Your cart is empty" };
  if (email && (await store.hasRedeemed(normalizedCode, email))) return { ok: false, error: "You've already used this coupon" };

  const discount = coupon.coupon_type === "dollar" ? Math.min(coupon.amount, subtotal) : round2(subtotal * (coupon.amount / 100));
  return { ok: true, data: { code: coupon.code, type: coupon.coupon_type, discount: round2(discount) } };
}

/**
 * The real, authoritative redemption — called from orders.ts's createOrder AFTER the order and its
 * real line items already exist, using the order's server-computed subtotal (never a client-sent
 * number). Returns the amount actually applied so the caller can size the `_coupon` line item, or
 * roll back if the coupon became invalid.
 */
export async function redeemCoupon(
  store: CouponsStore,
  code: string,
  requestedDiscount: number,
  orderId: string,
  email: string | null
): Promise<CouponsResult<{ applied: number }>> {
  const normalizedCode = code.toUpperCase().trim();
  if (email && (await store.hasRedeemed(normalizedCode, email))) return { ok: false, error: "You've already used this coupon" };

  const result = await store.redeemIfAvailable(normalizedCode, requestedDiscount);
  if (!result.ok || result.applied <= 0) return { ok: false, error: "Coupon could not be applied" };
  await store.insertRedemption({ code: normalizedCode, order_id: orderId, customer_email: email, discount_amount: result.applied });
  return { ok: true, data: { applied: result.applied } };
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
  const rows = await store.listRedemptionsByEmail(email);
  return {
    ok: true,
    data: {
      redemptions: rows
        .sort((a, b) => (b.redeemed_at ?? "").localeCompare(a.redeemed_at ?? ""))
        .map((r) => ({ code: r.code, discount: Number(r.discount_amount), date: r.redeemed_at ?? "", order_id: r.order_id })),
    },
  };
}

// ── In-memory test double ──
export class CouponsStoreFake implements CouponsStore {
  coupons: CouponRow[] = [];
  redemptions: CouponRedemptionRow[] = [];
  private nextRedemptionId = 1;

  async insertCoupon(row: CouponRow): Promise<void> {
    this.coupons.push(row);
  }
  async listCoupons(): Promise<CouponRow[]> {
    return this.coupons;
  }
  async setActive(code: string, active: boolean): Promise<void> {
    const c = this.coupons.find((x) => x.code === code);
    if (c) c.active = active;
  }
  async getCoupon(code: string): Promise<CouponRow | null> {
    return this.coupons.find((c) => c.code === code) ?? null;
  }
  async hasRedeemed(code: string, email: string): Promise<boolean> {
    const target = email.toLowerCase();
    return this.redemptions.some((r) => r.code === code && (r.customer_email ?? "").toLowerCase() === target);
  }
  async redeemIfAvailable(code: string, requestedDiscount: number): Promise<{ ok: boolean; applied: number }> {
    const c = this.coupons.find((x) => x.code === code);
    if (!c || !c.active) return { ok: false, applied: 0 };
    if (isExpired(c.expires_at, new Date())) return { ok: false, applied: 0 };
    if (c.used_count >= c.quantity) return { ok: false, applied: 0 };
    c.used_count += 1;
    return { ok: true, applied: requestedDiscount };
  }
  async insertRedemption(row: Omit<CouponRedemptionRow, "id" | "redeemed_at">): Promise<void> {
    this.redemptions.push({ ...row, id: this.nextRedemptionId++, redeemed_at: new Date().toISOString() });
  }
  async listRedemptionsByEmail(email: string): Promise<CouponRedemptionRow[]> {
    const target = email.toLowerCase();
    return this.redemptions.filter((r) => (r.customer_email ?? "").toLowerCase() === target);
  }
}
