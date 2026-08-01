import { describe, it, expect, beforeEach } from "vitest";
import { exportProductsCsv, importProductsCsv } from "./products-csv";
import { ProductsStoreFake, makeProductRow } from "./products";
import { parseCsv } from "./lib/csv";

let store: ProductsStoreFake;

beforeEach(() => {
  store = new ProductsStoreFake();
});

describe("exportProductsCsv", () => {
  it("exports the header row plus one row per product, sorted by category then name", async () => {
    store.rows = [
      makeProductRow({ id: "p2", name: "Zebra Bag", category: "Totes", price: 20, stock: 3 }),
      makeProductRow({ id: "p1", name: "Apple Bag", category: "Totes", price: 10, stock: 5 }),
    ];
    const csv = await exportProductsCsv(store);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(["id", "sku", "name", "description", "price", "cogm", "launch_date", "stock", "category", "badge", "weight", "size", "sell", "img1", "img2", "img3", "ship_mode", "ship_fixed", "coming_soon"]);
    expect(rows[1]![2]).toBe("Apple Bag"); // alphabetized within the same category
    expect(rows[2]![2]).toBe("Zebra Bag");
  });

  it("neutralizes formula-injection-risky leading characters", async () => {
    store.rows = [makeProductRow({ id: "p1", name: "=SUM(A1:A9)", category: "Bags" })];
    const csv = await exportProductsCsv(store);
    const rows = parseCsv(csv);
    expect(rows[1]![2]).toBe("'=SUM(A1:A9)");
  });

  it("does not prefix a cell that merely contains one of the risky characters mid-string", async () => {
    store.rows = [makeProductRow({ id: "p1", name: "Bag @ Home", category: "Bags" })];
    const csv = await exportProductsCsv(store);
    const rows = parseCsv(csv);
    expect(rows[1]![2]).toBe("Bag @ Home");
  });
});

describe("importProductsCsv", () => {
  it("rejects a CSV missing a required column", async () => {
    const result = await importProductsCsv(store, "id,name,price,stock\n1,Bag,10,5\n", "merge");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing required column: category/);
  });

  it("rejects an empty CSV", async () => {
    const result = await importProductsCsv(store, "", "merge");
    expect(result.ok).toBe(false);
  });

  it("rejects a CSV with a header row but no data rows", async () => {
    const result = await importProductsCsv(store, "id,name,price,stock,category\n", "merge");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No data rows/);
  });

  it("imports a well-formed row with all optional fields defaulted", async () => {
    const csv = "id,name,price,stock,category\np1,Tote Bag,25.5,3,Totes\n";
    const result = await importProductsCsv(store, csv, "merge");
    expect(result.ok).toBe(true);
    expect(result.imported).toBe(1);
    const row = store.rows[0]!;
    expect(row.price).toBe(25.5);
    expect(row.cogm).toBe(12.75); // defaulted to half the price
    expect(row.launch_date).toBe("2026-07-01");
    expect(row.sell).toBe(true); // "sell" column entirely absent -> defaults true
    expect(row.ship_mode).toBe("weight");
  });

  it("treats a present-but-blank 'sell' cell as 0/false, unlike an absent column", async () => {
    const csv = "id,name,price,stock,category,sell\np1,Tote Bag,25,3,Totes,\n";
    await importProductsCsv(store, csv, "merge");
    expect(store.rows[0]!.sell).toBe(false);
  });

  it("treats a literal '0' cogm as empty (falls back to the price-based default), matching PHP's !empty()", async () => {
    const csv = "id,name,price,stock,category,cogm\np1,Tote Bag,20,3,Totes,0\n";
    await importProductsCsv(store, csv, "merge");
    expect(store.rows[0]!.cogm).toBe(10);
  });

  it("honors an explicit non-zero cogm", async () => {
    const csv = "id,name,price,stock,category,cogm\np1,Tote Bag,20,3,Totes,7.5\n";
    await importProductsCsv(store, csv, "merge");
    expect(store.rows[0]!.cogm).toBe(7.5);
  });

  it("merge mode upserts without touching unrelated existing products", async () => {
    store.rows = [makeProductRow({ id: "existing", name: "Existing Bag", category: "Bags" })];
    const csv = "id,name,price,stock,category\nnew1,New Bag,15,2,Bags\n";
    await importProductsCsv(store, csv, "merge");
    expect(store.rows.map((r) => r.id).sort()).toEqual(["existing", "new1"]);
  });

  it("replace mode deletes every existing product before importing", async () => {
    store.rows = [makeProductRow({ id: "old", name: "Old Bag", category: "Bags" })];
    const csv = "id,name,price,stock,category\nnew1,New Bag,15,2,Bags\n";
    await importProductsCsv(store, csv, "replace");
    expect(store.rows.map((r) => r.id)).toEqual(["new1"]);
  });

  it("skips a malformed row whose cell count doesn't match the header", async () => {
    const csv = "id,name,price,stock,category\np1,Good Bag,10,1,Bags\np2,Bad Row,10\n";
    const result = await importProductsCsv(store, csv, "merge");
    expect(result.imported).toBe(1);
    expect(store.rows.map((r) => r.id)).toEqual(["p1"]);
  });

  it("parses a CSV with a comma embedded in a quoted description", async () => {
    const csv = 'id,name,price,stock,category,description\np1,Tote Bag,10,1,Bags,"Roomy, sturdy, and cute"\n';
    await importProductsCsv(store, csv, "merge");
    expect(store.rows[0]!.description).toBe("Roomy, sturdy, and cute");
  });
});
