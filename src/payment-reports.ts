// Admin payment-reporting screens: ports api/paypal_payments.php, api/paypal_status.php, and both
// halves of api/square_payments.php (its GET report and its `backfill_fees` POST maintenance
// action — see backfillSquareTransactionFees's own note for why the latter was deferred, then
// added, during this migration).
//
// `mode`/`env` strings (sandbox vs. live) are supplied by the caller from c.env.ENVIRONMENT rather
// than detected here — same architecture decision as payments.ts: this migration resolves
// sandbox-vs-live per-Worker, not at request time.

import type { OrdersStore } from "./orders";
import type { SquareGateway } from "./lib/square-gateway";
import type { PayPalGateway } from "./lib/paypal-gateway";

export interface ReportResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface PaypalPaymentSummary {
  id: string;
  order_id: string;
  created: string | null;
  method: string | null;
  status: "COMPLETED" | "REFUNDED" | "PARTIAL_REFUND";
  amount: number;
  tax: number;
  fee: number;
  net: number;
  refunded: number;
  buyer: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Ports api/paypal_payments.php: sourced entirely from our own orders table (every PayPal/Venmo
 *  charge already stores its capture id, exact fee, and tax at capture time — see
 *  payments.ts's capturePaypalOrderForCheckout), not a second live API call. */
export async function getPaypalPaymentsReport(
  store: OrdersStore,
  begin: string,
  end: string,
  env: string
): Promise<ReportResult<{ payments: PaypalPaymentSummary[]; mode: string; count: number }>> {
  const orders = await store.listPaypalCapturedOrders(begin, end);
  const payments: PaypalPaymentSummary[] = orders.map((o) => {
    const total = Number(o.total ?? 0);
    const fee = Number(o.transaction_fee ?? 0);
    const refunded = Number(o.refunded_amount ?? 0);
    const status = refunded <= 0.004 ? "COMPLETED" : refunded >= total - 0.005 ? "REFUNDED" : "PARTIAL_REFUND";
    return {
      id: o.paypal_capture_id ?? "",
      order_id: o.id,
      created: o.created_at,
      method: o.payment_method,
      status,
      amount: round2(total),
      tax: round2(Number(o.tax_amount ?? 0)),
      fee: round2(fee),
      net: round2(total - fee),
      refunded: round2(refunded),
      buyer: o.customer_email,
    };
  });
  return { ok: true, data: { payments, mode: env, count: payments.length } };
}

export interface PaypalStatusReport {
  env: string;
  client_id_set: boolean;
  secret_set: boolean;
  credentials_valid: boolean;
  ready: boolean;
  message: string;
}

/** Ports api/paypal_status.php: reports whether PayPal credentials are present and actually work,
 *  without ever exposing their values. `clientIdSet`/`secretSet` are passed in rather than read
 *  from the gateway, since the gateway only ever exposes a verifyCredentials() boolean, never the
 *  underlying values — matching the PHP's own "never expose them" intent structurally, not just
 *  by convention. */
export async function checkPaypalStatus(gateway: PayPalGateway, env: string, clientIdSet: boolean, secretSet: boolean): Promise<PaypalStatusReport> {
  const tokenOk = clientIdSet && secretSet ? await gateway.verifyCredentials() : false;
  const ready = clientIdSet && secretSet && tokenOk;
  const secretsFile = env === "sandbox" ? "the staging Worker's PAYPAL_CLIENT_ID/PAYPAL_SECRET secrets" : "the production Worker's PAYPAL_CLIENT_ID/PAYPAL_SECRET secrets";
  const message = ready
    ? `PayPal is fully configured for the ${env} environment — credentials verified with PayPal.`
    : !clientIdSet || !secretSet
      ? `Missing PayPal credentials for the ${env} environment. Add them via ${secretsFile}.`
      : "Credentials are present but PayPal rejected them (check for typos or a mismatched sandbox/live key).";

  return { env, client_id_set: clientIdSet, secret_set: secretSet, credentials_valid: tokenOk, ready, message };
}

export interface SquarePaymentSummaryDto {
  id: string;
  created: string;
  status: string;
  amount: number;
  tax: number;
  tip: number;
  fee: number;
  fee_estimated: boolean;
  net: number;
  refunded: number;
  note: string;
  card_brand: string;
  last4: string;
  buyer: string;
}

// Square returns $0 processing_fee until next-day settlement — same estimate formula as the PHP.
function estimateSquareFee(amountCents: number): number {
  return round2((amountCents / 100) * 0.026 + 0.1);
}

/**
 * Ports api/square_payments.php's GET report: a live Square List Payments call, joined against
 * our own orders table for tax (Square never itemizes it — process_payment.php charges a flat
 * total, not a Square Order with line items) and refund status (issued through our own
 * api/refund.php, not Square's refund status).
 */
export async function getSquarePaymentsReport(
  gateway: SquareGateway,
  ordersStore: OrdersStore,
  locationId: string,
  params: { begin?: string; end?: string; cursor?: string }
): Promise<ReportResult<{ payments: SquarePaymentSummaryDto[]; cursor: string | null; count: number }>> {
  const listed = await gateway.listPayments({
    locationId,
    beginTime: params.begin ? `${params.begin}T00:00:00Z` : undefined,
    endTime: params.end ? `${params.end}T23:59:59Z` : undefined,
    cursor: params.cursor,
  });
  if (!listed.ok) return { ok: false, error: listed.message };

  const ids = listed.payments.map((p) => p.id).filter(Boolean);
  const taxAndRefund = await ordersStore.getTaxAndRefundBySquarePaymentIds(ids);

  const payments: SquarePaymentSummaryDto[] = listed.payments.map((p) => {
    let fee = p.feeCents / 100;
    let feeEstimated = false;
    if (Math.abs(fee) < 0.001 && p.amountCents > 0 && p.status === "COMPLETED") {
      fee = estimateSquareFee(p.amountCents);
      feeEstimated = true;
    }
    const known = taxAndRefund.get(p.id);
    const refunded = known?.refunded ?? 0;
    const amount = round2(p.amountCents / 100);
    let status = p.status;
    if (status === "COMPLETED" && refunded > 0.004) {
      status = refunded >= amount - 0.005 ? "REFUNDED" : "PARTIAL_REFUND";
    }
    return {
      id: p.id,
      created: p.createdAt,
      status,
      amount,
      tax: round2(known?.tax ?? 0),
      tip: round2(p.tipCents / 100),
      fee: round2(Math.abs(fee)),
      fee_estimated: feeEstimated,
      net: round2(amount - Math.abs(fee)),
      refunded: round2(refunded),
      note: p.note,
      card_brand: p.cardBrand,
      last4: p.last4,
      buyer: p.buyerEmail,
    };
  });

  return { ok: true, data: { payments, cursor: listed.cursor, count: payments.length } };
}

export interface BackfillFeesResult {
  updated: number;
  skipped: number;
  total: number;
  errors: string[];
  unmatched: string[];
}

/**
 * Ports api/square_payments.php's `backfill_fees` POST action — a historical-data maintenance
 * tool that re-fetches Square payments for orders still missing a transaction_fee and backfills
 * it. New orders get their fee from the async Square webhook automatically
 * (payments.ts's handleSquareWebhookEvent) — a two-delivery process confirmed live 2026-08-20
 * (Square Sandbox sends an initial payment.updated with no fee yet, then a second one ~a minute
 * later once it's computed), so this is now genuinely a one-time/occasional cleanup tool for
 * orders that predate that webhook being live or reliable, not the primary path.
 *
 * Deliberately kept close to the PHP's own logic rather than reusing getSquarePaymentsReport's
 * single List Payments call: each candidate order gets its own List Payments call scoped to a
 * narrow ±30-day window around that order's own date and matched by note containing the order id
 * — the PHP's approach for correctness across a batch of orders that may span months, at the cost
 * of one Square API call per order (capped at 100 orders per run, same as the PHP).
 */
export async function backfillSquareTransactionFees(
  gateway: SquareGateway,
  ordersStore: OrdersStore,
  locationId: string
): Promise<ReportResult<BackfillFeesResult>> {
  const allOrders = await ordersStore.listOrders();
  const candidates = allOrders
    .filter((o) => (o.payment_method === "Credit Card" || o.payment_method === "Square") && (o.transaction_fee === null || Number(o.transaction_fee) === 0))
    .sort((a, b) => (b.order_date ?? "").localeCompare(a.order_date ?? ""))
    .slice(0, 100);

  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const unmatched: string[] = [];

  for (const order of candidates) {
    const orderDate = order.order_date ?? new Date().toISOString().slice(0, 10);
    const begin = `${shiftDate(orderDate, -30)}T00:00:00Z`;
    const end = `${shiftDate(orderDate, 30)}T23:59:59Z`;

    const listed = await gateway.listPayments({ locationId, beginTime: begin, endTime: end, limit: 100 });
    if (!listed.ok) {
      errors.push(`${order.id}: ${listed.message}`);
      skipped++;
      continue;
    }

    const matched = listed.payments.find((p) => p.note.includes(order.id) && (p.status === "COMPLETED" || p.status === "APPROVED"));
    if (!matched) {
      unmatched.push(order.id);
      skipped++;
      continue;
    }

    let fee = matched.feeCents / 100;
    if (Math.abs(fee) < 0.001) fee = estimateSquareFee(matched.amountCents);
    fee = round2(Math.abs(fee));

    await ordersStore.updateOrderFields(order.id, { transaction_fee: fee });
    updated++;
  }

  return { ok: true, data: { updated, skipped, total: candidates.length, errors, unmatched } };
}

/** date +/- days, plain YYYY-MM-DD in/out — used only for the +-30-day Square List Payments
 *  window above, no timezone subtlety needed at day granularity. */
function shiftDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
