import { describe, it, expect } from "vitest";
import {
  CouponsStoreFake,
  createCoupon,
  listCoupons,
  validateCoupon,
  redeemCoupon,
  myCouponRedemptions,
  editCoupon,
  deleteCoupon,
  listCouponCodes,
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
  it("generates one distinct code per unit of quantity", async () => {
    const store = new CouponsStoreFake();
    const result = await createCoupon(store, { name: "Fall Sale", amount: 10, quantity: 5 });
    expect(result.ok).toBe(true);
    expect(result.data!.codes.length).toBe(5);
    expect(new Set(result.data!.codes).size).toBe(5); // all distinct
    expect(store.codes.length).toBe(5);
    expect(store.codes.every((c) => c.batch_id === result.data!.id)).toBe(true);
  });

  it("requires a name", async () => {
    const store = new CouponsStoreFake();
    const result = await createCoupon(store, { name: "  ", amount: 10, quantity: 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects a percent amount over 100", async () => {
    const store = new CouponsStoreFake();
    const result = await createCoupon(store, { name: "Too Big", amount: 150, quantity: 1 });
    expect(result.ok).toBe(false);
  });

  it("rejects a quantity over 500", async () => {
    const store = new CouponsStoreFake();
    const result = await createCoupon(store, { name: "Too Many", amount: 10, quantity: 501 });
    expect(result.ok).toBe(false);
  });
});

describe("listCoupons", () => {
  it("reports created (quantity) and used (redeemed code count) directly", async () => {
    const store = new CouponsStoreFake();
    const batch = await createCoupon(store, { name: "Spring", amount: 10, quantity: 3 });
    await store.redeemCodeIfAvailable(batch.data!.codes[0]!, "ORD-1", "a@b.com", 4);

    const result = await listCoupons(store);
    const c = result.data!.coupons[0]!;
    expect(c.created).toBe(3);
    expect(c.used).toBe(1);
  });
});

describe("validateCoupon", () => {
  it("previews a percent discount without mutating anything", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { name: "Preview", amount: 100, quantity: 1 });
    const code = created.data!.codes[0]!;

    const preview = await validateCoupon(store, code, 6);
    expect(preview.data!.discount).toBe(6);
    expect((await store.getCodeForValidation(code))!.redeemed_at).toBeNull();
  });

  it("rejects an expired coupon", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { name: "Old", amount: 10, quantity: 1, expires_at: "2020-01-01" });
    const result = await validateCoupon(store, created.data!.codes[0]!, 20);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown code", async () => {
    const store = new CouponsStoreFake();
    const result = await validateCoupon(store, "NOPE12345", 20);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });
});

describe("each code is single-use", () => {
  it("gives each generated code its own full percent off its own order", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { name: "Share50", amount: 50, quantity: 5 });
    const [codeA, codeB] = created.data!.codes;

    const ordersStore = new OrdersStoreFake();
    ordersStore.products.set("p1", { name: "Tote", price: 20, stock: 5 });
    const first = await createOrder(
      ordersStore,
      { id: "ORD-1", total: 10, items: [{ id: "p1", q: 1 }], coupon_code: codeA, email: "a@b.com" },
      false,
      "k",
      SECRET,
      couponsAdapter(store)
    );
    expect(first.ok).toBe(true);

    ordersStore.products.set("p2", { name: "Bag", price: 20, stock: 5 });
    const second = await createOrder(
      ordersStore,
      { id: "ORD-2", total: 10, items: [{ id: "p2", q: 1 }], coupon_code: codeB, email: "c@d.com" },
      false,
      "k",
      SECRET,
      couponsAdapter(store)
    );
    expect(second.ok).toBe(true);

    // Both orders got the full 50% off their own $20 subtotal — independent codes, no shared pool.
    const items1 = ordersStore.items.filter((i) => i.order_id === "ORD-1");
    const items2 = ordersStore.items.filter((i) => i.order_id === "ORD-2");
    expect(Math.abs(Number(items1.find((i) => i.product_id === "_coupon")!.price))).toBe(10);
    expect(Math.abs(Number(items2.find((i) => i.product_id === "_coupon")!.price))).toBe(10);

    const remaining = created.data!.codes.filter((c) => c !== codeA && c !== codeB);
    expect(remaining.length).toBe(3); // untouched, still usable
  });

  it("rejects reusing an already-redeemed code", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { name: "OneShot", amount: 100, quantity: 1 });
    const code = created.data!.codes[0]!;

    await store.redeemCodeIfAvailable(code, "ORD-1", "a@b.com", 10);

    const preview = await validateCoupon(store, code, 50);
    expect(preview.ok).toBe(false);
    expect(preview.error).toMatch(/already been used/);
  });
});

