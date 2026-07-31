import { describe, it, expect, beforeEach } from "vitest";
import { listProducts, mapProductForResponse, ProductsStoreFake, makeProductRow } from "./products";

let store: ProductsStoreFake;

beforeEach(() => {
  store = new ProductsStoreFake();
});

describe("mapProductForResponse", () => {
  it("maps a full row to the DTO shape js/store.js consumes", () => {
    const row = makeProductRow({
      id: "p1",
      name: "Mug",
      description: "A mug",
      price: 12.5,
      stock: 3,
      category: "kitchen",
      badge: "new",
      weight: 1.2,
      size: "medium",
      sell: true,
      img1: "/product_images/a.jpg",
      img2: "/product_images/b.jpg",
      img3: "",
      sku: "MUG-1",
      ship_mode: "fixed",
      ship_fixed: 5,
      coming_soon: false,
      cogm: 4.5,
      launch_date: "2026-01-01",
    });

    const dto = mapProductForResponse(row, true);
    expect(dto).toEqual({
      id: "p1",
      name: "Mug",
      desc: "A mug",
      price: 12.5,
      stock: 3,
      cat: "kitchen",
      badge: "new",
      weight: 1.2,
      size: "medium",
      sell: 1,
      imgs: ["/product_images/a.jpg", "/product_images/b.jpg", ""],
      hasImg: true,
      sku: "MUG-1",
      ship_mode: "fixed",
      ship_fixed: 5,
      coming_soon: 0,
      cogm: 4.5,
      launch_date: "2026-01-01",
    });
  });

  it("coerces boolean sell/coming_soon to 1/0, not true/false", () => {
    const row = makeProductRow({ id: "p1", name: "Mug", sell: false, coming_soon: true });
    const dto = mapProductForResponse(row, false);
    expect(dto.sell).toBe(0);
    expect(dto.coming_soon).toBe(1);
    expect(dto.sell).not.toBe(false);
  });

  it("hides cogm from non-admin requests", () => {
    const row = makeProductRow({ id: "p1", name: "Mug", cogm: 4.5 });
    expect(mapProductForResponse(row, false).cogm).toBeNull();
    expect(mapProductForResponse(row, true).cogm).toBe(4.5);
  });

  it("hasImg is false when img1 is empty", () => {
    const row = makeProductRow({ id: "p1", name: "Mug", img1: "" });
    expect(mapProductForResponse(row, false).hasImg).toBe(false);
  });

  it("defaults nullable fields the way the PHP mapping did", () => {
    const row = makeProductRow({
      id: "p1",
      name: "Mug",
      description: null,
      category: null,
      badge: null,
      weight: null,
      size: null,
      sku: null,
      ship_mode: null,
      ship_fixed: null,
      launch_date: null,
      img1: null,
      img2: null,
      img3: null,
    });
    const dto = mapProductForResponse(row, false);
    expect(dto.desc).toBe("");
    expect(dto.cat).toBe("");
    expect(dto.badge).toBe("");
    expect(dto.weight).toBe(0);
    expect(dto.size).toBe("");
    expect(dto.sku).toBe("");
    expect(dto.ship_mode).toBe("weight");
    expect(dto.ship_fixed).toBe(0);
    expect(dto.launch_date).toBe("2026-07-01");
    expect(dto.imgs).toEqual(["", "", ""]);
  });
});

describe("listProducts", () => {
  it("returns an empty list when there are no products", async () => {
    expect(await listProducts(store, false)).toEqual([]);
  });

  it("maps every row and preserves store order", async () => {
    store.rows = [
      makeProductRow({ id: "p1", name: "First" }),
      makeProductRow({ id: "p2", name: "Second" }),
    ];
    const result = await listProducts(store, false);
    expect(result.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("applies the admin cogm gate to every row", async () => {
    store.rows = [makeProductRow({ id: "p1", name: "First", cogm: 9 })];
    expect((await listProducts(store, false))[0]!.cogm).toBeNull();
    expect((await listProducts(store, true))[0]!.cogm).toBe(9);
  });
});
