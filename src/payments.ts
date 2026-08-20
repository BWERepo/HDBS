// Payments: ports api/process_payment.php (Square charge), api/paypal.php + paypal_create.php +
// paypal_capture.php (PayPal Orders v2), and api/square-webhook.php (async status backstop).
//
// ── Why there's no runtime sandbox/live branch here ──
// The PHP reads a `square_mode` DB setting and a `pp_env()` hostname check to pick sandbox vs.
// live credentials/URLs at request time. This migration's own architecture (src/types.ts's
// header) already replaced that: secret NAMES are identical across both Workers, only the VALUES
// differ, and apiHosts(env) picks the base URL from ENVIRONMENT. So this file takes an
// already-configured SquareGateway/PayPalGateway (see src/lib/square-gateway.ts,
// src/lib/paypal-gateway.ts) rather than branching on mode itself — the branch already happened
// once, at Worker-config time, not on every request.
//
// ── Square vs. PayPal test_mode: three different orderings, all preserved ──
// process_payment.php's test_mode branch returns BEFORE the atomic Processing-lock claim.
// paypal_create.php's test_mode branch returns BEFORE even loading the order row (create doesn't
// mutate order state, so there's nothing to lock). paypal_capture.php's test_mode branch runs
// AFTER the atomic claim — so a test-mode capture still locks the order to 'Processing' before
// marking it Paid. This looks inconsistent across the three PHP files, and it is, but it's real,
// observable behavior (a concurrent second request during a "test mode" capture would see the
// order as briefly Processing, but not during a "test mode" charge or create) — ported faithfully
// per-function rather than unified into one consistent shape.
//
// ── MD5 -> SHA-256 substitution ──
// process_payment.php's Square idempotency key is `$order_id . '-' . substr(md5($source_id), 0,
// 8)`. Workers' Web Crypto has no MD5. The 8-hex-char suffix only needs to be a stable,
// collision-resistant function of source_id for Square's own idempotency semantics — nothing
// compares it against a stored PHP-generated value — so a SHA-256 prefix substitutes cleanly,
// same reasoning as routes/orders.ts's identical sha256Hex helper for rate-limit keys.

import type { OrderRow, OrderItemRow, OrdersStore, OrderUpdatableFields } from "./orders";
import type { SquareGateway } from "./lib/square-gateway";
import type { PayPalGateway } from "./lib/paypal-gateway";
import type { EmailSender } from "./lib/email-sender";
import type { EmailOrderStore, PaymentOrderSummary, PaymentLineItem } from "./email";
import { sendPaymentReceivedEmail } from "./email";
import type { AppLogStore } from "./app-log";

/** Best-effort: an app_log write failing must never fail the payment/refund it's logging about. */
async function logNotify(appLog: AppLogStore | undefined, context: string, message: string): Promise<void> {
  if (!appLog) return;
  try {
    await appLog.append("notify_log.txt", { context, message });
  } catch {
    // swallow — logging is not on the critical path
  }
}

export interface PaymentsResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface PaymentCustomersStore {
  incrementOrderCount(email: string): Promise<void>;
}

export interface PaymentSettingsStore {
  getSetting(key: string): Promise<string | null>;
}

export interface PaymentBizInfo {
  name: string;
  email: string;
}

// ── Shared amount math ──

// Mirrors process_payment.php's inline recompute AND paypal.php's pp_order_amounts() — the two
// PHP files duplicate identical math; this is the one place it lives in the port.
const TAX_RATE = 0.0975;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface OrderAmounts {
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
}

/** Recomputes an order's total server-side from its own stored line items — never trusts the
 *  client. Identical math to both process_payment.php's inline version and pp_order_amounts(). */
export function computeOrderAmounts(items: Pick<OrderItemRow, "product_id" | "price" | "quantity">[]): OrderAmounts {
  let subtotal = 0;
  let shipping = 0;
  for (const it of items) {
    if (it.product_id === "_ship") shipping = Number(it.price ?? 0);
    else subtotal += Number(it.price ?? 0) * Number(it.quantity ?? 0);
  }
  const tax = round2(subtotal * TAX_RATE);
  const total = round2(subtotal + shipping + tax);
  return { subtotal, shipping, tax, total };
}

