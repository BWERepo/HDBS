import { describe, it, expect, beforeEach } from "vitest";
import { listRefundsForOrder, processRefund, RefundsStoreFake } from "./refunds";
import { OrdersStoreFake, makeOrderRow } from "./orders";
import { FakeSquareGateway, FakePayPalGateway } from "./payments";
import type { EmailSender, EmailSendResult } from "./lib/email-sender";
import { AppLogStoreFake } from "./app-log";

class FakeEmailSender implements EmailSender {
  sent: { to: string | string[]; subject: string; html: string }[] = [];
  result: EmailSendResult = { sent: true, status: "sink", html: "" };
  async send(to: string | string[], subject: string, html: string): Promise<EmailSendResult> {
    this.sent.push({ to, subject, html });
    return this.result;
  }
}

class FakeEmailOrderStore {
  logs: { emailType: string; sentTo: string; orderId: string; subject: string; status: string; body: string }[] = [];
  async logEmail(entry: { emailType: string; sentTo: string; orderId: string; subject: string; status: "sent" | "failed" | "sink"; body: string }): Promise<void> {
    this.logs.push(entry);
  }
}

let orders: OrdersStoreFake;
let refunds: RefundsStoreFake;
let square: FakeSquareGateway;
let paypal: FakePayPalGateway;
let emailStore: FakeEmailOrderStore;
let emailSender: FakeEmailSender;
const bizName = "Handmade Designs By Suzi";
const bizEmail = "handmadedesignsbysuzi@yahoo.com";

beforeEach(() => {
  orders = new OrdersStoreFake();
  refunds = new RefundsStoreFake();
  square = new FakeSquareGateway();
  paypal = new FakePayPalGateway();
  emailStore = new FakeEmailOrderStore();
  emailSender = new FakeEmailSender();
});

function seedOrder(overrides: Partial<Parameters<typeof makeOrderRow>[0]> = {}) {
  orders.orders = [
    makeOrderRow({
      id: "ORD-1",
      status: "Paid",
      total: 100,
      refunded_amount: 0,
      customer_email: "jane@example.com",
      customer_name: "Jane Doe",
      payment_method: "Credit Card",
      square_payment_id: "sqpay1",
      ...overrides,
    }),
  ];
}

async function run(input: Parameters<typeof processRefund>[8], appLog?: Parameters<typeof processRefund>[10]) {
  return processRefund(orders, refunds, square, paypal, emailStore, emailSender, bizName, bizEmail, input, new Date(), appLog);
}

describe("listRefundsForOrder", () => {
  it("requires an order_id", async () => {
    const result = await listRefundsForOrder(refunds, "");
    expect(result.ok).toBe(false);
  });

  it("returns refunds for the order, newest first", async () => {
    await refunds.insertRefund({ order_id: "ORD-1", amount: 10, reason: "a", method: "Credit Card", square_refund_id: null, status: "Completed" });
    await refunds.insertRefund({ order_id: "ORD-1", amount: 20, reason: "b", method: "Credit Card", square_refund_id: null, status: "Completed" });
    refunds.refunds[0]!.created_at = "2026-01-01T00:00:00Z";
    refunds.refunds[1]!.created_at = "2026-01-02T00:00:00Z";
    const result = await listRefundsForOrder(refunds, "ORD-1");
    expect(result.data?.refunds.map((r) => r.amount)).toEqual([20, 10]);
  });
});

