import { describe, it, expect, beforeEach } from "vitest";
import {
  listCities,
  saveCity,
  deleteCity,
  getPendingSweep,
  getSweepHistory,
  createSweep,
  editSweep,
  removeSweep,
  TaxStoreFake,
} from "./tax";

let store: TaxStoreFake;

beforeEach(() => {
  store = new TaxStoreFake();
});

describe("tn_city_tax", () => {
  it("lists no cities when empty", async () => {
    expect((await listCities(store)).data?.cities).toEqual([]);
  });

  it("saveCity requires city, county, and tax_rate", async () => {
    expect((await saveCity(store, "", "Knox", 0.09)).ok).toBe(false);
    expect((await saveCity(store, "Knoxville", "", 0.09)).ok).toBe(false);
    expect((await saveCity(store, "Knoxville", "Knox", null)).ok).toBe(false);
  });

  it("saves and lists a city", async () => {
    const result = await saveCity(store, "Nashville", "Davidson", 0.0975);
    expect(result.ok).toBe(true);
    const cities = (await listCities(store)).data?.cities ?? [];
    expect(cities).toEqual([{ id: 1, city: "Nashville", county: "Davidson", tax_rate: 0.0975 }]);
  });

  it("upserts on the (city, county) pair, updating the rate rather than duplicating", async () => {
    await saveCity(store, "Nashville", "Davidson", 0.0975);
    await saveCity(store, "Nashville", "Davidson", 0.1);
    const cities = (await listCities(store)).data?.cities ?? [];
    expect(cities).toHaveLength(1);
    expect(cities[0]!.tax_rate).toBe(0.1);
  });

  it("treats the same city name in a different county as a distinct row, matching MySQL's UNIQUE KEY city_county", async () => {
    await saveCity(store, "Springfield", "Robertson", 0.0925);
    await saveCity(store, "Springfield", "Bradley", 0.095);
    const cities = (await listCities(store)).data?.cities ?? [];
    expect(cities).toHaveLength(2);
  });

  it("filters by search term (city or county)", async () => {
    await saveCity(store, "Nashville", "Davidson", 0.0975);
    await saveCity(store, "Knoxville", "Knox", 0.0925);
    expect((await listCities(store, "nash")).data?.cities).toHaveLength(1);
    expect((await listCities(store, "knox")).data?.cities).toHaveLength(1);
    expect((await listCities(store, "")).data?.cities).toHaveLength(2);
  });

  it("deleteCity requires an id and removes the row", async () => {
    await saveCity(store, "Nashville", "Davidson", 0.0975);
    const id = (await listCities(store)).data!.cities[0]!.id;
    expect((await deleteCity(store, 0)).ok).toBe(false);
    expect((await deleteCity(store, id)).ok).toBe(true);
    expect((await listCities(store)).data?.cities).toEqual([]);
  });
});

describe("getPendingSweep", () => {
  it("reports no pending orders when none are unswept", async () => {
    const result = await getPendingSweep(store);
    expect(result.pending).toBe(false);
    if (!result.pending) expect(result.message).toMatch(/No unswept/);
  });

  it("summarizes pending orders: count, total, date range, order ids/details", async () => {
    store.pendingOrders = [
      { id: "ORD-A", order_date: "2026-07-01", tax_amount: 4.5 },
      { id: "ORD-B", order_date: "2026-07-05", tax_amount: 2.25 },
    ];
    const result = await getPendingSweep(store);
    expect(result.pending).toBe(true);
    if (result.pending) {
      expect(result.count).toBe(2);
      expect(result.total_tax).toBe(6.75);
      expect(result.date_from).toBe("2026-07-01");
      expect(result.date_to).toBe("2026-07-05");
      expect(result.order_ids).toEqual(["ORD-A", "ORD-B"]);
      expect(result.order_details).toEqual([
        { id: "ORD-A", date: "2026-07-01", tax: 4.5 },
        { id: "ORD-B", date: "2026-07-05", tax: 2.25 },
      ]);
    }
  });

  it("rounds total_tax to 2 decimal places", async () => {
    store.pendingOrders = [
      { id: "ORD-A", order_date: "2026-07-01", tax_amount: 1.005 },
      { id: "ORD-B", order_date: "2026-07-01", tax_amount: 1.005 },
    ];
    const result = await getPendingSweep(store);
    if (result.pending) expect(result.total_tax).toBe(2.01);
  });
});