/** Ports pp_surcharge(): a customer-facing PayPal/Venmo processing fee, added only when paying via
 *  PayPal — Square/card customers never see it; the business absorbs Square's fee instead. Admin
 *  sets the rate via Settings -> PayPal Transaction Fees (`paypal_fees` setting); falls back to
 *  PayPal's published standard Checkout rate if unset or corrupt. */
export async function computePaypalSurcharge(settings: PaymentSettingsStore, amount: number): Promise<number> {
  let pct = 3.49;
  let cents = 0.49;
  const raw = await settings.getSetting("paypal_fees");
  if (raw) {
    try {
      const f = JSON.parse(raw) as { pct?: unknown; cents?: unknown };
      if (typeof f.pct === "number") pct = f.pct;
      if (typeof f.cents === "number") cents = f.cents;
    } catch {
      // keep defaults — matches the PHP's try/catch around json_decode
    }
  }
  return round2((amount * pct) / 100 + cents);
}

/** Customer-facing Square/card processing fee, mirroring computePaypalSurcharge exactly — added
 *  only when paying by card. Until this existed, Square/card customers never saw a fee at all;
 *  the business absorbed Square's cut of the payout instead (still tracked separately as
 *  `transaction_fee`, what Square actually withheld — unrelated to this customer-facing amount).
 *  Admin sets the rate via Settings -> Square Fees (`square_fees` setting, the same one the
 *  Receipt/Inventory reports already assume); falls back to js/config.js's own hardcoded default
 *  (2.6% + $0.10) if unset or corrupt. */
export async function computeSquareSurcharge(settings: PaymentSettingsStore, amount: number): Promise<number> {
  let pct = 2.6;
  let cents = 0.1;
  const raw = await settings.getSetting("square_fees");
  if (raw) {
    try {
      const f = JSON.parse(raw) as { pct?: unknown; cents?: unknown };
      if (typeof f.pct === "number") pct = f.pct;
      if (typeof f.cents === "number") cents = f.cents;
    } catch {
      // keep defaults — matches computePaypalSurcharge's own try/catch
    }
  }
  return round2((amount * pct) / 100 + cents);
}

async function shortHashHex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 8);
}

function toEmailItems(items: OrderItemRow[]): PaymentLineItem[] {
  return items.map((i) => ({ product_id: i.product_id, product_name: i.product_name, price: Number(i.price ?? 0), quantity: Number(i.quantity ?? 0) }));
}

function toEmailSummary(order: OrderRow, paymentMethod: string): PaymentOrderSummary {
  return {
    id: order.id,
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    shipping_address: order.shipping_address,
    payment_method: paymentMethod,
    check_number: order.check_number,
  };
}

// ── Square charge (process_payment.php) ──

export interface SquareChargeInput {
  order_id?: string;
  source_id?: string;
  test_mode?: boolean;
}

/**
 * Ports api/process_payment.php in full: server-side total recompute, the atomic
 * Awaiting-Payment -> Processing claim (prevents a double-charge from concurrent requests), the
 * Square API charge, and — on success — marking the order Paid, bumping the customer's order
 * count, and sending the payment-received confirmation email. A charge that fails, or completes
 * with a non-COMPLETED status, releases the Processing claim so the customer can retry.
 */
