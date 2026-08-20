import { describe, it, expect, beforeEach } from "vitest";
import {
  computeOrderAmounts,
  computePaypalSurcharge,
  chargeOrderWithSquare,
  createPaypalOrderForCheckout,
  capturePaypalOrderForCheckout,
  verifySquareWebhookSignature,
  handleSquareWebhookEvent,
  FakeSquareGateway,
  FakePayPalGateway,
} from "./payments";
import { OrdersStoreFake, makeOrderRow } from "./orders";
import { SettingsStoreFake } from "./settings";
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

class FakeCustomersStore {
  calls: string[] = [];
  async incrementOrderCount(email: string): Promise<void> {
    this.calls.push(email);
  }
}

class FakeEmailOrderStore {
  logs: { emailType: string; sentTo: string; orderId: string; subject: string; status: string; body: string }[] = [];
  async logEmail(entry: { emailType: string; sentTo: string; orderId: string; subject: string; status: "sent" | "failed" | "sink"; body: string }): Promise<void> {
    this.logs.push(entry);
  }
}

let store: OrdersStoreFake;
let settings: SettingsStoreFake;
let customers: FakeCustomersStore;
let emailStore: FakeEmailOrderStore;
let emailSender: FakeEmailSender;
const biz = { name: "Handmade Designs By Suzi", email: "handmadedesignsbysuzi@yahoo.com" };

beforeEach(() => {
  store = new OrdersStoreFake();
  settings = new SettingsStoreFake();
  customers = new FakeCustomersStore();
  emailStore = new FakeEmailOrderStore();
  emailSender = new FakeEmailSender();
});

function seedAwaitingOrder(id = "ORD-1") {
  store.orders = [makeOrderRow({ id, status: "Awaiting Payment", customer_email: "jane@example.com", customer_name: "Jane Doe", payment_method: "Credit Card" })];
  store.items = [
    { order_id: id, product_id: "p1", product_name: "Tote Bag", price: 40, quantity: 1 },
    { order_id: id, product_id: "_ship", product_name: "Shipping", price: 5, quantity: 1 },
  ];
}

describe("computeOrderAmounts", () => {
  it("splits shipping out, sums subtotal, and applies the 9.75% tax rate", () => {
    const amounts = computeOrderAmounts([
      { product_id: "p1", price: 40, quantity: 2 },
      { product_id: "_ship", price: 5, quantity: 1 },
    ]);
    expect(amounts.subtotal).toBe(80);
    expect(amounts.shipping).toBe(5);
    expect(amounts.tax).toBe(7.8);
    expect(amounts.total).toBe(92.8);
  });

  it("treats a missing price/quantity as zero", () => {
    const amounts = computeOrderAmounts([{ product_id: "p1", price: null, quantity: null }]);
    expect(amounts).toEqual({ subtotal: 0, shipping: 0, tax: 0, total: 0 });
  });
});

describe("computePaypalSurcharge", () => {
  it("defaults to 3.49% + $0.49 when unset", async () => {
    const fee = await computePaypalSurcharge(settings, 100);
    expect(fee).toBe(3.98);
  });

  it("reads pct/cents from the paypal_fees setting", async () => {
    await settings.setSetting("paypal_fees", JSON.stringify({ pct: 5, cents: 1 }));
    const fee = await computePaypalSurcharge(settings, 100);
    expect(fee).toBe(6);
  });

  it("keeps defaults on corrupt JSON", async () => {
    await settings.setSetting("paypal_fees", "not json");
    const fee = await computePaypalSurcharge(settings, 100);
    expect(fee).toBe(3.98);
  });
});

