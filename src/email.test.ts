import { describe, it, expect, beforeEach } from "vitest";
import { buildOrderConfirmationEmailHtml, sendOrderConfirmationEmail, type EmailOrderStore, type OrderForConfirmation, type OrderItemForConfirmation } from "./email";
import type { EmailSender, EmailSendResult } from "./lib/email-sender";

function makeOrder(overrides: Partial<OrderForConfirmation> = {}): OrderForConfirmation {
  return {
    id: "ORD-1",
    customer_email: "jane@example.com",
    customer_name: "Jane Doe",
    shipping_address: "123 Main St",
    total: 66.88,
    tax_amount: 4.88,
    order_date: "2026-07-03",
    order_type: "Online",
    payment_method: "Credit Card",
    check_number: null,
    transaction_fee: 2.24,
    ...overrides,
  };
}

class EmailOrderStoreFake implements EmailOrderStore {
  orders = new Map<string, OrderForConfirmation>();
  items = new Map<string, OrderItemForConfirmation[]>();
  stamped: { orderId: string; sentAtIso: string }[] = [];
  logs: { emailType: string; sentTo: string; orderId: string; subject: string; status: string; body: string }[] = [];

  async getOrderForConfirmation(orderId: string) {
    return this.orders.get(orderId) ?? null;
  }
  async getOrderItemsForConfirmation(orderId: string) {
    return this.items.get(orderId) ?? [];
  }
  async stampConfirmSentAt(orderId: string, sentAtIso: string) {
    this.stamped.push({ orderId, sentAtIso });
  }
  async logEmail(entry: { emailType: string; sentTo: string; orderId: string; subject: string; status: "sent" | "failed" | "sink"; body: string }) {
    this.logs.push(entry);
  }
}

class FakeEmailSender implements EmailSender {
  result: EmailSendResult = { sent: true, status: "sink", html: "<html>sent</html>" };
  lastTo: string | string[] | null = null;
  async send(to: string | string[]): Promise<EmailSendResult> {
    this.lastTo = to;
    return this.result;
  }
}

let store: EmailOrderStoreFake;
let sender: FakeEmailSender;

beforeEach(() => {
  store = new EmailOrderStoreFake();
  sender = new FakeEmailSender();
});

describe("buildOrderConfirmationEmailHtml", () => {
  it("separates the _ship item into shipping, excludes it from the item table", () => {
    const order = makeOrder();
    const items: OrderItemForConfirmation[] = [
      { product_id: "_ship", product_name: "Shipping", price: 12, quantity: 1, img: null, sku: null },
      { product_id: "p1", product_name: "Tote", price: 50, quantity: 1, img: null, sku: "TOT001" },
    ];
    const html = buildOrderConfirmationEmailHtml("Biz", "biz@example.com", order, items);
    expect(html).toContain("$12.00"); // shipping cost, in the totals footer
    expect(html).toContain("Tote");
    expect(html).toContain("TOT001");
    // The _ship row must not appear as a line item in the item table body (only Tote should).
    const tbodyMatch = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)!;
    expect(tbodyMatch[1]).not.toContain("Shipping");
    expect(tbodyMatch[1]).toContain("Tote");
  });

  it("shows 'Free' shipping when there's no _ship item", () => {
    const html = buildOrderConfirmationEmailHtml("Biz", "biz@example.com", makeOrder(), []);
    expect(html).toContain(">Free<");
  });

  it("computes item subtotal correctly across multiple items", () => {
    const items: OrderItemForConfirmation[] = [
      { product_id: "p1", product_name: "Tote", price: 50, quantity: 2, img: null, sku: null },
      { product_id: "p2", product_name: "Purse", price: 30, quantity: 1, img: null, sku: null },
    ];
    const html = buildOrderConfirmationEmailHtml("Biz", "biz@example.com", makeOrder(), items);
    expect(html).toContain("$130.00"); // subtotal: 50*2 + 30
  });

  it("uses a placeholder thumbnail when no http image is present, a real <img> when one is", () => {
    const withImg = buildOrderConfirmationEmailHtml("Biz", "biz@example.com", makeOrder(), [
      { product_id: "p1", product_name: "Tote", price: 50, quantity: 1, img: "https://x/img.jpg", sku: null },
    ]);
    expect(withImg).toContain("<img src='https://x/img.jpg'");

    const withoutImg = buildOrderConfirmationEmailHtml("Biz", "biz@example.com", makeOrder(), [
      { product_id: "p1", product_name: "Tote", price: 50, quantity: 1, img: null, sku: null },
    ]);
    expect(withoutImg).toContain("background:#fdf3d0");
  });

  it("shows the check number row only when present", () => {
    const withCheck = buildOrderConfirmationEmailHtml("Biz", "biz@example.com", makeOrder({ check_number: "1234" }), []);
    expect(withCheck).toContain("Check #");
    expect(withCheck).toContain("1234");

    const withoutCheck = buildOrderConfirmationEmailHtml("Biz", "biz@example.com", makeOrder({ check_number: null }), []);
    expect(withoutCheck).not.toContain("Check #");
  });

  it("shows the transaction fee row only when fee > 0", () => {
    const withFee = buildOrderConfirmationEmailHtml("Biz", "biz@example.com", makeOrder({ transaction_fee: 2.24 }), []);
    expect(withFee).toContain("Transaction Fee");

    const withoutFee = buildOrderConfirmationEmailHtml("Biz", "biz@example.com", makeOrder({ transaction_fee: 0 }), []);
    expect(withoutFee).not.toContain("Transaction Fee");
  });

  it("greets the customer by first name only", () => {
    const html = buildOrderConfirmationEmailHtml("Biz", "biz@example.com", makeOrder({ customer_name: "Jane Marie Doe" }), []);
    expect(html).toContain("Hi Jane!");
  });
});

