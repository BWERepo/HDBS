import { describe, it, expect, beforeEach } from "vitest";
import { DonationsStoreFake, createDonation, listDonations, deleteDonation } from "./donations";

let store: DonationsStoreFake;

beforeEach(() => {
  store = new DonationsStoreFake();
  store.productIds.add("p1");
  store.productIds.add("p2");
});

describe("createDonation", () => {
  it("logs a donation for a real product", async () => {
    const result = await createDonation(store, { product_id: "p1", date: "2026-08-19", recipient: "Local Shelter" });
    expect(result.ok).toBe(true);
    expect(store.donations).toHaveLength(1);
    expect(store.donations[0]).toMatchObject({ product_id: "p1", donation_date: "2026-08-19", recipient: "Local Shelter" });
  });

  it("rejects a missing product, date, or recipient", async () => {
    expect((await createDonation(store, { date: "2026-08-19", recipient: "X" })).error).toMatch(/product/);
    expect((await createDonation(store, { product_id: "p1", recipient: "X" })).error).toMatch(/date/);
    expect((await createDonation(store, { product_id: "p1", date: "2026-08-19" })).error).toMatch(/donated to/);
  });

  it("rejects a product id that doesn't exist", async () => {
    const result = await createDonation(store, { product_id: "nope", date: "2026-08-19", recipient: "X" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Product not found");
  });

  it("allows multiple donation records for the same product", async () => {
    await createDonation(store, { product_id: "p1", date: "2026-08-01", recipient: "A" });
    await createDonation(store, { product_id: "p1", date: "2026-08-15", recipient: "B" });
    expect(store.donations).toHaveLength(2);
  });
});

describe("listDonations", () => {
  it("lists donations newest-first by date", async () => {
    await createDonation(store, { product_id: "p1", date: "2026-08-01", recipient: "A" });
    await createDonation(store, { product_id: "p2", date: "2026-08-15", recipient: "B" });
    const result = await listDonations(store);
    expect(result.data!.donations.map((d) => d.recipient)).toEqual(["B", "A"]);
  });

  it("is empty when nothing's been donated", async () => {
    const result = await listDonations(store);
    expect(result.data!.donations).toEqual([]);
  });
});

describe("deleteDonation", () => {
  it("removes a donation record", async () => {
    const created = await createDonation(store, { product_id: "p1", date: "2026-08-19", recipient: "A" });
    const result = await deleteDonation(store, created.data!.id);
    expect(result.ok).toBe(true);
    expect(store.donations).toHaveLength(0);
  });

  it("rejects a missing id", async () => {
    const result = await deleteDonation(store, 0);
    expect(result.ok).toBe(false);
  });
});
