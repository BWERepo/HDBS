import { describe, it, expect, beforeEach } from "vitest";
import {
  listOrders,
  mapOrderForResponse,
  createOrder,
  updateOrder,
  deleteOrder,
  deleteAllOrders,
  reclaimStaleOrders,
  makeCancelToken,
  OrdersStoreFake,
  makeOrderRow,
} from "./orders";

const SECRET = "test-order-token-secret";

let store: OrdersStoreFake;

beforeEach(() => {
  store = new OrdersStoreFake();
});

describe("mapOrderForResponse", () => {
  it("formats order_date as n/j/Y with no leading zeros", () => {
    const order = makeOrderRow({ id: "o1", order_date: "2026-07-03" });
    const dto = mapOrderForResponse(order, []);
    expect(dto.date).toBe("7/3/2026");
    expect(dto.dispDate).toBe("7/3/2026");
  });

  it("converts created_at (UTC) to America/New_York 12-hour time", () => {
    // Real production data point: ORD-MR57UJ0A's created_at, confirmed via the daily backup to be
    // stored in UTC (see scripts/migrate-data.mjs's header for the empirical cross-check against
    // the matching email_log row).
    const order = makeOrderRow({ id: "o1", created_at: "2026-07-03T17:37:26Z" });
    expect(mapOrderForResponse(order, []).time).toBe("1:37 PM");
  });

  it("formats a morning time with AM", () => {
    const order = makeOrderRow({ id: "o1", created_at: "2026-07-03T09:05:00Z" });
    // 09:05 UTC = 5:05 AM EDT
    expect(mapOrderForResponse(order, []).time).toBe("5:05 AM");
  });

  it("returns empty date/time for null order_date/created_at", () => {
    const order = makeOrderRow({ id: "o1" });
    const dto = mapOrderForResponse(order, []);
    expect(dto.date).toBe("");
    expect(dto.time).toBe("");
  });

  it("separates the _ship line item into `shipping`, excludes it from `items`", () => {
    const order = makeOrderRow({ id: "o1" });
    const items = [
      { order_id: "o1", product_id: "_ship", product_name: "Shipping", price: 12, quantity: 1 },
      { order_id: "o1", product_id: "p1", product_name: "Tote", price: 50, quantity: 2 },
    ];
    const dto = mapOrderForResponse(order, items);
    expect(dto.shipping).toBe(12);
    expect(dto.items).toEqual([{ id: "p1", name: "Tote", price: 50, q: 2 }]);
  });

  it("computes subtotal from non-shipping items only", () => {
    const order = makeOrderRow({ id: "o1" });
    const items = [
      { order_id: "o1", product_id: "_ship", product_name: "Shipping", price: 12, quantity: 1 },
      { order_id: "o1", product_id: "p1", product_name: "Tote", price: 50, quantity: 2 },
      { order_id: "o1", product_id: "p2", product_name: "Purse", price: 30, quantity: 1 },
    ];
    expect(mapOrderForResponse(order, items).subtotal).toBe(130);
  });

  it("defaults shipping to 0 and items to [] when there are no line items", () => {
    const order = makeOrderRow({ id: "o1" });
    const dto = mapOrderForResponse(order, []);
    expect(dto.shipping).toBe(0);
    expect(dto.items).toEqual([]);
    expect(dto.subtotal).toBe(0);
  });

  it("only includes items belonging to this order", () => {
    const order = makeOrderRow({ id: "o1" });
    const items = [
      { order_id: "o1", product_id: "p1", product_name: "Tote", price: 50, quantity: 1 },
      { order_id: "o2", product_id: "p2", product_name: "Purse", price: 30, quantity: 1 },
    ];
    expect(mapOrderForResponse(order, items).items).toEqual([{ id: "p1", name: "Tote", price: 50, q: 1 }]);
  });

  it("applies the same defaults as the PHP mapping for nullable fields", () => {
    const order = makeOrderRow({ id: "o1", order_type: null as never, payment_configuration: null as never, shipping_carrier: null as never });
    const dto = mapOrderForResponse(order, []);
    expect(dto.order_type).toBe("Online");
    expect(dto.payment_config).toBe("Online");
    expect(dto.carrier).toBe("USPS");
    expect(dto.check_number).toBe("");
    expect(dto.tracking).toBe("");
  });
});

describe("listOrders", () => {
  it("returns an empty list with no orders", async () => {
    expect(await listOrders(store)).toEqual([]);
  });

  it("maps every order and groups items by order_id correctly across multiple orders", async () => {
    store.orders = [makeOrderRow({ id: "o1", total: 62 }), makeOrderRow({ id: "o2", total: 30 })];
    store.items = [
      { order_id: "o1", product_id: "_ship", product_name: "Shipping", price: 12, quantity: 1 },
      { order_id: "o1", product_id: "p1", product_name: "Tote", price: 50, quantity: 1 },
      { order_id: "o2", product_id: "p2", product_name: "Purse", price: 30, quantity: 1 },
    ];
    const result = await listOrders(store);
    expect(result.find((o) => o.id === "o1")?.shipping).toBe(12);
    expect(result.find((o) => o.id === "o1")?.subtotal).toBe(50);
    expect(result.find((o) => o.id === "o2")?.shipping).toBe(0);
    expect(result.find((o) => o.id === "o2")?.subtotal).toBe(30);
  });
});