describe("sendOrderConfirmationEmail", () => {
  it("requires an order_id", async () => {
    const result = await sendOrderConfirmationEmail(store, sender, "Biz", "biz@example.com", "");
    expect(result.ok).toBe(false);
  });

  it("fails when the order doesn't exist", async () => {
    const result = await sendOrderConfirmationEmail(store, sender, "Biz", "biz@example.com", "ORD-missing");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it("sends to both the customer and the admin inbox when a customer email exists", async () => {
    store.orders.set("ORD-1", makeOrder());
    await sendOrderConfirmationEmail(store, sender, "Biz", "biz@example.com", "ORD-1");
    expect(sender.lastTo).toEqual(["jane@example.com", "handmadedesignsbysuzi@yahoo.com"]);
  });

  it("sends only to the admin inbox when there's no customer email, and logs 'admin-only'", async () => {
    store.orders.set("ORD-1", makeOrder({ customer_email: "" }));
    await sendOrderConfirmationEmail(store, sender, "Biz", "biz@example.com", "ORD-1");
    expect(sender.lastTo).toEqual(["handmadedesignsbysuzi@yahoo.com"]);
    expect(store.logs[0]!.sentTo).toBe("admin-only");
  });

  it("stamps confirm_sent_at and logs the email on a real send", async () => {
    store.orders.set("ORD-1", makeOrder());
    const now = new Date("2026-07-03T17:39:22Z");
    await sendOrderConfirmationEmail(store, sender, "Biz", "biz@example.com", "ORD-1", {}, now);
    expect(store.stamped).toEqual([{ orderId: "ORD-1", sentAtIso: now.toISOString() }]);
    expect(store.logs[0]!.emailType).toBe("Order Confirmation");
    expect(store.logs[0]!.orderId).toBe("ORD-1");
  });

  it("preview mode returns the spliced html and subject, without sending or logging", async () => {
    store.orders.set("ORD-1", makeOrder());
    const result = await sendOrderConfirmationEmail(store, sender, "Biz", "biz@example.com", "ORD-1", { preview: true });
    expect(result.ok).toBe(true);
    expect(result.data?.preview).toBe(true);
    expect(result.data?.html).toContain("HDBSLogo.jpeg"); // logo-spliced even in preview
    expect(sender.lastTo).toBeNull(); // never actually sent
    expect(store.logs).toEqual([]); // never logged
    expect(store.stamped).toEqual([]); // never stamped
  });

  it("reports failure when the sender fails, without throwing", async () => {
    store.orders.set("ORD-1", makeOrder());
    sender.result = { sent: false, status: "failed", html: "<html></html>" };
    const result = await sendOrderConfirmationEmail(store, sender, "Biz", "biz@example.com", "ORD-1");
    expect(result.ok).toBe(false);
    // still logs + stamps even on failure, matching the PHP's "log either way" behavior
    expect(store.logs[0]!.status).toBe("failed");
    expect(store.stamped).toHaveLength(1);
  });
});
