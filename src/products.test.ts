import { describe, it, expect, beforeEach } from "vitest";
import { listProducts, mapProductForResponse, saveProduct, deleteProduct, ProductsStoreFake, makeProductRow } from "./products";

function makeDataUrl(mime: string, bytes: number[]): string {
  const binary = String.fromCharCode(...bytes);
  return `data:${mime};base64,${btoa(binary)}`;
}
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const BOGUS_BYTES = [0x00, 0x01, 0x02, 0x03];

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
      donated: 0,
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

describe("saveProduct", () => {
  it("rejects a missing id or name", async () => {
    expect((await saveProduct(store, { name: "No id" })).error).toBe("Missing id or name");
    expect((await saveProduct(store, { id: "p1" })).error).toBe("Missing id or name");
  });

  it("rejects an id outside the safe charset (no path traversal via image filenames)", async () => {
    const result = await saveProduct(store, { id: "../etc/passwd", name: "Bad" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid product id");
    expect(result.status).toBe(400);
  });

  it("creates a new product with sensible defaults", async () => {
    const result = await saveProduct(store, { id: "p1", name: "Mug", price: 10 });
    expect(result.ok).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ id: "p1", name: "Mug", price: 10, sell: true, coming_soon: false });
  });

  it("upserts: saving the same id twice updates rather than duplicates", async () => {
    await saveProduct(store, { id: "p1", name: "Mug", price: 10 });
    await saveProduct(store, { id: "p1", name: "Mug v2", price: 12 });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.name).toBe("Mug v2");
    expect(store.rows[0]!.price).toBe(12);
  });

  it("defaults cogm to half the price when cogm is absent", async () => {
    await saveProduct(store, { id: "p1", name: "Mug", price: 20 });
    expect(store.rows[0]!.cogm).toBe(10);
  });

  it("uses an explicit cogm of 0 rather than falling back to the price-based default", async () => {
    // isset($d['cogm']) is true for an explicit 0 in PHP — only an ABSENT key defaults.
    await saveProduct(store, { id: "p1", name: "Mug", price: 20, cogm: 0 });
    expect(store.rows[0]!.cogm).toBe(0);
  });

  it("defaults sell to true (1) when absent, but honors an explicit false", async () => {
    await saveProduct(store, { id: "p1", name: "Mug" });
    expect(store.rows[0]!.sell).toBe(true);
    await saveProduct(store, { id: "p2", name: "Mug 2", sell: false });
    expect(store.rows[0 /* p1 unaffected */]!.sell).toBe(true);
    expect(store.rows.find((r) => r.id === "p2")!.sell).toBe(false);
  });

  it("donated forces sell off, even if sell:true is also sent", async () => {
    await saveProduct(store, { id: "p1", name: "Mug", donated: true, sell: true });
    expect(store.rows[0]!.donated).toBe(true);
    expect(store.rows[0]!.sell).toBe(false);
  });

  it("donated defaults to false, and sell is unaffected when donated is absent", async () => {
    await saveProduct(store, { id: "p1", name: "Mug" });
    expect(store.rows[0]!.donated).toBe(false);
    expect(store.rows[0]!.sell).toBe(true);
  });

  it("coming_soon follows PHP empty() semantics: 0/'0'/absent -> false, anything else truthy -> true", async () => {
    await saveProduct(store, { id: "p1", name: "A", coming_soon: 0 });
    await saveProduct(store, { id: "p2", name: "B", coming_soon: "0" });
    await saveProduct(store, { id: "p3", name: "C" });
    await saveProduct(store, { id: "p4", name: "D", coming_soon: true });
    await saveProduct(store, { id: "p5", name: "E", coming_soon: 1 });
    const byId = (id: string) => store.rows.find((r) => r.id === id)!;
    expect(byId("p1").coming_soon).toBe(false);
    expect(byId("p2").coming_soon).toBe(false);
    expect(byId("p3").coming_soon).toBe(false);
    expect(byId("p4").coming_soon).toBe(true);
    expect(byId("p5").coming_soon).toBe(true);
  });

  it("normalizes an unrecognized ship_mode to 'weight', matching the PHP ternary", async () => {
    await saveProduct(store, { id: "p1", name: "Mug", ship_mode: "nonsense" });
    expect(store.rows[0]!.ship_mode).toBe("weight");
    await saveProduct(store, { id: "p2", name: "Mug 2", ship_mode: "fixed" });
    expect(store.rows.find((r) => r.id === "p2")!.ship_mode).toBe("fixed");
  });

  it("passes through an already-URL image value unchanged (editing text without touching the image)", async () => {
    await saveProduct(store, { id: "p1", name: "Mug", imgs: ["/product_images/existing.jpg", "", ""] });
    expect(store.rows[0]!.img1).toBe("/product_images/existing.jpg");
    expect(store.images.size).toBe(0); // nothing written to R2 for a passthrough URL
  });

  it("uploads a valid base64 JPEG image, writes it to R2, and stores a root-relative URL", async () => {
    const result = await saveProduct(store, { id: "p1", name: "Mug", imgs: [makeDataUrl("image/jpeg", JPEG_BYTES), "", ""] });
    expect(result.ok).toBe(true);
    expect(store.rows[0]!.img1).toBe("/product_images/prod_p1_img1.jpg");
    const written = store.images.get("product_images/prod_p1_img1.jpg");
    expect(written).toBeDefined();
    expect(Array.from(written!.bytes)).toEqual(JPEG_BYTES);
    expect(written!.contentType).toBe("image/jpeg");
  });

  it("uploads a valid base64 PNG image with the correct extension and content type", async () => {
    await saveProduct(store, { id: "p1", name: "Mug", imgs: [makeDataUrl("image/png", PNG_BYTES), "", ""] });
    expect(store.rows[0]!.img1).toBe("/product_images/prod_p1_img1.png");
    expect(store.images.get("product_images/prod_p1_img1.png")!.contentType).toBe("image/png");
  });

  it("rejects a bad-magic-byte image and aborts the WHOLE save (no row written)", async () => {
    const result = await saveProduct(store, { id: "p1", name: "Mug", imgs: [makeDataUrl("image/jpeg", BOGUS_BYTES), "", ""] });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid image format — only JPEG and PNG are accepted");
    expect(result.status).toBe(400);
    expect(store.rows).toHaveLength(0);
  });

  it("silently empties a slot that contains 'data:image' but doesn't match the base64 pattern", async () => {
    const result = await saveProduct(store, { id: "p1", name: "Mug", imgs: ["data:image/jpeg;base64,", "", ""] });
    expect(result.ok).toBe(true);
    expect(store.rows[0]!.img1).toBe("");
  });

  it("rejects an over-size base64 payload (cap is on base64 TEXT length, not decoded bytes)", async () => {
    const huge = "A".repeat(6 * 1024 * 1024); // > 4MB*4/3 base64 chars
    const result = await saveProduct(store, { id: "p1", name: "Mug", imgs: [`data:image/jpeg;base64,${huge}`, "", ""] });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Image too large (max 4MB)");
  });

  it("processes all three slots independently, each getting its own filename", async () => {
    await saveProduct(store, {
      id: "p1",
      name: "Mug",
      imgs: [makeDataUrl("image/jpeg", JPEG_BYTES), makeDataUrl("image/png", PNG_BYTES), ""],
    });
    expect(store.rows[0]!.img1).toBe("/product_images/prod_p1_img1.jpg");
    expect(store.rows[0]!.img2).toBe("/product_images/prod_p1_img2.png");
    expect(store.rows[0]!.img3).toBe("");
  });
});

describe("deleteProduct", () => {
  it("rejects a missing id", async () => {
    expect((await deleteProduct(store, "")).error).toBe("Missing id");
  });

  it("removes the product row", async () => {
    store.rows = [makeProductRow({ id: "p1", name: "Mug" })];
    const result = await deleteProduct(store, "p1");
    expect(result.ok).toBe(true);
    expect(store.rows).toHaveLength(0);
  });

  it("does not touch R2 — matches the PHP, which never deleted image files on product delete", async () => {
    await saveProduct(store, { id: "p1", name: "Mug", imgs: [makeDataUrl("image/jpeg", JPEG_BYTES), "", ""] });
    expect(store.images.size).toBe(1);
    await deleteProduct(store, "p1");
    expect(store.images.size).toBe(1); // still there — orphaned, faithfully matching the PHP
  });
});