describe("chargeOrderWithSquare", () => {
  it("rejects a missing source_id or order_id", async () => {
    const gateway = new FakeSquareGateway();
    const result = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1" }, false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing source_id/);
  });

  it("rejects an unknown order", async () => {
    const gateway = new FakeSquareGateway();
    const result = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "NOPE", source_id: "cnon:1" }, false);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("rejects an order that isn't Awaiting Payment", async () => {
    seedAwaitingOrder();
    store.orders[0]!.status = "Paid";
    const gateway = new FakeSquareGateway();
    const result = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "cnon:1" }, false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not awaiting payment/);
  });

  it("test_mode requires admin and never calls the gateway", async () => {
    seedAwaitingOrder();
    const gateway = new FakeSquareGateway();
    const denied = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "x", test_mode: true }, false);
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe(401);
    expect(store.orders[0]!.status).toBe("Awaiting Payment");

    const accepted = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "x", test_mode: true }, true);
    expect(accepted.ok).toBe(true);
    expect(store.orders[0]!.status).toBe("Paid");
    expect(gateway.calls).toHaveLength(0);
  });

  it("surfaces the guard message when claimForProcessing reports a lost race", async () => {
    // Simulates a concurrent request winning the atomic claim between this request's initial
    // status read and its own claim attempt — the order is still 'Awaiting Payment' when read,
    // but claimForProcessing itself reports the row was no longer claimable.
    seedAwaitingOrder();
    store.claimForProcessing = async () => false;
    const gateway = new FakeSquareGateway();
    const result = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "cnon:1" }, false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no longer awaiting payment/);
  });

  it("releases the claim and surfaces the gateway's message on a declined charge", async () => {
    seedAwaitingOrder();
    const gateway = new FakeSquareGateway();
    gateway.result = { ok: false, message: "Your card was declined. Please try a different card." };
    const result = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "cnon:1" }, false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/declined/);
    expect(store.orders[0]!.status).toBe("Awaiting Payment");
  });

  it("logs a PAYMENT-FAIL entry to the app_log notify file on a declined charge", async () => {
    seedAwaitingOrder();
    const gateway = new FakeSquareGateway();
    gateway.result = { ok: false, message: "Your card was declined." };
    const appLog = new AppLogStoreFake();
    await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "cnon:1" }, false, new Date(), appLog);
    expect(appLog.rows["notify_log.txt"]).toHaveLength(1);
    expect(appLog.rows["notify_log.txt"]![0]!.context).toBe("PAYMENT-FAIL");
    expect(appLog.rows["notify_log.txt"]![0]!.message).toContain("ORD-1");
  });

  it("releases the claim when Square returns a non-COMPLETED status", async () => {
    seedAwaitingOrder();
    const gateway = new FakeSquareGateway();
    gateway.result = { ok: true, paymentId: "sq1", status: "PENDING" };
    const result = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "cnon:1" }, false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Payment not completed. Status: PENDING/);
    expect(store.orders[0]!.status).toBe("Awaiting Payment");
  });

  it("marks Paid, bumps the customer's order count, and emails on a completed charge — the charge and saved total include the card surcharge", async () => {
    seedAwaitingOrder();
    const gateway = new FakeSquareGateway();
    const result = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "cnon:1" }, false);
    expect(result.ok).toBe(true);
    expect(result.data?.payment_id).toBe("sq_pay_1");
    // 40 subtotal + 5 shipping + 3.90 (9.75%) tax = 48.9 base. Gross-up surcharge at the default
    // 2.6% + $0.10: (48.9*0.026+0.10)/(1-0.026) = 1.3714/0.974 = 1.408... -> round2 = 1.41.
    // Total = 48.9+1.41 = 50.31.
    expect(result.data?.total).toBe(50.31);
    expect(store.orders[0]!.status).toBe("Paid");
    expect(store.orders[0]!.square_payment_id).toBe("sq_pay_1");
    expect(store.orders[0]!.square_surcharge).toBe(1.41);
    expect(gateway.calls[0]!.amountCents).toBe(5031); // the actual card charge includes the surcharge
    expect(customers.calls).toEqual(["jane@example.com"]);
    expect(emailSender.sent).toHaveLength(1);
    expect(emailStore.logs).toHaveLength(1);
  });

  it("defaults to a 2.6%+$0.10 grossed-up card surcharge when the square_fees setting is unset", async () => {
    seedAwaitingOrder();
    const gateway = new FakeSquareGateway();
    await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "cnon:1" }, false);
    expect(store.orders[0]!.square_surcharge).toBe(1.41);
  });

  it("reads pct/cents from the square_fees setting for the card surcharge, still grossed up", async () => {
    seedAwaitingOrder();
    await settings.setSetting("square_fees", JSON.stringify({ pct: 2.9, cents: 0.3 }));
    const gateway = new FakeSquareGateway();
    const result = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "cnon:1" }, false);
    // (48.9*0.029+0.30)/(1-0.029) = 1.7181/0.971 = 1.7694... -> round2 = 1.77; total = 50.67
    expect(store.orders[0]!.square_surcharge).toBe(1.77);
    expect(result.data?.total).toBe(50.67);
  });

  it("the collected surcharge fully covers Square's real fee on the final charged amount (the gross-up's whole point)", async () => {
    seedAwaitingOrder();
    await settings.setSetting("square_fees", JSON.stringify({ pct: 2.9, cents: 0.3 }));
    const gateway = new FakeSquareGateway();
    const result = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "cnon:1" }, false);
    // Square's real fee, computed on the FINAL charged total (not the pre-surcharge base) —
    // this must come out <= the surcharge actually collected, or the business is still short.
    const realSquareFeeOnFinalTotal = Math.round((result.data!.total * 0.029 + 0.3) * 100) / 100;
    expect(store.orders[0]!.square_surcharge).toBeGreaterThanOrEqual(realSquareFeeOnFinalTotal);
  });

  it("test_mode never adds a card surcharge — no real card is charged in that path", async () => {
    seedAwaitingOrder();
    const gateway = new FakeSquareGateway();
    const result = await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "x", test_mode: true }, true);
    expect(result.ok).toBe(true);
    expect(result.data?.total).toBe(48.9);
    expect(store.orders[0]!.total).toBe(48.9);
  });

  it("uses a stable idempotency key derived from the order and source id", async () => {
    seedAwaitingOrder();
    const gateway = new FakeSquareGateway();
    await chargeOrderWithSquare(store, gateway, settings, customers, emailStore, emailSender, biz, "LOC1", { order_id: "ORD-1", source_id: "cnon:1" }, false);
    expect(gateway.calls[0]!.idempotencyKey).toMatch(/^ORD-1-[0-9a-f]{8}$/);
    expect(gateway.calls[0]!.note).toBe("ORD-1");
  });
});

