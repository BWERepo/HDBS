// Refunds: ports api/refund.php in full — refund history (GET) and processing a full/partial
// refund (POST): a real Square refund for card orders, a real PayPal capture refund for
// PayPal/Venmo orders, or a ledger-only entry for Cash/Check. Caller must have already required
// admin (refund.php's own `requireAdmin()` gates the ENTIRE file, unlike the checkout/payment
// endpoints in payments.ts, which are public).
//
// Reuses OrdersStore (orders.ts) for the order row itself and SquareGateway/PayPalGateway
// (src/lib/*-gateway.ts) for the processor refund calls — both gateways gained a refund method
// alongside their existing charge/create/capture methods for this file.
//
// MD5 -> SHA-256 substitution, same reasoning as payments.ts: refund.php's Square/PayPal
// idempotency keys are `substr(hash('sha256', ...), 0, 40)` — already SHA-256 in the PHP, so this
// one needed no substitution at all, just a straight port.

import type { OrdersStore, OrderUpdatableFields } from "./orders";
import type { SquareGateway } from "./lib/square-gateway";
import type { PayPalGateway } from "./lib/paypal-gateway";
import type { EmailSender } from "./lib/email-sender";
import type { EmailOrderStore, RefundOrderSummary } from "./email";
import { sendRefundEmail } from "./email";

export interface RefundRow {
  id: number;
  order_id: string;
  amount: number;
  reason: string;
  method: string;
  square_refund_id: string | null;
  status: string;
  created_at: string | null;
}

export interface RefundsStore {
  listRefundsForOrder(orderId: string): Promise<RefundRow[]>;
  insertRefund(row: Pick<RefundRow, "order_id" | "amount" | "reason" | "method" | "square_refund_id" | "status">): Promise<void>;
}

export interface RefundResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

const CARD_METHODS = ["Credit Card", "Square"];
const PAYPAL_METHODS = ["PayPal", "Venmo"]; // Venmo settles on the PayPal rail

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function hashHex(input: string, len: number): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, len);
}

