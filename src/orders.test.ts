import { describe, it, expect, beforeEach } from "vitest";
import { listOrders, mapOrderForResponse, OrdersStoreFake, makeOrderRow } from "./orders";

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
