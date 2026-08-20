import { describe, it, expect, beforeEach } from "vitest";
import { requestOrderLookupLink, viewOrdersByToken, buildOrderLookupEmailHtml, type OrderLookupStore } from "./order-lookup";
import { makeOrderToken } from "./lib/order-token";
import type { OrderRow, OrderItemRow } from "./orders";
import type { EmailSender, EmailSendResult } from "./lib/email-sender";

const SECRET = "test-secret";

function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "ORD-1",
    customer_name: "Jane Smith",
    customer_email: "jane@example.com",
    customer_phone: null,
    shipping_address: "123 Main St",
    shipping_carrier: null,
    tracking_number: null,
    confirm_sent_at: null,
    shipping_sent_at: null,
    total: 50,
    payment_method: "Credit Card",
    status: "Paid",
    square_payment_id: "sq_123",
    order_date: "2026-08-01",
    created_at: "2026-08-01T12:00:00Z",
    tax_amount: 4,
    tax_swept_date: null,
    order_type: "Online",
    transaction_fee: 1.5,
    payment_configuration: "Online",
    check_number: null,
    refunded_amount: 0,
    paypal_capture_id: null,
    paypal_surcharge: 0,
    square_surcharge: 0,
    ...overrides,
  };
}

class OrderLookupStoreFake implements OrderLookupStore {
  rateLimits = new Map<string, { attempts: number; lastAt: number }>();
  orders: OrderRow[] = [];
  items: OrderItemRow[] = [];

  async getRateLimit(key: string) {
    return this.rateLimits.get(key) ?? null;
  }
  async setRateLimit(key: string, attempts: number, lastAt: number) {
    this.rateLimits.set(key, { attempts, lastAt });
  }
  async listOrdersForEmail(email: string) {
    return this.orders.filter((o) => o.customer_email?.toLowerCase() === email.toLowerCase());
  }
  async listOrderItemsForOrderIds(orderIds: string[]) {
    return this.items.filter((i) => orderIds.includes(i.order_id));
  }
}

class FakeEmailSender implements EmailSender {
  result: EmailSendResult = { sent: true, status: "sink", html: "" };
  sentTo: string | string[] | null = null;
  sentSubject: string | null = null;
  async send(to: string | string[], subject: string): Promise<EmailSendResult> {
    this.sentTo = to;
    this.sentSubject = subject;
    return this.result;
  }
}

let store: OrderLookupStoreFake;
let sender: FakeEmailSender;

beforeEach(() => {
  store = new OrderLookupStoreFake();
  sender = new FakeEmailSender();
});

describe("buildOrderLookupEmailHtml", () => {
  it("escapes HTML in the business name and includes the link", () => {
    const html = buildOrderLookupEmailHtml("<script>x</script>", "https://example.com/?orders=abc");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("https://example.com/?orders=abc");
  });
});

describe("requestOrderLookupLink", () => {
  it("rejects an invalid email", async () => {
    const result = await requestOrderLookupLink(store, sender, "Biz", "not-an-email", "https://example.com", SECRET, "k");
    expect(result.ok).toBe(false);
  });

  it("returns the generic message and does not send when the email has no orders (no enumeration)", async () => {
    const result = await requestOrderLookupLink(store, sender, "Biz", "nobody@example.com", "https://example.com", SECRET, "k");
    expect(result.ok).toBe(true);
    expect(result.data!.message).toMatch(/If we found orders/);
    expect(sender.sentTo).toBeNull();
  });

  it("sends a link when the email has orders, with the same generic response", async () => {
    store.orders.push(makeOrder());
    const result = await requestOrderLookupLink(store, sender, "Biz", "jane@example.com", "https://example.com", SECRET, "k");
    expect(result.ok).toBe(true);
    expect(result.data!.message).toMatch(/If we found orders/);
    expect(sender.sentTo).toBe("jane@example.com");
    expect(sender.sentSubject).toContain("Biz");
  });

  it("rate limits at 5 per 15 minutes per key, still returning the generic response", async () => {
    store.orders.push(makeOrder());
    const now = 1000;
    for (let i = 0; i < 5; i++) {
      const result = await requestOrderLookupLink(store, sender, "Biz", "jane@example.com", "https://example.com", SECRET, "sameKey", now);
      expect(result.ok).toBe(true);
    }
    sender.sentTo = null;
    const blocked = await requestOrderLookupLink(store, sender, "Biz", "jane@example.com", "https://example.com", SECRET, "sameKey", now + 5);
    expect(blocked.ok).toBe(true);
    expect(blocked.data!.message).toMatch(/If we found orders/);
    expect(sender.sentTo).toBeNull(); // blocked silently, no email sent, but caller can't tell
  });

  it("does not surface a failed send — response stays generic", async () => {
    store.orders.push(makeOrder());
    sender.result = { sent: false, status: "failed", html: "" };
    const result = await requestOrderLookupLink(store, sender, "Biz", "jane@example.com", "https://example.com", SECRET, "k");
    expect(result.ok).toBe(true);
  });
});

describe("viewOrdersByToken", () => {
  it("rejects an invalid token", async () => {
    const result = await viewOrdersByToken(store, "not-a-real-token", SECRET);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects an expired token", async () => {
    const token = await makeOrderToken("jane@example.com", 100, SECRET, 1000);
    const result = await viewOrdersByToken(store, token, SECRET, 1000 + 200);
    expect(result.ok).toBe(false);
  });

  it("returns only the token's own email's orders, in a customer-safe shape", async () => {
    store.orders.push(makeOrder({ id: "ORD-1", customer_email: "jane@example.com" }));
    store.orders.push(makeOrder({ id: "ORD-2", customer_email: "someoneelse@example.com" }));
    store.items.push({ order_id: "ORD-1", product_id: "p1", product_name: "Tote Bag", price: 46, quantity: 1 });

    const token = await makeOrderToken("jane@example.com", 2700, SECRET, 1000);
    const result = await viewOrdersByToken(store, token, SECRET, 1000);

    expect(result.ok).toBe(true);
    expect(result.data!.email).toBe("jane@example.com");
    expect(result.data!.orders).toHaveLength(1);
    const order = result.data!.orders[0]!;
    expect(order.id).toBe("ORD-1");
    expect(order.items).toEqual([{ name: "Tote Bag", price: 46, q: 1 }]);
    // Customer-safe: no internal fields leaked.
    expect(order).not.toHaveProperty("square_payment_id");
    expect(order).not.toHaveProperty("fee");
    expect(order).not.toHaveProperty("swept_date");
  });

  it("returns an empty list for a valid token with no orders", async () => {
    const token = await makeOrderToken("nobody@example.com", 2700, SECRET, 1000);
    const result = await viewOrdersByToken(store, token, SECRET, 1000);
    expect(result.ok).toBe(true);
    expect(result.data!.orders).toEqual([]);
  });
});