describe("makeCancelToken", () => {
  it("is deterministic for the same order id and secret", async () => {
    const a = await makeCancelToken("ORD-1", SECRET);
    const b = await makeCancelToken("ORD-1", SECRET);
    expect(a).toBe(b);
  });

  it("is the full 64-hex-char HMAC-SHA256 output, not truncated", async () => {
    const token = await makeCancelToken("ORD-1", SECRET);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for a different order id", async () => {
    expect(await makeCancelToken("ORD-1", SECRET)).not.toBe(await makeCancelToken("ORD-2", SECRET));
  });

  it("differs for a different secret", async () => {
    expect(await makeCancelToken("ORD-1", SECRET)).not.toBe(await makeCancelToken("ORD-1", "other-secret"));
  });
});

describe("createOrder", () => {
  it("rejects a missing id or total", async () => {
    expect((await createOrder(store, { id: "", total: 10 }, false, "k", SECRET)).ok).toBe(false);
    expect((await createOrder(store, { id: "ORD-1", total: 0 }, false, "k", SECRET)).ok).toBe(false);
  });

  it("forces guests into Awaiting Payment even if a different status is requested", async () => {
    const result = await createOrder(store, { id: "ORD-1", total: 50, status: "Paid" }, false, "k", SECRET);
    expect(result.ok).toBe(true);
    expect(store.orders[0]!.status).toBe("Awaiting Payment");
  });

  it("allows an admin to set an arbitrary status", async () => {
    await createOrder(store, { id: "ORD-1", total: 50, status: "Paid" }, true, "k", SECRET);
    expect(store.orders[0]!.status).toBe("Paid");
  });

  it("allows a storefront in-person cash/check order to keep its requested status and fires the confirmation hook", async () => {
    let confirmedId: string | null = null;
    const result = await createOrder(
      store,
      { id: "ORD-1", total: 50, status: "Paid", source: "storefront", payment_config: "InPerson", pay: "Cash" },
      false,
      "k",
      SECRET,
      undefined,
      undefined,
      undefined,
      async (id) => {
        confirmedId = id;
      }
    );
    expect(result.ok).toBe(true);
    expect(store.orders[0]!.status).toBe("Paid");
    expect(confirmedId).toBe("ORD-1");
  });

  it("does not fire the confirmation hook for a normal guest order", async () => {
    let fired = false;
    await createOrder(store, { id: "ORD-1", total: 50 }, false, "k", SECRET, undefined, undefined, undefined, async () => {
      fired = true;
    });
    expect(fired).toBe(false);
  });

  it("ignores a guest-submitted price and always uses the real catalog price", async () => {
    store.products.set("p1", { name: "Tote", price: 50, stock: 5 });
    await createOrder(store, { id: "ORD-1", total: 50, items: [{ id: "p1", q: 1, price: 1 }] }, false, "k", SECRET);
    expect(store.items.find((i) => i.product_id === "p1")?.price).toBe(50);
  });

  it("honours an admin-submitted price override", async () => {
    store.products.set("p1", { name: "Tote", price: 50, stock: 5 });
    await createOrder(store, { id: "ORD-1", total: 40, items: [{ id: "p1", q: 1, price: 40 }] }, true, "k", SECRET);
    expect(store.items.find((i) => i.product_id === "p1")?.price).toBe(40);
  });

  it("decrements stock for each item ordered", async () => {
    store.products.set("p1", { name: "Tote", price: 50, stock: 5 });
    await createOrder(store, { id: "ORD-1", total: 100, items: [{ id: "p1", q: 2 }] }, false, "k", SECRET);
    expect(store.products.get("p1")!.stock).toBe(3);
  });

  it("inserts a _ship line item when shipping > 0, and omits it when shipping is 0", async () => {
    await createOrder(store, { id: "ORD-1", total: 62, shipping: 12 }, false, "k", SECRET);
    expect(store.items.some((i) => i.product_id === "_ship" && i.price === 12)).toBe(true);

    await createOrder(store, { id: "ORD-2", total: 50, shipping: 0 }, false, "k", SECRET);
    expect(store.items.some((i) => i.order_id === "ORD-2" && i.product_id === "_ship")).toBe(false);
  });

  it("rolls back (deletes the order) on an unknown product", async () => {
    const result = await createOrder(store, { id: "ORD-1", total: 50, items: [{ id: "does-not-exist", q: 1 }] }, false, "k", SECRET);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown product/);
    expect(store.orders).toEqual([]);
  });

  it("rolls back and restores already-decremented stock when a later item is out of stock", async () => {
    store.products.set("p1", { name: "Tote", price: 50, stock: 5 });
    store.products.set("p2", { name: "Purse", price: 30, stock: 0 });
    const result = await createOrder(
      store,
      { id: "ORD-1", total: 80, items: [{ id: "p1", q: 1 }, { id: "p2", q: 1 }] },
      false,
      "k",
      SECRET
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/out of stock/);
    expect(store.orders).toEqual([]);
    expect(store.products.get("p1")!.stock).toBe(5); // restored
  });

  it("returns a cancel_token on success", async () => {
    const result = await createOrder(store, { id: "ORD-1", total: 50 }, false, "k", SECRET);
    expect(result.data?.cancel_token).toBe(await makeCancelToken("ORD-1", SECRET));
  });

  it("rate limits guests at 15 orders/hour per key, but not admins", async () => {
    const now = new Date("2026-08-01T12:00:00Z");
    for (let i = 0; i < 15; i++) {
      const result = await createOrder(store, { id: `ORD-${i}`, total: 10 }, false, "same-key", SECRET, undefined, undefined, now);
      expect(result.ok).toBe(true);
    }
    const blocked = await createOrder(store, { id: "ORD-blocked", total: 10 }, false, "same-key", SECRET, undefined, undefined, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/Too many orders/);

    const adminResult = await createOrder(store, { id: "ORD-admin", total: 10 }, true, "same-key", SECRET, undefined, undefined, now);
    expect(adminResult.ok).toBe(true);
  });

  it("reclaims stale awaiting-payment orders on every creation attempt", async () => {
    const now = new Date("2026-08-01T12:00:00Z");
    const staleTime = new Date(now.getTime() - 3 * 3600 * 1000).toISOString();
    store.orders = [makeOrderRow({ id: "OLD-1", status: "Awaiting Payment", created_at: staleTime })];
    store.items = [{ order_id: "OLD-1", product_id: "p1", product_name: "Tote", price: 50, quantity: 2 }];
    store.products.set("p1", { name: "Tote", price: 50, stock: 0 });

    await createOrder(store, { id: "ORD-new", total: 10 }, false, "k", SECRET, undefined, undefined, now);

    expect(store.orders.find((o) => o.id === "OLD-1")?.status).toBe("Cancelled");
    expect(store.products.get("p1")!.stock).toBe(2);
  });
});