describe("processRefund validation", () => {
  it("requires order_id, a positive amount, and a reason", async () => {
    expect((await run({ amount: 10, reason: "x" })).ok).toBe(false);
    seedOrder();
    expect((await run({ order_id: "ORD-1", amount: 0, reason: "x" })).ok).toBe(false);
    expect((await run({ order_id: "ORD-1", amount: 10, reason: "" })).ok).toBe(false);
  });

  it("rejects an unknown order", async () => {
    const result = await run({ order_id: "NOPE", amount: 10, reason: "x" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("rejects a refund exceeding the remaining refundable balance", async () => {
    seedOrder({ refunded_amount: 60 });
    const result = await run({ order_id: "ORD-1", amount: 50, reason: "too much" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exceeds remaining refundable balance \(\$40\.00\)/);
  });
});

describe("processRefund — card (Square)", () => {
  it("rejects an order with no linked Square payment", async () => {
    seedOrder({ square_payment_id: null });
    const result = await run({ order_id: "ORD-1", amount: 10, reason: "x" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no linked Square payment/);
  });

  it("processes a partial refund: calls Square, inserts a ledger row, updates the order, emails", async () => {
    seedOrder();
    const result = await run({ order_id: "ORD-1", amount: 25, reason: "Damaged in shipping" });
    expect(result.ok).toBe(true);
    expect(result.data?.refunded_amount).toBe(25);
    expect(result.data?.remaining).toBe(75);
    expect(result.data?.status).toBe("Paid"); // partial — order stays Paid
    expect(orders.orders[0]!.refunded_amount).toBe(25);
    expect(refunds.refunds).toHaveLength(1);
    expect(refunds.refunds[0]!.method).toBe("Credit Card");
    expect(square.refundCalls[0]!.paymentId).toBe("sqpay1");
    expect(emailSender.sent).toHaveLength(1);
    expect(result.data?.email_sent).toBe(true);
  });

  it("marks the order Refunded once the full amount has been refunded", async () => {
    seedOrder();
    const result = await run({ order_id: "ORD-1", amount: 100, reason: "Full refund" });
    expect(result.data?.status).toBe("Refunded");
    expect(orders.orders[0]!.status).toBe("Refunded");
  });

  it("does not insert a ledger row when Square rejects the refund", async () => {
    seedOrder();
    square.refundResult = { ok: true, refundId: "sq_r1", status: "REJECTED" };
    const result = await run({ order_id: "ORD-1", amount: 10, reason: "x" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Square rejected the refund/);
    expect(refunds.refunds).toHaveLength(0);
    expect(orders.orders[0]!.refunded_amount).toBe(0);
  });

  it("surfaces a failed Square API call without inserting a ledger row", async () => {
    seedOrder();
    square.refundResult = { ok: false, message: "Square refund failed: Unknown Square error" };
    const result = await run({ order_id: "ORD-1", amount: 10, reason: "x" });
    expect(result.ok).toBe(false);
    expect(refunds.refunds).toHaveLength(0);
  });

  it("logs a REFUND-FAIL entry to the app_log notify file on a failed Square API call", async () => {
    seedOrder();
    square.refundResult = { ok: false, message: "Square refund failed: Unknown Square error" };
    const appLog = new AppLogStoreFake();
    await run({ order_id: "ORD-1", amount: 10, reason: "x" }, appLog);
    expect(appLog.rows["notify_log.txt"]).toHaveLength(1);
    expect(appLog.rows["notify_log.txt"]![0]!.context).toBe("REFUND-FAIL");
  });
});

describe("processRefund — PayPal/Venmo", () => {
  it("rejects an order with no linked PayPal capture", async () => {
    seedOrder({ payment_method: "PayPal", square_payment_id: null, paypal_capture_id: null });
    const result = await run({ order_id: "ORD-1", amount: 10, reason: "x" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no linked PayPal capture/);
  });

  it("processes a Venmo refund via the PayPal gateway and records method='Venmo'", async () => {
    seedOrder({ payment_method: "Venmo", square_payment_id: null, paypal_capture_id: "CAP-1" });
    const result = await run({ order_id: "ORD-1", amount: 30, reason: "Wrong size" });
    expect(result.ok).toBe(true);
    expect(refunds.refunds[0]!.method).toBe("Venmo");
    expect(orders.orders[0]!.refunded_amount).toBe(30);
  });
});

describe("processRefund — Cash/Check (ledger-only, no processor call)", () => {
  it("records the refund without calling either gateway", async () => {
    seedOrder({ payment_method: "Cash", square_payment_id: null });
    const result = await run({ order_id: "ORD-1", amount: 15, reason: "Store credit issued instead" });
    expect(result.ok).toBe(true);
    expect(square.refundCalls).toHaveLength(0);
    expect(refunds.refunds[0]!.square_refund_id).toBeNull();
    expect(refunds.refunds[0]!.method).toBe("Cash");
  });
});

describe("processRefund — email", () => {
  it("reports email_sent=false and does not throw when the order has no customer email", async () => {
    seedOrder({ customer_email: null });
    const result = await run({ order_id: "ORD-1", amount: 10, reason: "x" });
    expect(result.ok).toBe(true);
    expect(result.data?.email_sent).toBe(false);
    expect(emailSender.sent).toHaveLength(0);
  });
});
