import { describe, it, expect, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import {
  login,
  logout,
  changePassword,
  getSecurityQuestion,
  verifySecurityAnswer,
  resetPasswordViaSecurityAnswer,
  saveSecurityQuestion,
  isValidAdminToken,
  AdminAuthStoreFake,
} from "./auth";
import { hashPassword } from "./lib/password";

let store: AdminAuthStoreFake;

beforeEach(() => {
  store = new AdminAuthStoreFake();
});

describe("login", () => {
  it("fails with a clear message when no admin_password is configured", async () => {
    const result = await login(store, "anything");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toMatch(/not configured/);
  });

  it("succeeds with the correct password and issues a session token", async () => {
    await store.setSetting("admin_password", await hashPassword("hunter2"));
    const result = await login(store, "hunter2");
    expect(result.ok).toBe(true);
    expect(result.data?.token).toHaveLength(64); // bin2hex(random_bytes(32))
    expect(await isValidAdminToken(store, result.data!.token)).toBe(true);
  });

  it("rejects the wrong password with an attempts-remaining message", async () => {
    await store.setSetting("admin_password", await hashPassword("hunter2"));
    const result = await login(store, "wrong");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Incorrect password. 4 attempts remaining.");
  });

  it("uses singular 'attempt' on the last try before lockout", async () => {
    await store.setSetting("admin_password", await hashPassword("hunter2"));
    for (let i = 0; i < 3; i++) await login(store, "wrong");
    const result = await login(store, "wrong");
    expect(result.error).toBe("Incorrect password. 1 attempt remaining.");
  });

  it("locks out after 5 failed attempts", async () => {
    await store.setSetting("admin_password", await hashPassword("hunter2"));
    for (let i = 0; i < 5; i++) await login(store, "wrong");
    const result = await login(store, "hunter2"); // even the RIGHT password is now locked out
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Too many failed attempts/);
  });

  it("clears the lockout after 15 minutes and allows login again", async () => {
    await store.setSetting("admin_password", await hashPassword("hunter2"));
    const t0 = 1_000_000_000;
    for (let i = 0; i < 5; i++) await login(store, "wrong", t0 + i);
    const stillLocked = await login(store, "hunter2", t0 + 60_000);
    expect(stillLocked.ok).toBe(false);

    const after15Min = t0 + 900_000 + 1000;
    const result = await login(store, "hunter2", after15Min);
    expect(result.ok).toBe(true);
  });

  it("transparently rehashes a legacy bcrypt password to PBKDF2 on successful login", async () => {
    await store.setSetting("admin_password", await bcrypt.hash("legacy-password", 10));
    const before = await store.getSetting("admin_password");
    const result = await login(store, "legacy-password");
    expect(result.ok).toBe(true);
    const after = await store.getSetting("admin_password");
    expect(after).not.toBe(before);
    expect(after!.startsWith("pbkdf2$")).toBe(true);

    // And the rehashed value still authenticates the same password afterward.
    const second = await login(store, "legacy-password");
    expect(second.ok).toBe(true);
  });

  it("cleans up expired sessions on every successful login", async () => {
    await store.insertSession({ token: "stale", expires: 1 });
    await store.setSetting("admin_password", await hashPassword("hunter2"));
    await login(store, "hunter2", 2000);
    expect(await store.findSession("stale")).toBeNull();
  });
});

describe("logout", () => {
  it("removes the given session", async () => {
    await store.insertSession({ token: "tok", expires: 9_999_999_999 });
    await logout(store, "tok");
    expect(await isValidAdminToken(store, "tok")).toBe(false);
  });
});

describe("isValidAdminToken", () => {
  it("rejects a missing token", async () => {
    expect(await isValidAdminToken(store, null)).toBe(false);
    expect(await isValidAdminToken(store, undefined)).toBe(false);
    expect(await isValidAdminToken(store, "")).toBe(false);
  });

  it("rejects a token that was never issued", async () => {
    expect(await isValidAdminToken(store, "never-issued")).toBe(false);
  });

  it("rejects an expired session", async () => {
    await store.insertSession({ token: "tok", expires: 1000 });
    expect(await isValidAdminToken(store, "tok", 1_000_001 * 1000)).toBe(false);
  });

  it("accepts a session at the exact expiry boundary", async () => {
    await store.insertSession({ token: "tok", expires: 1000 });
    expect(await isValidAdminToken(store, "tok", 1000 * 1000)).toBe(true);
  });

  it("has no legacy settings-table fallback: a token in settings alone is not valid", async () => {
    // The old admin_session_token / admin_session_expires columns are gone from the port on
    // purpose (see this file's header). Simulate what "logging in on the old system" used to
    // leave behind and confirm it grants nothing.
    await store.setSetting("admin_session_token", "some-old-token");
    await store.setSetting("admin_session_expires", "9999999999");
    expect(await isValidAdminToken(store, "some-old-token")).toBe(false);
  });
});

