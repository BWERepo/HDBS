import { describe, it, expect, beforeEach } from "vitest";
import { getPaypalPaymentsReport, checkPaypalStatus, getSquarePaymentsReport, backfillSquareTransactionFees } from "./payment-reports";
import { OrdersStoreFake, makeOrderRow } from "./orders";
import { FakePayPalGateway, FakeSquareGateway } from "./payments";
import { SettingsStoreFake } from "./settings";

let orders: OrdersStoreFake;
let settings: SettingsStoreFake;

beforeEach(() => {
  orders = new OrdersStoreFake();
  settings = new SettingsStoreFake();
});

describe("getPaypalPaymentsReport", () => {
  it("derives COMPLETED/PARTIAL_REFUND/REFUNDED status from refunded_amount vs. total", async () => {
    orders.orders = [
      makeOrderRow({ id: "O1", paypal_capture_id: "C1", total: 100, refunded_amount: 0, order_date: "2026-07-05", created_at: "2026-07-05T00:00:00Z" }),
      makeOrderRow({ id: "O2", paypal_capture_id: "C2", total: 100, refunded_amount: 40, order_date: "2026-07-05", created_at: "2026-07-05T00:00:00Z" }),
      makeOrderRow({ id: "O3", paypal_capture_id: "C3", total: 100, refunded_amount: 100, order_date: "2026-07-05", created_at: "2026-07-05T00:00:00Z" }),
    ];
    const result = await getPaypalPaymentsReport(orders, "", "", "sandbox");
    const byId = Object.fromEntries(result.data!.payments.map((p) => [p.order_id, p.status]));
    expect(byId).toEqual({ O1: "COMPLETED", O2: "PARTIAL_REFUND", O3: "REFUNDED" });
  });

  it("excludes orders with no paypal_capture_id", async () => {
    orders.orders = [makeOrderRow({ id: "O1", paypal_capture_id: null, payment_method: "Credit Card" })];
    const result = await getPaypalPaymentsReport(orders, "", "", "sandbox");
    expect(result.data?.payments).toEqual([]);
  });

  it("filters by order_date range", async () => {
    orders.orders = [
      makeOrderRow({ id: "OLD", paypal_capture_id: "C1", order_date: "2026-01-01" }),
      makeOrderRow({ id: "NEW", paypal_capture_id: "C2", order_date: "2026-07-01" }),
    ];
    const result = await getPaypalPaymentsReport(orders, "2026-06-01", "", "sandbox");
    expect(result.data?.payments.map((p) => p.order_id)).toEqual(["NEW"]);
  });
});

describe("checkPaypalStatus", () => {
  it("reports ready=true only when both creds are set AND verified", async () => {
    const gateway = new FakePayPalGateway();
    const report = await checkPaypalStatus(gateway, "sandbox", true, true);
    expect(report.ready).toBe(true);
    expect(report.message).toMatch(/fully configured/);
  });

  it("reports missing credentials without attempting verification", async () => {
    const gateway = new FakePayPalGateway();
    gateway.credentialsValid = true; // would pass if called — but it shouldn't be
    const report = await checkPaypalStatus(gateway, "sandbox", false, true);
    expect(report.ready).toBe(false);
    expect(report.credentials_valid).toBe(false);
    expect(report.message).toMatch(/Missing PayPal credentials/);
  });

  it("reports invalid credentials distinctly from missing ones", async () => {
    const gateway = new FakePayPalGateway();
    gateway.credentialsValid = false;
    const report = await checkPaypalStatus(gateway, "live", true, true);
    expect(report.ready).toBe(false);
    expect(report.message).toMatch(/PayPal rejected them/);
  });
});

