import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword (PBKDF2 round-trip)", () => {
  it("verifies a password against its own hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const result = await verifyPassword("correct horse battery staple", hash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(false);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const result = await verifyPassword("wrong password", hash);
    expect(result.valid).toBe(false);
  });

  it("produces a hash tagged with the pbkdf2 prefix, never bcrypt", async () => {
    const hash = await hashPassword("anything");
    expect(hash.startsWith("pbkdf2$")).toBe(true);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword against legacy bcrypt hashes", () => {
  it("verifies a real bcrypt($2y$-equivalent) hash and flags it for rehash", async () => {
    // bcryptjs emits $2a$ or $2b$; PHP's PASSWORD_DEFAULT emits $2y$. All three are the same
    // algorithm and bcryptjs.compare() reads all of them - this is what makes verifying a hash
    // actually produced by production PHP viable from a Worker.
    const stored = await bcrypt.hash("the admin password", 10);
    const result = await verifyPassword("the admin password", stored);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  it("verifies an actual $2y$ hash, the exact prefix PHP's password_hash(...) emits", async () => {
    // Force the $2y$ prefix bcryptjs would otherwise write as $2a$/$2b$, to prove the regex in
    // password.ts (/^\$2[aby]\$/) really does accept what PHP writes, not just what bcryptjs writes.
    const b = await bcrypt.hash("swap the prefix", 10);
    const stored = "$2y$" + b.slice(4);
    const result = await verifyPassword("swap the prefix", stored);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  it("rejects the wrong password against a bcrypt hash without rehashing", async () => {
    const stored = await bcrypt.hash("right password", 10);
    const result = await verifyPassword("wrong password", stored);
    expect(result.valid).toBe(false);
    expect(result.needsRehash).toBe(false);
  });
});

describe("verifyPassword edge cases", () => {
  it("rejects an empty stored hash without throwing", async () => {
    const result = await verifyPassword("anything", "");
    expect(result.valid).toBe(false);
  });

  it("rejects a malformed pbkdf2-shaped string without throwing", async () => {
    const result = await verifyPassword("anything", "pbkdf2$not$enough$parts$here$too$many");
    expect(result.valid).toBe(false);
  });

  it("rejects a completely unrecognised format (e.g. legacy plaintext) without throwing", async () => {
    const result = await verifyPassword("plaintext-password", "plaintext-password");
    expect(result.valid).toBe(false);
  });
});