describe("changePassword", () => {
  it("rejects an incorrect current password", async () => {
    await store.setSetting("admin_password", await hashPassword("current-pw"));
    const result = await changePassword(store, "tok", "wrong-current", "new-pw", "new-pw");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Current password incorrect");
  });

  it("rejects a confirmation mismatch", async () => {
    await store.setSetting("admin_password", await hashPassword("current-pw"));
    const result = await changePassword(store, "tok", "current-pw", "new-pw", "different");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Passwords do not match");
  });

  it("rejects an empty new password", async () => {
    await store.setSetting("admin_password", await hashPassword("current-pw"));
    const result = await changePassword(store, "tok", "current-pw", "", "");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("New password cannot be empty");
  });

  it("updates the password and invalidates every OTHER session, keeping the current one", async () => {
    await store.setSetting("admin_password", await hashPassword("current-pw"));
    await store.insertSession({ token: "this-session", expires: 9_999_999_999 });
    await store.insertSession({ token: "other-device", expires: 9_999_999_999 });

    const result = await changePassword(store, "this-session", "current-pw", "new-pw", "new-pw");
    expect(result.ok).toBe(true);

    expect(await isValidAdminToken(store, "this-session")).toBe(true);
    expect(await isValidAdminToken(store, "other-device")).toBe(false);

    const login2 = await login(store, "new-pw");
    expect(login2.ok).toBe(true);
  });
});

describe("security question flow", () => {
  it("getSecurityQuestion fails when none is set", async () => {
    const result = await getSecurityQuestion(store);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("No security question set");
  });

  it("saveSecurityQuestion rejects mismatched answers", async () => {
    const result = await saveSecurityQuestion(store, "Pet's name?", "Fido", "Rex");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Answers do not match");
  });

  it("saves and later verifies a security answer, case- and whitespace-insensitively", async () => {
    await saveSecurityQuestion(store, "Pet's name?", "Fido", "Fido");
    const result = await verifySecurityAnswer(store, "  fIdO  ");
    expect(result.ok).toBe(true);
  });

  it("verifies a legacy PLAINTEXT answer (pre-hashing data) and rehashes it on success", async () => {
    await store.setSetting("admin_sec_question", "Pet's name?");
    await store.setSetting("admin_sec_answer", "fido"); // stored raw, as very old data would be
    const result = await verifySecurityAnswer(store, "Fido");
    expect(result.ok).toBe(true);
    const after = await store.getSetting("admin_sec_answer");
    expect(after).not.toBe("fido"); // no longer plaintext
    expect(after!.startsWith("pbkdf2$")).toBe(true);
  });

  it("locks out the security answer after 5 failed attempts, independently of login attempts", async () => {
    await saveSecurityQuestion(store, "Pet's name?", "Fido", "Fido");
    for (let i = 0; i < 5; i++) await verifySecurityAnswer(store, "wrong");
    const result = await verifySecurityAnswer(store, "Fido"); // correct answer, still locked
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Too many failed attempts/);
  });

  it("resetPasswordViaSecurityAnswer sets a new password and revokes ALL sessions", async () => {
    await store.setSetting("admin_password", await hashPassword("old-pw"));
    await store.insertSession({ token: "session-a", expires: 9_999_999_999 });
    await store.insertSession({ token: "session-b", expires: 9_999_999_999 });

    const result = await resetPasswordViaSecurityAnswer(store, "brand-new-pw");
    expect(result.ok).toBe(true);

    expect(await isValidAdminToken(store, "session-a")).toBe(false);
    expect(await isValidAdminToken(store, "session-b")).toBe(false);

    const login2 = await login(store, "brand-new-pw");
    expect(login2.ok).toBe(true);
  });

  it("resetPasswordViaSecurityAnswer rejects an empty password", async () => {
    const result = await resetPasswordViaSecurityAnswer(store, "");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Password cannot be empty");
  });
});
