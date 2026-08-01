import { describe, it, expect, beforeEach } from "vitest";
import { getPaypalPaymentsReport, checkPaypalStatus, getSquarePaymentsReport } from "./payment-reports";
import { OrdersStoreFake, makeOrderRow } from "./orders";
import { FakePayPalGateway, FakeSquareGateway } from "./payments";

let orders: OrdersStoreFake;

beforeEach(() => {
  orders = new OrdersStoreFake();
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
    const result = await getSquarePaymentsReport(gateway, orders, "LOC1", {});
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
    const result = await getSquarePaymentsReport(gateway, orders, "LOC1", {});
    expect(result.data!.payments[0]!.status).toBe("REFUNDED");
  });

  it("surfaces a PAYMENTS_READ scope error from the gateway", async () => {
    const gateway = new FakeSquareGateway();
    gateway.listPaymentsResult = { ok: false, message: "Square authorization error — your token needs PAYMENTS_READ permission." };
    const result = await getSquarePaymentsReport(gateway, orders, "LOC1", {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/PAYMENTS_READ/);
  });
});