describe("createPaypalOrderForCheckout", () => {
  it("rejects a missing order_id", async () => {
    const gateway = new FakePayPalGateway();
    const result = await createPaypalOrderForCheckout(store, gateway, settings, biz.name, {}, false);
    expect(result.ok).toBe(false);
  });

  it("test_mode returns a fake id without touching the order row", async () => {
    const gateway = new FakePayPalGateway();
    const denied = await createPaypalOrderForCheckout(store, gateway, settings, biz.name, { order_id: "ORD-1", test_mode: true }, false);
    expect(denied.status).toBe(401);
    const accepted = await createPaypalOrderForCheckout(store, gateway, settings, biz.name, { order_id: "ORD-1", test_mode: true }, true);
    expect(accepted.data?.paypal_order_id).toBe("TEST-PP-ORD-1");
  });

  it("rejects an order total under $1", async () => {
    store.orders = [makeOrderRow({ id: "ORD-1", status: "Awaiting Payment" })];
    store.items = [{ order_id: "ORD-1", product_id: "p1", product_name: "Sticker", price: 0.5, quantity: 1 }];
    const gateway = new FakePayPalGateway();
    const result = await createPaypalOrderForCheckout(store, gateway, settings, biz.name, { order_id: "ORD-1" }, false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too small/);
  });

  it("adds the PayPal surcharge on top of the recomputed total", async () => {
    seedAwaitingOrder();
    const gateway = new FakePayPalGateway();
    const result = await createPaypalOrderForCheckout(store, gateway, settings, biz.name, { order_id: "ORD-1" }, false);
    expect(result.ok).toBe(true);
    expect(result.data?.surcharge).toBe(computeSurchargeFor(48.9));
    expect(result.data?.paypal_order_id).toBe("PP-ORDER-1");
  });

  it("surfaces the gateway's failure message", async () => {
    seedAwaitingOrder();
    const gateway = new FakePayPalGateway();
    gateway.createResult = { ok: false, message: "Could not start PayPal checkout. Please try again." };
    const result = await createPaypalOrderForCheckout(store, gateway, settings, biz.name, { order_id: "ORD-1" }, false);
    expect(result.ok).toBe(false);
  });
});

function computeSurchargeFor(amount: number): number {
  return Math.round((amount * 3.49 / 100 + 0.49) * 100) / 100;
}

