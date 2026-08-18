import { describe, it, expect } from "vitest";
import {
  CouponsStoreFake,
  createCoupon,
  listCoupons,
  validateCoupon,
  redeemCoupon,
  myCouponRedemptions,
} from "./coupons";
import { OrdersStoreFake, createOrder, mapOrderForResponse } from "./orders";
import { computeOrderAmounts } from "./payments";

const SECRET = "test-secret";

function couponsAdapter(store: CouponsStoreFake) {
  return {
    validateCoupon: (code: string, subtotal: number, email?: string) => validateCoupon(store, code, subtotal, email),
    redeemCoupon: (code: string, requested: number, orderId: string, email: string | null) => redeemCoupon(store, code, requested, orderId, email),
  };
}

describe("createCoupon", () => {
  it("auto-generates a code when none is supplied", async () => {
    const store = new CouponsStoreFake();
    const result = await createCoupon(store, { coupon_type: "percent", amount: 10, quantity: 5 });
    expect(result.ok).toBe(true);
    expect(result.data!.code.length).toBeGreaterThan(0);
    expect(store.coupons[0]!.amount).toBe(10);
    expect(store.coupons[0]!.quantity).toBe(5);
  });

  it("accepts a custom code and rejects a duplicate", async () => {
    const store = new CouponsStoreFake();
    const first = await createCoupon(store, { code: "SAVE10", coupon_type: "percent", amount: 10, quantity: 5 });
    expect(first.ok).toBe(true);
    expect(first.data!.code).toBe("SAVE10");

    const dup = await createCoupon(store, { code: "save10", coupon_type: "percent", amount: 5, quantity: 1 });
    expect(dup.ok).toBe(false);
  });

  it("rejects a percent amount over 100", async () => {
    const store = new CouponsStoreFake();
    const result = await createCoupon(store, { coupon_type: "percent", amount: 150, quantity: 1 });
    expect(result.ok).toBe(false);
  });
});

describe("listCoupons", () => {
  it("reports created (quantity) and used (used_count) directly", async () => {
    const store = new CouponsStoreFake();
    const batch = await createCoupon(store, { coupon_type: "percent", amount: 10, quantity: 3 });
    await store.redeemIfAvailable(batch.data!.code, 4);

    const result = await listCoupons(store);
    const c = result.data!.coupons[0]!;
    expect(c.created).toBe(3);
    expect(c.used).toBe(1);
  });
});

describe("validateCoupon", () => {
  it("previews a percent discount, capped at subtotal by construction (100% off), without mutating anything", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { coupon_type: "percent", amount: 100, quantity: 1 });
    const code = created.data!.code;

    const preview = await validateCoupon(store, code, 6);
    expect(preview.data!.discount).toBe(6);
    expect((await store.getCoupon(code))!.used_count).toBe(0); // unchanged
  });

  it("rejects an expired coupon", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { coupon_type: "percent", amount: 10, quantity: 1, expires_at: "2020-01-01" });
    const result = await validateCoupon(store, created.data!.code, 20);
    expect(result.ok).toBe(false);
  });
});

describe("percent coupon: fresh cap per use, no shared pool", () => {
  it("gives each of the quantity uses its own full 50% off its own order, by different customers", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { code: "SHARE50", coupon_type: "percent", amount: 50, quantity: 5 });
    const code = created.data!.code;

    const ordersStore = new OrdersStoreFake();
    ordersStore.products.set("p1", { name: "Tote", price: 20, stock: 5 });
    const first = await createOrder(
      ordersStore,
      { id: "ORD-1", total: 10, items: [{ id: "p1", q: 1 }], coupon_code: code, email: "a@b.com" },
      false,
      "k",
      SECRET,
      couponsAdapter(store)
    );
    expect(first.ok).toBe(true);
    expect((await store.getCoupon(code))!.used_count).toBe(1);

    ordersStore.products.set("p2", { name: "Bag", price: 20, stock: 5 });
    const second = await createOrder(
      ordersStore,
      { id: "ORD-2", total: 10, items: [{ id: "p2", q: 1 }], coupon_code: code, email: "c@d.com" },
      false,
      "k",
      SECRET,
      couponsAdapter(store)
    );
    expect(second.ok).toBe(true);
    expect((await store.getCoupon(code))!.used_count).toBe(2);

    // Both orders got the full 50% off their own $20 subtotal — not split from a shared pool.
    const items1 = ordersStore.items.filter((i) => i.order_id === "ORD-1");
    const items2 = ordersStore.items.filter((i) => i.order_id === "ORD-2");
    expect(Math.abs(Number(items1.find((i) => i.product_id === "_coupon")!.price))).toBe(10);
    expect(Math.abs(Number(items2.find((i) => i.product_id === "_coupon")!.price))).toBe(10);

    const redemptionsA = await myCouponRedemptions(store, "a@b.com");
    expect(redemptionsA.data!.redemptions.length).toBe(1);
  });

  it("stops once quantity is exhausted", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { coupon_type: "percent", amount: 100, quantity: 1 });
    const code = created.data!.code;

    await store.redeemIfAvailable(code, 2);
    expect((await store.getCoupon(code))!.used_count).toBe(1);

    const preview = await validateCoupon(store, code, 50);
    expect(preview.ok).toBe(false); // quantity exhausted
  });
});