export async function chargeOrderWithSquare(
  store: OrdersStore,
  gateway: SquareGateway,
  settings: PaymentSettingsStore,
  customersStore: PaymentCustomersStore,
  emailStore: Pick<EmailOrderStore, "logEmail">,
  emailSender: EmailSender,
  biz: PaymentBizInfo,
  squareLocationId: string,
  input: SquareChargeInput,
  isAdmin: boolean,
  now: Date = new Date(),
  appLog?: AppLogStore
): Promise<PaymentsResult<{ message: string; payment_id: string; total: number; order_id: string }>> {
  const orderId = (input.order_id ?? "").trim();
  const sourceId = (input.source_id ?? "").trim();
  if (!sourceId || !orderId) return { ok: false, error: "Missing source_id or order_id" };

  const order = await store.getOrder(orderId);
  if (!order) return { ok: false, error: "Order not found", status: 404 };
  if (order.status !== "Awaiting Payment") return { ok: false, error: "Order is not awaiting payment" };

  const items = await store.getOrderItems(orderId);
  const amounts = computeOrderAmounts(items);
  const { shipping, tax } = amounts;
  const surcharge = await computeSquareSurcharge(settings, amounts.total);
  const total = round2(amounts.total + surcharge);

  // test_mode: admin-only regression-suite bypass. Returns BEFORE the atomic claim below — see
  // this file's header for why that differs from paypal_capture.php's test_mode. No surcharge
  // here, matching capturePaypalOrderForCheckout's own test_mode branch (a real card is never
  // charged in this path, so there's nothing to add a card fee to).
  if (input.test_mode) {
    if (!isAdmin) return { ok: false, error: "Unauthorized", status: 401 };
    await store.updateOrderFields(orderId, { status: "Paid", total: amounts.total, tax_amount: tax, confirm_sent_at: now.toISOString() });
    return { ok: true, data: { message: "Test payment accepted", total: amounts.total, order_id: orderId, payment_id: "" } };
  }

  if (!squareLocationId) return { ok: false, error: "Payment not configured" };

  if (!(await store.claimForProcessing(orderId))) {
    return { ok: false, error: "Order is no longer awaiting payment. Please refresh and try again." };
  }

  const idempotencyKey = `${orderId}-${await shortHashHex(sourceId)}`;
  const charge = await gateway.charge({
    sourceId,
    idempotencyKey,
    amountCents: Math.round(total * 100),
    locationId: squareLocationId,
    note: orderId,
    buyerEmail: order.customer_email ?? "",
  });

  if (!charge.ok) {
    await store.releaseFromProcessing(orderId);
    console.error("PAYMENT-FAIL", { orderId, locationId: squareLocationId, error: charge.message });
    await logNotify(appLog, "PAYMENT-FAIL", `Order: ${orderId} | ${charge.message}`);
    return { ok: false, error: charge.message };
  }
  if (charge.status !== "COMPLETED") {
    await store.releaseFromProcessing(orderId);
    return { ok: false, error: `Payment not completed. Status: ${charge.status}` };
  }

  const paidFields: Partial<OrderUpdatableFields> = {
    status: "Paid",
    square_payment_id: charge.paymentId,
    total,
    tax_amount: tax,
    square_surcharge: surcharge,
    confirm_sent_at: now.toISOString(),
  };
  try {
    await store.updateOrderFields(orderId, paidFields);
  } catch (e) {
    // Mirrors process_payment.php's CHARGE-ORPHANED applog entry: the card WAS charged, so this
    // must never look like the payment itself failed — only the record-keeping did.
    console.error("CHARGE-ORPHANED", { orderId, paymentId: charge.paymentId, error: e });
    return { ok: false, error: `Payment received but order update failed. Please contact us with order reference: ${orderId}` };
  }

  if (order.customer_email) await customersStore.incrementOrderCount(order.customer_email);

  await sendPaymentReceivedEmail(
    emailStore,
    emailSender,
    biz.name,
    biz.email,
    toEmailSummary(order, order.payment_method ?? "Credit Card"),
    toEmailItems(items),
    total,
    shipping,
    tax,
    charge.paymentId,
    surcharge
  );

  return { ok: true, data: { message: "Payment successful", payment_id: charge.paymentId, total, order_id: orderId } };
}

// ── PayPal create (paypal_create.php) ──

export interface PaypalCreateInput {
  order_id?: string;
  test_mode?: boolean;
}

/** Ports api/paypal_create.php: creates a PayPal Orders v2 order for an already-existing pending
 *  order, with the customer-facing surcharge added on top of the server-recomputed total. */