describe("reclaimStaleOrders", () => {
  it("cancels awaiting-payment orders older than 2 hours and restores their stock", async () => {
    const now = new Date("2026-08-01T12:00:00Z");
    store.orders = [
      makeOrderRow({ id: "OLD", status: "Awaiting Payment", created_at: new Date(now.getTime() - 3 * 3600 * 1000).toISOString() }),
      makeOrderRow({ id: "FRESH", status: "Awaiting Payment", created_at: new Date(now.getTime() - 30 * 60 * 1000).toISOString() }),
    ];
    store.items = [{ order_id: "OLD", product_id: "p1", product_name: "Tote", price: 50, quantity: 3 }];
    store.products.set("p1", { name: "Tote", price: 50, stock: 1 });

    await reclaimStaleOrders(store, now);

    expect(store.orders.find((o) => o.id === "OLD")?.status).toBe("Cancelled");
    expect(store.orders.find((o) => o.id === "FRESH")?.status).toBe("Awaiting Payment");
    expect(store.products.get("p1")!.stock).toBe(4);
  });

  it("does not touch orders that are not Awaiting Payment", async () => {
    const now = new Date("2026-08-01T12:00:00Z");
    store.orders = [makeOrderRow({ id: "PAID", status: "Paid", created_at: new Date(now.getTime() - 5 * 3600 * 1000).toISOString() })];
    await reclaimStaleOrders(store, now);
    expect(store.orders[0]!.status).toBe("Paid");
  });
});

describe("updateOrder", () => {
  it("requires an id", async () => {
    expect((await updateOrder(store, "", { status: "Paid" })).ok).toBe(false);
  });

  it("updates only the provided fields", async () => {
    await createOrder(store, { id: "ORD-1", total: 50 }, true, "k", SECRET);
    await updateOrder(store, "ORD-1", { status: "Paid", tracking_number: "123" });
    const order = store.orders.find((o) => o.id === "ORD-1")!;
    expect(order.status).toBe("Paid");
    expect(order.tracking_number).toBe("123");
  });
});

describe("deleteOrder / deleteAllOrders", () => {
  it("deleteOrder requires an id", async () => {
    expect((await deleteOrder(store, "")).ok).toBe(false);
  });

  it("deleteOrder removes the order and cascades its items", async () => {
    await createOrder(store, { id: "ORD-1", total: 50, shipping: 12 }, true, "k", SECRET);
    expect(store.orders).toHaveLength(1);
    await deleteOrder(store, "ORD-1");
    expect(store.orders).toEqual([]);
    expect(store.items).toEqual([]);
  });

  it("deleteAllOrders clears every order and item", async () => {
    await createOrder(store, { id: "ORD-1", total: 50 }, true, "k", SECRET);
    await createOrder(store, { id: "ORD-2", total: 30 }, true, "k", SECRET);
    await deleteAllOrders(store);
    expect(store.orders).toEqual([]);
    expect(store.items).toEqual([]);
  });
});