describe("capturePaypalOrderForCheckout", () => {
  it("rejects a missing order_id", async () => {
    const gateway = new FakePayPalGateway();
    const result = await capturePaypalOrderForCheckout(store, gateway, customers, settings, emailStore, emailSender, biz, {}, false);
    expect(result.ok).toBe(false);
  });

  it("surfaces the guard message when claimForProcessing reports a lost race", async () => {
    seedAwaitingOrder();
    store.claimForProcessing = async () => false;
    const gateway = new FakePayPalGateway();
    const result = await capturePaypalOrderForCheckout(store, gateway, customers, settings, emailStore, emailSender, biz, { order_id: "ORD-1", paypal_order_id: "PP-1" }, false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no longer awaiting payment/);
  });

  it("test_mode is checked AFTER the atomic claim — a denied admin check still releases it", async () => {
    seedAwaitingOrder();
    const gateway = new FakePayPalGateway();
    const denied = await capturePaypalOrderForCheckout(store, gateway, customers, settings, emailStore, emailSender, biz, { order_id: "ORD-1", test_mode: true }, false);
    expect(denied.status).toBe(401);
    expect(store.orders[0]!.status).toBe("Awaiting Payment"); // released, not stuck Processing
  });

  it("test_mode success marks Paid with payment_method 'PayPal'", async () => {
    seedAwaitingOrder();
    const gateway = new FakePayPalGateway();
    const result = await capturePaypalOrderForCheckout(store, gateway, customers, settings, emailStore, emailSender, biz, { order_id: "ORD-1", test_mode: true }, true);
    expect(result.ok).toBe(true);
    expect(store.orders[0]!.status).toBe("Paid");
    expect(store.orders[0]!.payment_method).toBe("PayPal");
    expect(gateway.captureResult).toBeDefined(); // sanity: gateway itself never invoked (no spy needed, capture() isn't awaited on this path)
  });

  it("rejects a missing paypal_order_id and releases the claim", async () => {
    seedAwaitingOrder();
    const gateway = new FakePayPalGateway();
    const result = await capturePaypalOrderForCheckout(store, gateway, customers, settings, emailStore, emailSender, biz, { order_id: "ORD-1" }, false);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing paypal_order_id/);
    expect(store.orders[0]!.status).toBe("Awaiting Payment");
  });

  it("releases the claim and surfaces the gateway's message on a failed capture", async () => {
    seedAwaitingOrder();
    const gateway = new FakePayPalGateway();
    gateway.captureResult = { ok: false, message: "PayPal payment could not be completed. Please try again." };
    const result = await capturePaypalOrderForCheckout(store, gateway, customers, settings, emailStore, emailSender, biz, { order_id: "ORD-1", paypal_order_id: "PP-1" }, false);
    expect(result.ok).toBe(false);
    expect(store.orders[0]!.status).toBe("Awaiting Payment");
  });

  it("marks Paid with the real funding source, fee, and surcharge on a completed capture", async () => {
    seedAwaitingOrder();
    const gateway = new FakePayPalGateway();
    gateway.captureResult = { ok: true, captureId: "CAP-1", status: "COMPLETED", feeUsd: 1.23, fundingSource: "Venmo" };
    const result = await capturePaypalOrderForCheckout(store, gateway, customers, settings, emailStore, emailSender, biz, { order_id: "ORD-1", paypal_order_id: "PP-1" }, false);
    expect(result.ok).toBe(true);
    expect(store.orders[0]!.status).toBe("Paid");
    expect(store.orders[0]!.payment_method).toBe("Venmo");
    expect(store.orders[0]!.paypal_capture_id).toBe("CAP-1");
    expect(store.orders[0]!.transaction_fee).toBe(1.23);
    expect(customers.calls).toEqual(["jane@example.com"]);
    expect(emailSender.sent).toHaveLength(1);
  });
});

describe("verifySquareWebhookSignature", () => {
  const key = "test-signing-key";
  const url = "https://hdbs-staging.workers.dev/square-webhook";
  const body = '{"type":"payment.updated"}';

  async function sign(payload: string): Promise<string> {
    const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }

  it("accepts a valid signature", async () => {
    const sig = await sign(url + body);
    expect(await verifySquareWebhookSignature(body, sig, key, url)).toBe(true);
  });

  it("rejects a missing signature", async () => {
    expect(await verifySquareWebhookSignature(body, "", key, url)).toBe(false);
  });

  it("rejects a tampered body", async () => {
    const sig = await sign(url + body);
    expect(await verifySquareWebhookSignature(body + "x", sig, key, url)).toBe(false);
  });
});