describe("percent coupon: capped only by quantity, no dollar pool", () => {
  it("allows quantity independent uses, each at the full percent", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { coupon_type: "percent", amount: 20, quantity: 2 });
    const code = created.data!.code;

    const ordersStore = new OrdersStoreFake();
    ordersStore.products.set("p1", { name: "Tote", price: 50, stock: 5 });
    await createOrder(ordersStore, { id: "ORD-1", total: 40, items: [{ id: "p1", q: 1 }], coupon_code: code }, false, "k", SECRET, couponsAdapter(store));
    expect((await store.getCoupon(code))!.used_count).toBe(1);

    const preview = await validateCoupon(store, code, 50);
    expect(preview.ok).toBe(true); // second of 2 allowed uses
    expect(preview.data!.discount).toBe(10); // 20% of 50

    await store.redeemIfAvailable(code, 10);
    const exhausted = await validateCoupon(store, code, 50);
    expect(exhausted.ok).toBe(false); // quantity now fully used
  });
});

describe("coupon discount reduces subtotal before tax/shipping/fee", () => {
  it("applies the discount as a synthetic negative line item excluded from displayItems", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { coupon_type: "percent", amount: 30, quantity: 1 }); // 30% of 50 = 15
    const code = created.data!.code;

    const ordersStore = new OrdersStoreFake();
    ordersStore.products.set("p1", { name: "Tote", price: 50, stock: 5 });
    await createOrder(
      ordersStore,
      { id: "ORD-1", total: 35, shipping: 5, items: [{ id: "p1", q: 1 }], coupon_code: code },
      false,
      "k",
      SECRET,
      couponsAdapter(store)
    );

    const amounts = computeOrderAmounts(ordersStore.items);
    expect(amounts.subtotal).toBe(35); // 50 - 15 coupon, before shipping/tax
    expect(amounts.shipping).toBe(5);

    const dto = mapOrderForResponse(ordersStore.orders[0]!, ordersStore.items);
    expect(dto.coupon_code).toBe(code);
    expect(dto.coupon_discount).toBe(15);
    expect(dto.subtotal).toBe(50); // raw product subtotal (mirrors how `shipping` is split out too)
    expect(dto.items.find((i) => i.id === "_coupon")).toBeUndefined();
  });
});

describe("one redemption per customer per code", () => {
  it("rejects a second use by the same email, even with uses remaining", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { coupon_type: "percent", amount: 100, quantity: 5 });
    const code = created.data!.code;

    const ordersStore = new OrdersStoreFake();
    ordersStore.products.set("p1", { name: "Tote", price: 10, stock: 5 });
    const first = await createOrder(
      ordersStore,
      { id: "ORD-1", total: 1, items: [{ id: "p1", q: 1 }], coupon_code: code, email: "a@b.com" },
      false,
      "k",
      SECRET,
      couponsAdapter(store)
    );
    expect(first.ok).toBe(true);

    const preview = await validateCoupon(store, code, 10, "a@b.com");
    expect(preview.ok).toBe(false);
    expect(preview.error).toMatch(/already used/);

    // A different customer can still use it.
    const otherPreview = await validateCoupon(store, code, 10, "c@d.com");
    expect(otherPreview.ok).toBe(true);
  });
});