describe("createSweep / getSweepHistory", () => {
  it("requires order_ids", async () => {
    const result = await createSweep(store, { order_ids: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing order_ids/);
  });

  it("records a sweep, stamps swept orders, and removes them from pending", async () => {
    store.pendingOrders = [
      { id: "ORD-A", order_date: "2026-07-01", tax_amount: 4.5 },
      { id: "ORD-B", order_date: "2026-07-05", tax_amount: 2.25 },
    ];
    const now = new Date("2026-07-10T12:00:00Z");
    const result = await createSweep(
      store,
      { order_ids: ["ORD-A", "ORD-B"], total_tax: 6.75, date_from: "2026-07-01", date_to: "2026-07-05" },
      now
    );
    expect(result.ok).toBe(true);
    expect(result.data?.sweep_date).toBe("2026-07-10");
    expect(result.data?.updated).toBe(2);
    expect(store.pendingOrders).toEqual([]);

    const history = (await getSweepHistory(store)).data?.sweeps ?? [];
    expect(history).toHaveLength(1);
    expect(history[0]!.order_ids).toBe(JSON.stringify(["ORD-A", "ORD-B"]));
    expect(history[0]!.total_tax).toBe(6.75);
  });

  it("stores order_ids as JSON, not comma-separated, matching the live PHP's json_encode()", async () => {
    await createSweep(store, { order_ids: ["ORD-A", "ORD-B"] });
    const history = (await getSweepHistory(store)).data?.sweeps ?? [];
    expect(history[0]!.order_ids).not.toContain("ORD-A,ORD-B");
    expect(JSON.parse(history[0]!.order_ids!)).toEqual(["ORD-A", "ORD-B"]);
  });

  it("defaults count from order_ids.length and total_tax to 0 when omitted", async () => {
    await createSweep(store, { order_ids: ["ORD-A", "ORD-B", "ORD-C"] });
    const history = (await getSweepHistory(store)).data?.sweeps ?? [];
    expect(history[0]!.order_count).toBe(3);
    expect(history[0]!.total_tax).toBe(0);
  });
});

describe("editSweep / removeSweep", () => {
  it("editSweep requires an id and at least one field", async () => {
    await createSweep(store, { order_ids: ["ORD-A"] });
    const id = (await getSweepHistory(store)).data!.sweeps[0]!.id;
    expect((await editSweep(store, 0, { total_tax: 5 })).ok).toBe(false);
    expect((await editSweep(store, id, {})).ok).toBe(false);
  });

  it("editSweep updates only the provided fields", async () => {
    await createSweep(store, { order_ids: ["ORD-A"], total_tax: 5 });
    const id = (await getSweepHistory(store)).data!.sweeps[0]!.id;
    await editSweep(store, id, { total_tax: 9.5 });
    const history = (await getSweepHistory(store)).data?.sweeps ?? [];
    expect(history[0]!.total_tax).toBe(9.5);
  });

  it("removeSweep requires an id and deletes the row", async () => {
    await createSweep(store, { order_ids: ["ORD-A"] });
    const id = (await getSweepHistory(store)).data!.sweeps[0]!.id;
    expect((await removeSweep(store, 0)).ok).toBe(false);
    expect((await removeSweep(store, id)).ok).toBe(true);
    expect((await getSweepHistory(store)).data?.sweeps).toEqual([]);
  });
});