export async function createPaypalOrderForCheckout(
  store: OrdersStore,
  gateway: PayPalGateway,
  settings: PaymentSettingsStore,
  bizName: string,
  input: PaypalCreateInput,
  isAdmin: boolean,
  appLog?: AppLogStore
): Promise<PaymentsResult<{ paypal_order_id: string; surcharge: number; total: number }>> {
  const orderId = (input.order_id ?? "").trim();
  if (!orderId) return { ok: false, error: "Missing order_id" };

  // test_mode returns before even loading the order row — matches paypal_create.php exactly
  // (create doesn't mutate order state, so there's nothing to guard).
  if (input.test_mode) {
    if (!isAdmin) return { ok: false, error: "Unauthorized", status: 401 };
    return { ok: true, data: { paypal_order_id: `TEST-PP-${orderId}`, surcharge: 0, total: 0 } };
  }

  const order = await store.getOrder(orderId);
  if (!order) return { ok: false, error: "Order not found", status: 404 };
  if (order.status !== "Awaiting Payment") return { ok: false, error: "Order is not awaiting payment" };

  const items = await store.getOrderItems(orderId);
  const amounts = computeOrderAmounts(items);
  if (amounts.total < 1) return { ok: false, error: "Order total is too small" };

  const surcharge = await computePaypalSurcharge(settings, amounts.total);
  const total = round2(amounts.total + surcharge);

  const created = await gateway.createOrder({
    orderId,
    description: `${bizName} order ${orderId}`,
    amounts: { subtotal: amounts.subtotal, shipping: amounts.shipping, tax: amounts.tax, surcharge, total },
  });
  if (!created.ok) {
    console.error("PP-CREATE-FAIL", { orderId, error: created.message });
    await logNotify(appLog, "PP-CREATE-FAIL", `Order: ${orderId} | ${created.message}`);
    return { ok: false, error: created.message };
  }

  return { ok: true, data: { paypal_order_id: created.paypalOrderId, surcharge, total } };
}

// ── PayPal capture (paypal_capture.php) ──

export interface PaypalCaptureInput {
  order_id?: string;
  paypal_order_id?: string;
  test_mode?: boolean;
}

/**
 * Ports api/paypal_capture.php: recomputes the total server-side (identical math to create),
 * claims the order atomically, captures via PayPal (idempotent via a deterministic
 * PayPal-Request-Id), then marks Paid, bumps the customer's order count, and sends the
 * payment-received email with the actual funding source (PayPal or Venmo) as the paid-by label.
 */
export async function capturePaypalOrderForCheckout(
  store: OrdersStore,
  gateway: PayPalGateway,
  customersStore: PaymentCustomersStore,
  settings: PaymentSettingsStore,
  emailStore: Pick<EmailOrderStore, "logEmail">,
  emailSender: EmailSender,
  biz: PaymentBizInfo,
  input: PaypalCaptureInput,
  isAdmin: boolean,
  now: Date = new Date(),
  appLog?: AppLogStore
): Promise<PaymentsResult<{ message: string; payment_id: string; total: number; surcharge: number; order_id: string }>> {
  const orderId = (input.order_id ?? "").trim();
  const paypalOrderId = (input.paypal_order_id ?? "").trim();
  if (!orderId) return { ok: false, error: "Missing order_id" };

  const order = await store.getOrder(orderId);
  if (!order) return { ok: false, error: "Order not found", status: 404 };
  if (order.status !== "Awaiting Payment") return { ok: false, error: "Order is not awaiting payment" };

  const items = await store.getOrderItems(orderId);
  const amounts = computeOrderAmounts(items);
  const surcharge = await computePaypalSurcharge(settings, amounts.total);
  const total = round2(amounts.total + surcharge);

  if (!(await store.claimForProcessing(orderId))) {
    return { ok: false, error: "Order is no longer awaiting payment. Please refresh and try again." };
  }

  // test_mode is checked AFTER the atomic claim here, unlike the charge/create test_mode branches
  // above — see this file's header for the full asymmetry across all three PHP files.
  if (input.test_mode) {
    if (!isAdmin) {
      await store.releaseFromProcessing(orderId);
      return { ok: false, error: "Unauthorized", status: 401 };
    }
    await store.updateOrderFields(orderId, {
      status: "Paid",
      payment_method: "PayPal",
      total,
      tax_amount: amounts.tax,
      paypal_surcharge: surcharge,
      confirm_sent_at: now.toISOString(),
    });
    return { ok: true, data: { message: "Test PayPal payment accepted", total, surcharge, order_id: orderId, payment_id: "" } };
  }

  if (!paypalOrderId) {
    await store.releaseFromProcessing(orderId);
    return { ok: false, error: "Missing paypal_order_id" };
  }

  const captured = await gateway.captureOrder({ paypalOrderId, requestId: `cap-${orderId}` });
  if (!captured.ok) {
    await store.releaseFromProcessing(orderId);
    console.error("PP-CAPTURE-FAIL", { orderId, paypalOrderId, error: captured.message });
    await logNotify(appLog, "PP-CAPTURE-FAIL", `Order: ${orderId} | PayPal order: ${paypalOrderId} | ${captured.message}`);
    return { ok: false, error: captured.message };
  }

  const paidFields: Partial<OrderUpdatableFields> = {
    status: "Paid",
    payment_method: captured.fundingSource,
    paypal_capture_id: captured.captureId,
    total,
    tax_amount: amounts.tax,
    transaction_fee: captured.feeUsd,
    paypal_surcharge: surcharge,
    confirm_sent_at: now.toISOString(),
  };
  try {
    await store.updateOrderFields(orderId, paidFields);
  } catch (e) {
    console.error("PP-CAPTURE-ORPHANED", { orderId, captureId: captured.captureId, error: e });
    return { ok: false, error: `Payment received but order update failed. Please contact us with order reference: ${orderId}` };
  }

  if (order.customer_email) await customersStore.incrementOrderCount(order.customer_email);

  await sendPaymentReceivedEmail(
    emailStore,
    emailSender,
    biz.name,
    biz.email,
    toEmailSummary(order, captured.fundingSource),
    toEmailItems(items),
    total,
    amounts.shipping,
    amounts.tax,
    captured.captureId,
    surcharge
  );

  return { ok: true, data: { message: "Payment successful", payment_id: captured.captureId, total, surcharge, order_id: orderId } };
}

