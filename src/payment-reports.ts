// Admin payment-reporting screens: ports api/paypal_payments.php, api/paypal_status.php, and the
// read-only reporting half of api/square_payments.php (its `backfill_fees` POST action is a
// historical-data maintenance tool, deliberately deferred — see this file's own note below).
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
 *
 * Deliberately NOT ported: the `backfill_fees` POST action, a historical-data maintenance tool
 * that re-fetches Square payments for old orders missing a transaction_fee and backfills it. New
 * orders get their fee from the async Square webhook (payments.ts's handleSquareWebhookEvent)
 * going forward, so this only matters for orders that predate that webhook being live — a
 * one-time cleanup job, not part of the ongoing reporting surface. Can be added later if a real
 * backlog of fee-less historical orders turns out to need it after data migration.
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