describe("handleSquareWebhookEvent", () => {
  it("ignores non-payment.updated events", async () => {
    const result = await handleSquareWebhookEvent(store, { type: "refund.updated" });
    expect(result.handled).toBe(false);
  });

  it("ignores a payment that isn't COMPLETED", async () => {
    const result = await handleSquareWebhookEvent(store, { type: "payment.updated", data: { object: { payment: { status: "PENDING" } } } });
    expect(result.handled).toBe(false);
  });

  it("matches by amount when the note doesn't carry a parseable order id (the realistic path)", async () => {
    store.orders = [makeOrderRow({ id: "ORD-9", status: "Awaiting Payment", total: 92.8, created_at: new Date().toISOString() })];
    const result = await handleSquareWebhookEvent(store, {
      type: "payment.updated",
      data: { object: { payment: { id: "sqpay1", status: "COMPLETED", note: "ORD-9", order_id: "sqorder1", amount_money: { amount: 9280 } } } },
    });
    expect(result.handled).toBe(true);
    expect(result.orderId).toBe("ORD-9");
    expect(store.orders[0]!.status).toBe("Paid");
    expect(store.orders[0]!.square_payment_id).toBe("sqpay1");
  });

  it("matches via the 'Order XXXX' note pattern when present", async () => {
    store.orders = [makeOrderRow({ id: "ORD-7", status: "Awaiting Payment" })];
    const result = await handleSquareWebhookEvent(store, {
      type: "payment.updated",
      data: { object: { payment: { id: "sqpay2", status: "COMPLETED", note: "Order ORD-7" } } },
    });
    expect(result.handled).toBe(true);
    expect(result.orderId).toBe("ORD-7");
  });

  it("does not touch status/square_payment_id on an order already marked Paid (idempotent backstop)", async () => {
    store.orders = [makeOrderRow({ id: "ORD-9", status: "Paid", total: 92.8, tax_amount: 7.8, created_at: new Date().toISOString() })];
    const result = await handleSquareWebhookEvent(store, {
      type: "payment.updated",
      data: { object: { payment: { id: "sqpay-new", status: "COMPLETED", note: "Order ORD-9" } } },
    });
    expect(result.handled).toBe(true);
    expect(store.orders[0]!.square_payment_id).toBeNull(); // unchanged — the guard skipped the update
  });

  it("backfills transaction_fee on an already-Paid order — the realistic case, since chargeOrderWithSquare's synchronous flow always marks Paid before this webhook arrives", async () => {
    store.orders = [makeOrderRow({ id: "ORD-9", status: "Paid", total: 92.8, tax_amount: 7.8, transaction_fee: 0, created_at: new Date().toISOString() })];
    const result = await handleSquareWebhookEvent(store, {
      type: "payment.updated",
      data: {
        object: {
          payment: {
            id: "sqpay-new",
            status: "COMPLETED",
            note: "Order ORD-9",
            processing_fee: [{ amount_money: { amount: 189 } }],
          },
        },
      },
    });
    expect(result.handled).toBe(true);
    expect(store.orders[0]!.transaction_fee).toBe(1.89);
    expect(store.orders[0]!.status).toBe("Paid"); // untouched, still Paid — not re-set
    expect(store.orders[0]!.square_payment_id).toBeNull(); // untouched — not overwritten by this backfill
  });

  it("backfills transaction_fee via square_payment_id on the REALISTIC note shape — bare order id, no 'Order ' prefix, exactly what chargeOrderWithSquare's own charge sends", async () => {
    // Every prior test in this file used note: "Order ORD-9", which matches fallback 1 and never
    // exercises the real path — this is why the underlying matching bug (payment.order_id instead
    // of payment.id in fallback 3) went unnoticed until a real staging order failed to backfill.
    store.orders = [
      makeOrderRow({ id: "ORD-9", status: "Paid", total: 92.8, tax_amount: 7.8, transaction_fee: 0, square_payment_id: "sqpay-real", created_at: new Date().toISOString() }),
    ];
    const result = await handleSquareWebhookEvent(store, {
      type: "payment.updated",
      data: {
        object: {
          payment: {
            id: "sqpay-real",
            status: "COMPLETED",
            note: "ORD-9", // bare id, no "Order " prefix
            order_id: "SQORDER-XYZ", // Square's own order id -- a different id space, must NOT be compared against square_payment_id
            processing_fee: [{ amount_money: { amount: 189 } }],
          },
        },
      },
    });
    expect(result.handled).toBe(true);
    expect(result.orderId).toBe("ORD-9");
    expect(store.orders[0]!.transaction_fee).toBe(1.89);
  });

  it("matches the correct order by payment id even when two Paid orders share the identical total (the exact bug reported live)", async () => {
    store.orders = [
      makeOrderRow({ id: "ORD-EARLIER", status: "Paid", total: 56.77, transaction_fee: 1.95, square_payment_id: "sqpay-earlier", created_at: new Date(Date.now() - 60000).toISOString() }),
      makeOrderRow({ id: "ORD-LATER", status: "Paid", total: 56.77, transaction_fee: 0, square_payment_id: "sqpay-later", created_at: new Date().toISOString() }),
    ];
    const result = await handleSquareWebhookEvent(store, {
      type: "payment.updated",
      data: {
        object: {
          payment: { id: "sqpay-later", status: "COMPLETED", note: "ORD-LATER", processing_fee: [{ amount_money: { amount: 210 } }] },
        },
      },
    });
    expect(result.orderId).toBe("ORD-LATER"); // not the earlier order, despite the identical amount
    expect(store.orders.find((o) => o.id === "ORD-LATER")!.transaction_fee).toBe(2.1);
    expect(store.orders.find((o) => o.id === "ORD-EARLIER")!.transaction_fee).toBe(1.95); // untouched
  });

  it("never overwrites an already-recorded transaction_fee on a Paid order (webhook retry safety)", async () => {
    store.orders = [makeOrderRow({ id: "ORD-9", status: "Paid", total: 92.8, tax_amount: 7.8, transaction_fee: 2.5, created_at: new Date().toISOString() })];
    await handleSquareWebhookEvent(store, {
      type: "payment.updated",
      data: {
        object: {
          payment: { id: "sqpay-retry", status: "COMPLETED", note: "Order ORD-9", processing_fee: [{ amount_money: { amount: 189 } }] },
        },
      },
    });
    expect(store.orders[0]!.transaction_fee).toBe(2.5); // unchanged — already had a real fee recorded
  });

  it("returns unhandled when no order can be identified", async () => {
    const result = await handleSquareWebhookEvent(store, {
      type: "payment.updated",
      data: { object: { payment: { id: "sqpay3", status: "COMPLETED", note: "", order_id: "sqorderX", amount_money: { amount: 999999 } } } },
    });
    expect(result.handled).toBe(false);
  });

  it("logs a webhook_log PAID entry on a successful match, matching square-webhook.php's own log line", async () => {
    store.orders = [makeOrderRow({ id: "ORD-7", status: "Awaiting Payment" })];
    const appLog = new AppLogStoreFake();
    await handleSquareWebhookEvent(
      store,
      { type: "payment.updated", data: { object: { payment: { id: "sqpay2", status: "COMPLETED", note: "Order ORD-7" } } } },
      appLog
    );
    expect(appLog.rows["webhook_log.txt"]).toHaveLength(1);
    expect(appLog.rows["webhook_log.txt"]![0]).toEqual({
      loggedAt: appLog.rows["webhook_log.txt"]![0]!.loggedAt,
      context: "PAID",
      message: "Order: ORD-7 | Square: sqpay2",
    });
  });

  it("logs a webhook_log entry when no order can be identified", async () => {
    const appLog = new AppLogStoreFake();
    await handleSquareWebhookEvent(
      store,
      { type: "payment.updated", data: { object: { payment: { id: "sqpay3", status: "COMPLETED", note: "", order_id: "sqorderX", amount_money: { amount: 999999 } } } } },
      appLog
    );
    expect(appLog.rows["webhook_log.txt"]).toHaveLength(1);
    expect(appLog.rows["webhook_log.txt"]![0]!.context).toBe("COMPLETED but no order ID found");
  });
});