describe("coupon discount reduces subtotal before tax/shipping/fee", () => {
  it("applies the discount as a synthetic negative line item excluded from displayItems", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { name: "ThirtyOff", amount: 30, quantity: 1 }); // 30% of 50 = 15
    const code = created.data!.codes[0]!;

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

describe("editCoupon", () => {
  it("updates amount and expiration", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { name: "EditMe", amount: 10, quantity: 5 });
    const id = created.data!.id;

    const result = await editCoupon(store, id, { amount: 20, expires_at: "2027-01-01" });
    expect(result.ok).toBe(true);

    const updated = await store.getBatch(id);
    expect(updated!.amount).toBe(20);
    expect(updated!.expires_at).toBe("2027-01-01");
    expect(updated!.quantity).toBe(5); // unchanged — quantity is fixed at creation
  });

  it("rejects an amount over 100", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { name: "Bad", amount: 10, quantity: 5 });
    const result = await editCoupon(store, created.data!.id, { amount: 150 });
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown id", async () => {
    const store = new CouponsStoreFake();
    const result = await editCoupon(store, 999, { amount: 10 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });
});

describe("deleteCoupon", () => {
  it("deletes a batch with no codes used", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { name: "DeleteMe", amount: 10, quantity: 5 });
    const id = created.data!.id;

    const result = await deleteCoupon(store, id);
    expect(result.ok).toBe(true);
    expect(await store.getBatch(id)).toBeNull();
  });

  it("refuses to delete a batch that's had a code redeemed", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { name: "Used", amount: 10, quantity: 5 });
    const id = created.data!.id;
    await store.redeemCodeIfAvailable(created.data!.codes[0]!, "ORD-1", "a@b.com", 5);

    const result = await deleteCoupon(store, id);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already been used/);
    expect(await store.getBatch(id)).not.toBeNull(); // untouched
  });

  it("rejects an unknown id", async () => {
    const store = new CouponsStoreFake();
    const result = await deleteCoupon(store, 999);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });
});

describe("listCouponCodes", () => {
  it("lists every code — used (with sale info) and unused", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { name: "TrackMe", amount: 20, quantity: 3 });
    const id = created.data!.id;
    const [codeA] = created.data!.codes;

    const ordersStore = new OrdersStoreFake();
    ordersStore.products.set("p1", { name: "Tote", price: 50, stock: 5 });
    await createOrder(ordersStore, { id: "ORD-1", total: 40, items: [{ id: "p1", q: 1 }], coupon_code: codeA, email: "a@b.com" }, false, "k", SECRET, couponsAdapter(store));

    const result = await listCouponCodes(store, id);
    expect(result.ok).toBe(true);
    expect(result.data!.codes.length).toBe(3);
    const used = result.data!.codes.filter((c) => c.used);
    const unused = result.data!.codes.filter((c) => !c.used);
    expect(used.length).toBe(1);
    expect(unused.length).toBe(2);
    expect(used[0]!.order_id).toBe("ORD-1");
    expect(used[0]!.email).toBe("a@b.com");
    expect(used[0]!.discount).toBe(10); // 20% of 50
  });

  it("rejects an unknown batch id", async () => {
    const store = new CouponsStoreFake();
    const result = await listCouponCodes(store, 999);
    expect(result.ok).toBe(false);
  });
});

describe("myCouponRedemptions", () => {
  it("lists a customer's own redeemed codes", async () => {
    const store = new CouponsStoreFake();
    const created = await createCoupon(store, { name: "Mine", amount: 10, quantity: 2 });
    await store.redeemCodeIfAvailable(created.data!.codes[0]!, "ORD-1", "a@b.com", 5);

    const result = await myCouponRedemptions(store, "a@b.com");
    expect(result.data!.redemptions.length).toBe(1);
    expect(result.data!.redemptions[0]!.order_id).toBe("ORD-1");
  });
});
