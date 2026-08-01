import { describe, it, expect } from "vitest";
import { makeOrderToken, verifyOrderToken } from "./order-token";

const SECRET = "test-order-token-secret";

describe("makeOrderToken / verifyOrderToken", () => {
  it("round-trips: a freshly made token verifies to the same email", async () => {
    const token = await makeOrderToken("Person@Example.com", 3600, SECRET, 1000);
    expect(await verifyOrderToken(token, SECRET, 1500)).toBe("person@example.com");
  });

  it("normalizes email to lowercase/trimmed at creation time", async () => {
    const token = await makeOrderToken("  Person@Example.COM  ", 3600, SECRET, 1000);
    expect(await verifyOrderToken(token, SECRET, 1500)).toBe("person@example.com");
  });

  it("rejects an expired token", async () => {
    const token = await makeOrderToken("person@example.com", 100, SECRET, 1000);
    expect(await verifyOrderToken(token, SECRET, 1101)).toBeNull();
  });

  it("accepts a token at the exact expiry boundary", async () => {
    const token = await makeOrderToken("person@example.com", 100, SECRET, 1000);
    expect(await verifyOrderToken(token, SECRET, 1100)).toBe("person@example.com");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await makeOrderToken("person@example.com", 3600, SECRET, 1000);
    expect(await verifyOrderToken(token, "wrong-secret", 1500)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await makeOrderToken("person@example.com", 3600, SECRET, 1000);
    const [payload, sig] = token.split(".");
    const tampered = `${payload}x.${sig}`;
    expect(await verifyOrderToken(tampered, SECRET, 1500)).toBeNull();
  });

  it("rejects garbage input without throwing", async () => {
    expect(await verifyOrderToken("not-a-token", SECRET)).toBeNull();
    expect(await verifyOrderToken("", SECRET)).toBeNull();
    expect(await verifyOrderToken("a.b.c", SECRET)).toBeNull();
  });

  it("uses the full 64-hex-char HMAC-SHA256 signature, not truncated", async () => {
    const token = await makeOrderToken("person@example.com", 3600, SECRET, 1000);
    const sig = token.split(".").pop()!;
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});
