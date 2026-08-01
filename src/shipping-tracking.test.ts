import { describe, it, expect, beforeEach } from "vitest";
import { validateTracking, FakeUspsGateway } from "./shipping-tracking";

let gateway: FakeUspsGateway;

beforeEach(() => {
  gateway = new FakeUspsGateway();
});

describe("validateTracking", () => {
  it("rejects a non-USPS carrier", async () => {
    const result = await validateTracking(gateway, { carrier: "UPS", numbers: ["1Z999"] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Only USPS/);
  });

  it("rejects an empty numbers list", async () => {
    const result = await validateTracking(gateway, { carrier: "USPS", numbers: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No tracking numbers/);
  });

  it("filters out blank entries before checking for an empty list", async () => {
    const result = await validateTracking(gateway, { carrier: "USPS", numbers: ["  ", ""] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No tracking numbers/);
  });

  it("reports configured=false and skips all lookups when USPS isn't configured", async () => {
    gateway.configured = false;
    const result = await validateTracking(gateway, { carrier: "USPS", numbers: ["9400111111111111111111"] });
    expect(result.ok).toBe(true);
    expect(result.data?.configured).toBe(false);
    expect(result.data?.results).toEqual([]);
    expect(gateway.calls).toHaveLength(0);
  });

  it("looks up each number and merges the number back into the result", async () => {
    const result = await validateTracking(gateway, { carrier: "USPS", numbers: ["A", "B"] });
    expect(result.data?.configured).toBe(true);
    expect(result.data?.results).toEqual([
      { number: "A", ok: true, found: true, status: "Delivered", statusCategory: "Delivered" },
      { number: "B", ok: true, found: true, status: "Delivered", statusCategory: "Delivered" },
    ]);
  });

  it("caps at 10 numbers per request", async () => {
    const numbers = Array.from({ length: 15 }, (_, i) => `N${i}`);
    const result = await validateTracking(gateway, { carrier: "USPS", numbers });
    expect(result.data?.results).toHaveLength(10);
    expect(gateway.calls).toHaveLength(10);
  });

  it("passes through a not-found result distinctly from a found one", async () => {
    gateway.results.set("BOGUS", { ok: true, found: false, message: "Not found in USPS's system" });
    const result = await validateTracking(gateway, { carrier: "USPS", numbers: ["BOGUS"] });
    expect(result.data?.results[0]).toEqual({ number: "BOGUS", ok: true, found: false, message: "Not found in USPS's system" });
  });
});