/** Ports refund.php's GET action: refund history for one order, newest-first. */
export async function listRefundsForOrder(store: RefundsStore, orderId: string): Promise<RefundResult<{ refunds: RefundRow[] }>> {
  if (!orderId) return { ok: false, error: "Missing order_id" };
  const refunds = await store.listRefundsForOrder(orderId);
  return { ok: true, data: { refunds: refunds.slice().sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")) } };
}

export interface CreateRefundInput {
  order_id?: string;
  amount?: number | string;
  reason?: string;
}

/**
 * Ports refund.php's POST action. Deterministic idempotency keys (10-minute buckets) mean a
 * genuine network/UI retry of the same refund within that window dedupes at the processor rather
 * than double-refunding, while a later legitimate refund of the same amount still gets a fresh key.
 */
export async function processRefund(
  ordersStore: OrdersStore,
  refundsStore: RefundsStore,
  squareGateway: SquareGateway,
  paypalGateway: PayPalGateway,
  emailStore: Pick<EmailOrderStore, "logEmail">,
  emailSender: EmailSender,
  bizName: string,
  bizEmail: string,
  input: CreateRefundInput,
  now: Date = new Date()
): Promise<
  RefundResult<{
    message: string;
    refunded_amount: number;
    remaining: number;
    status: string;
    square_refund_id: string | null;
    email_sent: boolean;
  }>
> {
  const orderId = (input.order_id ?? "").trim();
  const amount = round2(Number(input.amount ?? 0));
  const reason = (input.reason ?? "").trim();

  if (!orderId) return { ok: false, error: "Missing order_id" };
  if (amount <= 0) return { ok: false, error: "Refund amount must be greater than zero" };
  if (reason === "") return { ok: false, error: "A reason is required for every refund" };

  const order = await ordersStore.getOrder(orderId);
  if (!order) return { ok: false, error: "Order not found", status: 404 };

  const already = Number(order.refunded_amount ?? 0);
  const remainingBefore = round2(Number(order.total ?? 0) - already);
  if (amount > remainingBefore + 0.005) {
    return { ok: false, error: `Refund amount exceeds remaining refundable balance ($${remainingBefore.toFixed(2)})` };
  }

  const payMethod = order.payment_method || "Other";
  const isCard = CARD_METHODS.includes(payMethod);
  const isPaypal = PAYPAL_METHODS.includes(payMethod);
  const bucket = Math.floor(now.getTime() / 1000 / 600);

  let refundId: string | null = null;
  let refundStatus = "Completed";

  if (isCard) {
    if (!order.square_payment_id) return { ok: false, error: "This order has no linked Square payment — cannot process an automatic card refund." };
    const idempotencyKey = await hashHex(`${orderId}|${amount}|${bucket}`, 40);
    const refunded = await squareGateway.refund({ paymentId: order.square_payment_id, idempotencyKey, amountCents: Math.round(amount * 100), reason });
    if (!refunded.ok) {
      console.error("REFUND-FAIL", { orderId, amount, error: refunded.message });
      return { ok: false, error: refunded.message };
    }
    refundId = refunded.refundId;
    refundStatus = refunded.status;
    if (refundStatus === "REJECTED" || refundStatus === "FAILED") return { ok: false, error: `Square rejected the refund (status: ${refundStatus}).` };
  } else if (isPaypal) {
    if (!order.paypal_capture_id) return { ok: false, error: "This order has no linked PayPal capture — cannot process an automatic PayPal refund." };
    const requestId = `rf-${await hashHex(`${orderId}|${amount}|${bucket}`, 40)}`;
    const refunded = await paypalGateway.refundCapture({ captureId: order.paypal_capture_id, requestId, amount, noteToPayer: reason });
    if (!refunded.ok) {
      console.error("REFUND-FAIL", { orderId, amount, pp: refunded.message });
      return { ok: false, error: refunded.message };
    }
    refundId = refunded.refundId;
    refundStatus = refunded.status;
    if (refundStatus === "CANCELLED" || refundStatus === "FAILED") return { ok: false, error: `PayPal rejected the refund (status: ${refundStatus}).` };
  }
  // Neither card nor PayPal (Cash/Check/Other): no processor call at all, ledger-only entry —
  // matches the PHP's `if ($isCard) {...} elseif ($isPaypal) {...}` having no else branch.

  await refundsStore.insertRefund({ order_id: orderId, amount, reason, method: payMethod, square_refund_id: refundId, status: refundStatus });

  const newRefunded = round2(already + amount);
  const remaining = round2(Number(order.total ?? 0) - newRefunded);
  const newStatus = newRefunded >= Number(order.total ?? 0) - 0.005 ? "Refunded" : (order.status ?? "Paid");
  const fields: Partial<OrderUpdatableFields> = { refunded_amount: newRefunded, status: newStatus };
  await ordersStore.updateOrderFields(orderId, fields);

  const emailSent = await sendRefundEmail(
    emailStore,
    emailSender,
    bizName,
    bizEmail,
    { id: orderId, customer_name: order.customer_name, customer_email: order.customer_email } satisfies RefundOrderSummary,
    amount,
    reason,
    payMethod,
    refundId,
    remaining
  );

  return {
    ok: true,
    data: { message: "Refund processed", refunded_amount: newRefunded, remaining, status: newStatus, square_refund_id: refundId, email_sent: emailSent },
  };
}

// ── In-memory test double ──
export class RefundsStoreFake implements RefundsStore {
  refunds: RefundRow[] = [];
  private nextId = 1;

  async listRefundsForOrder(orderId: string): Promise<RefundRow[]> {
    return this.refunds.filter((r) => r.order_id === orderId);
  }
  async insertRefund(row: Pick<RefundRow, "order_id" | "amount" | "reason" | "method" | "square_refund_id" | "status">): Promise<void> {
    this.refunds.push({ id: this.nextId++, created_at: new Date().toISOString(), ...row });
  }
}