// ── Square webhook (square-webhook.php) ──

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies Square's HMAC-SHA256 webhook signature exactly as square-webhook.php does:
 *  base64(HMAC-SHA256(callbackUrl + rawBody, signingKey)), compared in constant time. */
export async function verifySquareWebhookSignature(rawBody: string, signatureHeader: string, signingKey: string, callbackUrl: string): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(signingKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(callbackUrl + rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return timingSafeEqual(expected, signatureHeader);
}

export interface SquareWebhookPayment {
  id?: string;
  status?: string;
  note?: string;
  payment_note?: string;
  order_id?: string;
  amount_money?: { amount?: number };
  total_tax_money?: { amount?: number };
  processing_fee?: { amount_money?: { amount?: number } }[];
}

export interface SquareWebhookEvent {
  type?: string;
  data?: { object?: { payment?: SquareWebhookPayment } };
}

/**
 * Ports square-webhook.php's payment.updated handler: a backstop that auto-marks an order Paid if
 * the synchronous charge flow above somehow didn't. Order identification tries three fallbacks in
 * order, all ported as-is even though two of them look structurally unable to ever match:
 *
 * 1. Parse "Order XXXX" out of the payment's note. process_payment.php sets `note` to the BARE
 *    order id with no "Order " prefix, so this never matches a payment this codebase's own charge
 *    flow created — but Square Terminal/POS sales (which also fire this webhook) might format
 *    their note differently, so it's kept rather than removed.
 * 2. Match the most recent non-final order by amount. The only fallback realistically effective
 *    for this codebase's own checkout.
 * 3. Look up by `square_payment_id = payment.order_id` — comparing a column that always holds a
 *    PAYMENT id against a SEPARATE identifier space (Square's own ORDER id). This can't match
 *    anything this codebase ever writes. Preserved rather than fixed, matching this migration's
 *    general policy of documenting rather than silently correcting non-security-relevant quirks.
 */
export async function handleSquareWebhookEvent(
  store: OrdersStore,
  event: SquareWebhookEvent,
  appLog?: AppLogStore
): Promise<{ handled: boolean; orderId: string | null }> {
  if (event.type !== "payment.updated") return { handled: false, orderId: null };
  const payment = event.data?.object?.payment;
  if (!payment || payment.status !== "COMPLETED") return { handled: false, orderId: null };

  let orderId: string | null = null;
  for (const note of [payment.note ?? "", payment.payment_note ?? ""]) {
    const m = /Order\s+([\w-]+)/i.exec(note);
    if (m) {
      orderId = m[1]!;
      break;
    }
  }

  if (!orderId && payment.order_id) {
    const amountDollars = (payment.amount_money?.amount ?? 0) / 100;
    const found = await store.findOrderByAmount(amountDollars);
    if (found) orderId = found.id;
  }

  if (!orderId && payment.order_id) {
    const found = await store.findOrderBySquarePaymentId(payment.order_id);
    if (found) orderId = found.id;
  }

  if (!orderId) {
    if (appLog) {
      await appLog.append("webhook_log.txt", {
        context: "COMPLETED but no order ID found",
        message: `Square: ${payment.id ?? ""} | Note: ${payment.note ?? "none"}`,
      });
    }
    return { handled: false, orderId: null };
  }

  const current = await store.getOrder(orderId);
  if (!current) return { handled: true, orderId };

  const taxDollars = (payment.total_tax_money?.amount ?? 0) / 100;
  let feeDollars = 0;
  for (const pf of payment.processing_fee ?? []) {
    feeDollars += (pf.amount_money?.amount ?? 0) / 100;
  }

  if (current.status === "Paid") {
    // chargeOrderWithSquare's synchronous charge flow marks an order Paid immediately, before
    // Square has finished computing the real processing fee — this webhook, arriving later, is
    // normally the only place that fee ever becomes available. Previously this function no-op'd
    // entirely for an already-Paid order, which meant no Square card order ever got a real
    // transaction_fee unless an admin manually ran Admin -> Orders -> "Update Trans Fees".
    // Backfill just the fee here instead — status/tax_amount/square_payment_id are already
    // correct from the synchronous charge, so only the fee is genuinely missing. Guarded so a
    // webhook retry (or one with no fee data yet) can never zero out an already-recorded fee.
    if (feeDollars > 0 && !current.transaction_fee) {
      await store.updateOrderFields(orderId, { transaction_fee: feeDollars });
      if (appLog) {
        await appLog.append("webhook_log.txt", { context: "FEE-BACKFILLED", message: `Order: ${orderId} | Square: ${payment.id ?? ""} | Fee: $${feeDollars.toFixed(2)}` });
      }
    }
    return { handled: true, orderId };
  }

  await store.updateOrderFields(orderId, {
    status: "Paid",
    square_payment_id: payment.id ?? "",
    tax_amount: taxDollars,
    transaction_fee: feeDollars,
  });

  if (appLog) {
    await appLog.append("webhook_log.txt", { context: "PAID", message: `Order: ${orderId} | Square: ${payment.id ?? ""}` });
  }

  return { handled: true, orderId };
}

// ── Test doubles ──

export class FakeSquareGateway implements SquareGateway {
  calls: Parameters<SquareGateway["charge"]>[0][] = [];
  result: Awaited<ReturnType<SquareGateway["charge"]>> = { ok: true, paymentId: "sq_pay_1", status: "COMPLETED" };
  refundCalls: Parameters<SquareGateway["refund"]>[0][] = [];
  refundResult: Awaited<ReturnType<SquareGateway["refund"]>> = { ok: true, refundId: "sq_refund_1", status: "COMPLETED" };
  listPaymentsResult: Awaited<ReturnType<SquareGateway["listPayments"]>> = { ok: true, payments: [], cursor: null };
  async charge(params: Parameters<SquareGateway["charge"]>[0]): ReturnType<SquareGateway["charge"]> {
    this.calls.push(params);
    return this.result;
  }
  async refund(params: Parameters<SquareGateway["refund"]>[0]): ReturnType<SquareGateway["refund"]> {
    this.refundCalls.push(params);
    return this.refundResult;
  }
  async listPayments(): ReturnType<SquareGateway["listPayments"]> {
    return this.listPaymentsResult;
  }
}

export class FakePayPalGateway implements PayPalGateway {
  createResult: Awaited<ReturnType<PayPalGateway["createOrder"]>> = { ok: true, paypalOrderId: "PP-ORDER-1" };
  captureResult: Awaited<ReturnType<PayPalGateway["captureOrder"]>> = { ok: true, captureId: "PP-CAP-1", status: "COMPLETED", feeUsd: 0.5, fundingSource: "PayPal" };
  refundResult: Awaited<ReturnType<PayPalGateway["refundCapture"]>> = { ok: true, refundId: "pp_refund_1", status: "COMPLETED" };
  credentialsValid = true;
  async createOrder(): ReturnType<PayPalGateway["createOrder"]> {
    return this.createResult;
  }
  async captureOrder(): ReturnType<PayPalGateway["captureOrder"]> {
    return this.captureResult;
  }
  async refundCapture(): ReturnType<PayPalGateway["refundCapture"]> {
    return this.refundResult;
  }
  async verifyCredentials(): Promise<boolean> {
    return this.credentialsValid;
  }
}