describe("getSquarePaymentsReport", () => {
  it("joins tax/refund from our own orders table and estimates a zero fee", async () => {
    orders.orders = [makeOrderRow({ id: "O1", square_payment_id: "SQ1", tax_amount: 5.5, refunded_amount: 0 })];
    const gateway = new FakeSquareGateway();
    gateway.listPaymentsResult = {
      ok: true,
      cursor: null,
      payments: [{ id: "SQ1", createdAt: "2026-07-05T00:00:00Z", status: "COMPLETED", amountCents: 6000, tipCents: 0, feeCents: 0, note: "ORD-1", cardBrand: "VISA", last4: "1111", buyerEmail: "a@x.com" }],
    };
    const result = await getSquarePaymentsReport(gateway, orders, settings, "LOC1", {});
    expect(result.ok).toBe(true);
    const p = result.data!.payments[0]!;
    expect(p.tax).toBe(5.5);
    expect(p.fee_estimated).toBe(true);
    expect(p.fee).toBe(1.66); // 60 * 0.026 + 0.10
    expect(p.net).toBe(58.34);
  });

  it("derives REFUNDED/PARTIAL_REFUND from our own refunded_amount, not Square's own status", async () => {
    orders.orders = [makeOrderRow({ id: "O1", square_payment_id: "SQ1", refunded_amount: 60 })];
    const gateway = new FakeSquareGateway();
    gateway.listPaymentsResult = {
      ok: true,
      cursor: null,
      payments: [{ id: "SQ1", createdAt: "", status: "COMPLETED", amountCents: 6000, tipCents: 0, feeCents: 150, note: "", cardBrand: "", last4: "", buyerEmail: "" }],
    };
    const result = await getSquarePaymentsReport(gateway, orders, settings, "LOC1", {});
    expect(result.data!.payments[0]!.status).toBe("REFUNDED");
  });

  it("surfaces a PAYMENTS_READ scope error from the gateway", async () => {
    const gateway = new FakeSquareGateway();
    gateway.listPaymentsResult = { ok: false, message: "Square authorization error — your token needs PAYMENTS_READ permission." };
    const result = await getSquarePaymentsReport(gateway, orders, settings, "LOC1", {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/PAYMENTS_READ/);
  });
});

describe("backfillSquareTransactionFees", () => {
  it("backfills the real fee for a Credit Card order matched by note", async () => {
    orders.orders = [makeOrderRow({ id: "ORD-1", payment_method: "Credit Card", transaction_fee: 0, order_date: "2026-08-01" })];
    const gateway = new FakeSquareGateway();
    gateway.listPaymentsResult = {
      ok: true,
      cursor: null,
      payments: [{ id: "SQ1", createdAt: "", status: "COMPLETED", amountCents: 5677, tipCents: 0, feeCents: 195, note: "ORD-1", cardBrand: "", last4: "", buyerEmail: "" }],
    };
    const result = await backfillSquareTransactionFees(gateway, orders, settings, "LOC1");
    expect(result.ok).toBe(true);
    expect(result.data!.updated).toBe(1);
    expect(result.data!.unmatched).toEqual([]);
    expect(orders.orders[0]!.transaction_fee).toBe(1.95);
  });

  it("estimates the fee (amount*2.6%+$0.10) when Square reports zero and no rate is configured, same default as computeSquareSurcharge", async () => {
    orders.orders = [makeOrderRow({ id: "ORD-1", payment_method: "Credit Card", transaction_fee: 0, order_date: "2026-08-01" })];
    const gateway = new FakeSquareGateway();
    gateway.listPaymentsResult = {
      ok: true,
      cursor: null,
      payments: [{ id: "SQ1", createdAt: "", status: "COMPLETED", amountCents: 6000, tipCents: 0, feeCents: 0, note: "ORD-1", cardBrand: "", last4: "", buyerEmail: "" }],
    };
    const result = await backfillSquareTransactionFees(gateway, orders, settings, "LOC1");
    expect(orders.orders[0]!.transaction_fee).toBe(1.66); // 60 * 0.026 + 0.10
    expect(result.data!.updated).toBe(1);
    expect(result.data!.estimated).toEqual(["ORD-1"]);
  });

  it("uses the REAL configured square_fees rate for the estimate, not a hardcoded one — the exact bug reported live (real fee $1.95, hardcoded-rate estimate wrongly produced $1.58)", async () => {
    orders.orders = [makeOrderRow({ id: "ORD-1", payment_method: "Credit Card", transaction_fee: 0, order_date: "2026-08-01" })];
    await settings.setSetting("square_fees", JSON.stringify({ pct: 2.9, cents: 0.3 }));
    const gateway = new FakeSquareGateway();
    gateway.listPaymentsResult = {
      ok: true,
      cursor: null,
      payments: [{ id: "SQ1", createdAt: "", status: "COMPLETED", amountCents: 5683, tipCents: 0, feeCents: 0, note: "ORD-1", cardBrand: "", last4: "", buyerEmail: "" }],
    };
    const result = await backfillSquareTransactionFees(gateway, orders, settings, "LOC1");
    expect(orders.orders[0]!.transaction_fee).toBe(1.95); // 56.83*0.029+0.30, not the 2.6%/$0.10 default
    expect(result.data!.estimated).toEqual(["ORD-1"]);
  });

  it("leaves orders alone that already have a real fee recorded (not a candidate at all)", async () => {
    orders.orders = [makeOrderRow({ id: "ORD-1", payment_method: "Credit Card", transaction_fee: 2.5, order_date: "2026-08-01" })];
    const gateway = new FakeSquareGateway();
    const result = await backfillSquareTransactionFees(gateway, orders, settings, "LOC1");
    expect(result.data!.total).toBe(0);
    expect(orders.orders[0]!.transaction_fee).toBe(2.5);
  });

  it("ignores non-card payment methods (Cash/Check never had a Square fee to backfill)", async () => {
    orders.orders = [makeOrderRow({ id: "ORD-1", payment_method: "Cash", transaction_fee: 0, order_date: "2026-08-01" })];
    const gateway = new FakeSquareGateway();
    const result = await backfillSquareTransactionFees(gateway, orders, settings, "LOC1");
    expect(result.data!.total).toBe(0);
  });

  it("records an order as unmatched, not an error, when no Square payment's note contains it", async () => {
    orders.orders = [makeOrderRow({ id: "ORD-1", payment_method: "Credit Card", transaction_fee: 0, order_date: "2026-08-01" })];
    const gateway = new FakeSquareGateway();
    gateway.listPaymentsResult = { ok: true, cursor: null, payments: [] };
    const result = await backfillSquareTransactionFees(gateway, orders, settings, "LOC1");
    expect(result.data!.updated).toBe(0);
    expect(result.data!.skipped).toBe(1);
    expect(result.data!.unmatched).toEqual(["ORD-1"]);
  });

  it("records a gateway failure as an error, not a silent skip", async () => {
    orders.orders = [makeOrderRow({ id: "ORD-1", payment_method: "Square", transaction_fee: 0, order_date: "2026-08-01" })];
    const gateway = new FakeSquareGateway();
    gateway.listPaymentsResult = { ok: false, message: "cURL error: network error" };
    const result = await backfillSquareTransactionFees(gateway, orders, settings, "LOC1");
    expect(result.data!.updated).toBe(0);
    expect(result.data!.errors[0]).toContain("ORD-1");
  });
});
