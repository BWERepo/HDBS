import { describe, it, expect, beforeEach } from "vitest";
import {
  listCustomers,
  registerCustomer,
  loginCustomer,
  getCustomerSecurityQuestion,
  resetCustomerPassword,
  changeCustomerPassword,
  incrementOrderCount,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  cancelOrder,
  CustomersStoreFake,
  makeCustomerRow,
} from "./customers";
import { hashPassword } from "./lib/password";
import { makeCancelToken, OrdersStoreFake, makeOrderRow } from "./orders";
import bcrypt from "bcryptjs";

const SECRET = "test-order-token-secret";

let store: CustomersStoreFake;

beforeEach(() => {
  store = new CustomersStoreFake();
});

describe("listCustomers", () => {
  it("maps rows to the list shape with formatted joined date", async () => {
    store.customers.set("C1", makeCustomerRow({ id: "C1", email: "a@example.com", first_name: "Jane", last_name: "Doe", order_count: 3, joined_at: "2026-07-03T12:00:00Z" }));
    const result = await listCustomers(store);
    expect(result.data?.customers).toEqual([
      { id: "C1", fn: "Jane", ln: "Doe", name: "Jane Doe", em: "a@example.com", ph: "", orders: 3, joined: "7/3/2026" },
    ]);
  });
});

describe("registerCustomer", () => {
  it("requires email and password", async () => {
    expect((await registerCustomer(store, { em: "", pw: "secret1" }, "k", SECRET)).ok).toBe(false);
    expect((await registerCustomer(store, { em: "a@example.com", pw: "" }, "k", SECRET)).ok).toBe(false);
  });

  it("requires a password of at least 6 characters", async () => {
    const result = await registerCustomer(store, { em: "a@example.com", pw: "12345" }, "k", SECRET);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/at least 6/);
  });

  it("registers a new customer and issues an orders_token", async () => {
    const result = await registerCustomer(store, { em: "a@example.com", pw: "secret1", fn: "Jane", ln: "Doe" }, "k", SECRET);
    expect(result.ok).toBe(true);
    expect(result.data?.name).toBe("Jane Doe");
    expect(result.data?.em).toBe("a@example.com");
    expect(result.data?.orders_token).toBeTruthy();
    expect(result.data?.id).toMatch(/^C\d+$/);
  });

  it("rejects a duplicate email", async () => {
    await registerCustomer(store, { em: "a@example.com", pw: "secret1" }, "k", SECRET);
    const result = await registerCustomer(store, { em: "a@example.com", pw: "secret2" }, "k2", SECRET);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already registered/);
  });

  it("hashes the password so it isn't stored in plaintext", async () => {
    await registerCustomer(store, { em: "a@example.com", pw: "secret1" }, "k", SECRET);
    const cust = await store.findByEmail("a@example.com");
    expect(cust?.password_hash).not.toBe("secret1");
    expect(cust?.password_hash?.startsWith("pbkdf2$")).toBe(true);
  });

  it("rate limits registration at 5 per hour per key", async () => {
    const now = 1000;
    for (let i = 0; i < 5; i++) {
      const result = await registerCustomer(store, { em: `p${i}@example.com`, pw: "secret1" }, "sameKey", SECRET, now);
      expect(result.ok).toBe(true);
    }
    const blocked = await registerCustomer(store, { em: "p6@example.com", pw: "secret1" }, "sameKey", SECRET, now + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/Too many registration/);
  });
});

describe("loginCustomer", () => {
  it("requires email and password", async () => {
    expect((await loginCustomer(store, "", "pw", "k", SECRET)).ok).toBe(false);
  });

  it("fails for a nonexistent account", async () => {
    const result = await loginCustomer(store, "nobody@example.com", "pw", "k", SECRET);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Incorrect email or password/);
  });

  it("logs in successfully with a PBKDF2-hashed password and returns the profile + token", async () => {
    await registerCustomer(store, { em: "a@example.com", pw: "secret1", fn: "Jane", ln: "Doe" }, "k", SECRET);
    const result = await loginCustomer(store, "a@example.com", "secret1", "k2", SECRET);
    expect(result.ok).toBe(true);
    expect(result.data?.name).toBe("Jane Doe");
    expect(result.data?.orders_token).toBeTruthy();
  });

  it("verifies a legacy bcrypt password and transparently rehashes to PBKDF2", async () => {
    const bcryptHash = await bcrypt.hash("secret1", 10);
    store.customers.set("C1", makeCustomerRow({ id: "C1", email: "a@example.com", password_hash: bcryptHash }));
    const result = await loginCustomer(store, "a@example.com", "secret1", "k", SECRET);
    expect(result.ok).toBe(true);
    const cust = await store.findById("C1");
    expect(cust?.password_hash?.startsWith("pbkdf2$")).toBe(true);
  });

  it("rejects the wrong password", async () => {
    await registerCustomer(store, { em: "a@example.com", pw: "secret1" }, "k", SECRET);
    const result = await loginCustomer(store, "a@example.com", "wrong", "k2", SECRET);
    expect(result.ok).toBe(false);
  });

  it("locks out after 10 failed attempts within 15 minutes", async () => {
    await registerCustomer(store, { em: "a@example.com", pw: "secret1" }, "k", SECRET);
    const now = 1000;
    for (let i = 0; i < 10; i++) await loginCustomer(store, "a@example.com", "wrong", "loginKey", SECRET, now);
    const result = await loginCustomer(store, "a@example.com", "secret1", "loginKey", SECRET, now + 5);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Too many failed attempts/);
  });
});

describe("getCustomerSecurityQuestion", () => {
  it("requires an email", async () => {
    expect((await getCustomerSecurityQuestion(store, "")).ok).toBe(false);
  });

  it("fails when no account exists", async () => {
    const result = await getCustomerSecurityQuestion(store, "nobody@example.com");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No account found/);
  });

  it("fails when no security question is set", async () => {
    store.customers.set("C1", makeCustomerRow({ id: "C1", email: "a@example.com", sec_question: "" }));
    const result = await getCustomerSecurityQuestion(store, "a@example.com");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/No security question/);
  });

  it("returns the question", async () => {
    store.customers.set("C1", makeCustomerRow({ id: "C1", email: "a@example.com", sec_question: "Pet name?" }));
    const result = await getCustomerSecurityQuestion(store, "a@example.com");
    expect(result.data?.question).toBe("Pet name?");
  });
});

describe("resetCustomerPassword", () => {
  it("requires email, answer, and new password", async () => {
    expect((await resetCustomerPassword(store, "", "ans", "newpass1", "k")).ok).toBe(false);
  });

  it("resets the password with the correct hashed answer", async () => {
    store.customers.set("C1", makeCustomerRow({ id: "C1", email: "a@example.com", sec_answer: await hashPassword("fluffy") }));
    const result = await resetCustomerPassword(store, "a@example.com", "Fluffy", "newpass1", "k");
    expect(result.ok).toBe(true);
    const verified = await import("./lib/password").then((m) => m.verifyPassword("newpass1", store.customers.get("C1")!.password_hash!));
    expect(verified.valid).toBe(true);
  });

  it("accepts a legacy plaintext answer and self-heals it to a hash", async () => {
    store.customers.set("C1", makeCustomerRow({ id: "C1", email: "a@example.com", sec_answer: "fluffy" }));
    const result = await resetCustomerPassword(store, "a@example.com", "Fluffy", "newpass1", "k");
    expect(result.ok).toBe(true);
    const stored = store.customers.get("C1")!.sec_answer!;
    expect(stored).not.toBe("fluffy");
    expect(stored.startsWith("pbkdf2$")).toBe(true);
  });

  it("rejects an incorrect answer", async () => {
    store.customers.set("C1", makeCustomerRow({ id: "C1", email: "a@example.com", sec_answer: await hashPassword("fluffy") }));
    const result = await resetCustomerPassword(store, "a@example.com", "wrong", "newpass1", "k");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Incorrect answer/);
  });

  it("rejects a too-short new password only AFTER the answer is verified (matching PHP's check order)", async () => {
    store.customers.set("C1", makeCustomerRow({ id: "C1", email: "a@example.com", sec_answer: await hashPassword("fluffy") }));
    const wrongAnswer = await resetCustomerPassword(store, "a@example.com", "wrong", "abc", "k");
    expect(wrongAnswer.error).toMatch(/Incorrect answer/); // not the length error
    const rightAnswerShortPw = await resetCustomerPassword(store, "a@example.com", "Fluffy", "abc", "k2");
    expect(rightAnswerShortPw.error).toMatch(/at least 6/);
  });

  it("locks out after 5 failed attempts within 15 minutes", async () => {
    store.customers.set("C1", makeCustomerRow({ id: "C1", email: "a@example.com", sec_answer: await hashPassword("fluffy") }));
    const now = 1000;
    for (let i = 0; i < 5; i++) await resetCustomerPassword(store, "a@example.com", "wrong", "newpass1", "resetKey", now);
    const result = await resetCustomerPassword(store, "a@example.com", "Fluffy", "newpass1", "resetKey", now + 5);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Too many failed attempts/);
  });
});

describe("changeCustomerPassword", () => {
  it("requires id, old password, and new password", async () => {
    expect((await changeCustomerPassword(store, "", "old", "newpass1", "k")).ok).toBe(false);
  });

  it("changes the password given the correct current one", async () => {
    await registerCustomer(store, { em: "a@example.com", pw: "secret1" }, "k", SECRET);
    const id = (await store.findByEmail("a@example.com"))!.id;
    const result = await changeCustomerPassword(store, id, "secret1", "newpass1", "k2");
    expect(result.ok).toBe(true);
    const login = await loginCustomer(store, "a@example.com", "newpass1", "k3", SECRET);
    expect(login.ok).toBe(true);
  });

  it("rejects an incorrect current password", async () => {
    await registerCustomer(store, { em: "a@example.com", pw: "secret1" }, "k", SECRET);
    const id = (await store.findByEmail("a@example.com"))!.id;
    const result = await changeCustomerPassword(store, id, "wrong", "newpass1", "k2");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Current password incorrect/);
  });

  it("locks out after 10 failed attempts within 15 minutes", async () => {
    await registerCustomer(store, { em: "a@example.com", pw: "secret1" }, "k", SECRET);
    const id = (await store.findByEmail("a@example.com"))!.id;
    const now = 1000;
    for (let i = 0; i < 10; i++) await changeCustomerPassword(store, id, "wrong", "newpass1", "cpKey", now);
    const result = await changeCustomerPassword(store, id, "secret1", "newpass1", "cpKey", now + 5);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Too many failed attempts/);
  });
});

describe("incrementOrderCount", () => {
  it("requires email and order_id", async () => {
    const ordersStore = new OrdersStoreFake();
    expect((await incrementOrderCount(ordersStore, store, "", "ORD-1")).ok).toBe(false);
    expect((await incrementOrderCount(ordersStore, store, "a@example.com", "")).ok).toBe(false);
  });

  it("fails when the order doesn't belong to that email", async () => {
    const ordersStore = new OrdersStoreFake();
    ordersStore.orders = [makeOrderRow({ id: "ORD-1", customer_email: "other@example.com" })];
    store.customers.set("C1", makeCustomerRow({ id: "C1", email: "a@example.com" }));
    const result = await incrementOrderCount(ordersStore, store, "a@example.com", "ORD-1");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Order not found/);
  });

  it("increments the order count when the order matches the email", async () => {
    const ordersStore = new OrdersStoreFake();
    ordersStore.orders = [makeOrderRow({ id: "ORD-1", customer_email: "a@example.com" })];
    store.customers.set("C1", makeCustomerRow({ id: "C1", email: "a@example.com", order_count: 2 }));
    const result = await incrementOrderCount(ordersStore, store, "a@example.com", "ORD-1");
    expect(result.ok).toBe(true);
    expect(store.customers.get("C1")!.order_count).toBe(3);
  });
});

describe("addCustomer / updateCustomer / deleteCustomer (admin)", () => {
  it("addCustomer requires an email and rejects a duplicate", async () => {
    expect((await addCustomer(store, { em: "" })).ok).toBe(false);
    await addCustomer(store, { em: "a@example.com" });
    const dup = await addCustomer(store, { em: "a@example.com" });
    expect(dup.ok).toBe(false);
  });

  it("addCustomer defaults the password to TempPass1! when none is given", async () => {
    const result = await addCustomer(store, { em: "a@example.com" });
    const cust = await store.findById(result.data!.id);
    const verified = await import("./lib/password").then((m) => m.verifyPassword("TempPass1!", cust!.password_hash!));
    expect(verified.valid).toBe(true);
  });

  it("updateCustomer requires an id and overwrites all four fields, defaulting missing ones to empty string", async () => {
    expect((await updateCustomer(store, "", { fn: "Jane" })).ok).toBe(false);

    const result = await addCustomer(store, { em: "a@example.com", fn: "Jane", ln: "Doe", ph: "555-1234" });
    await updateCustomer(store, result.data!.id, { fn: "Janet" }); // only fn sent
    const cust = await store.findById(result.data!.id);
    expect(cust?.first_name).toBe("Janet");
    expect(cust?.last_name).toBe(""); // NOT preserved as "Doe" - matches the PHP's always-overwrite behavior
    expect(cust?.phone).toBe("");
  });

  it("deleteCustomer requires an id and removes the row", async () => {
    expect((await deleteCustomer(store, "")).ok).toBe(false);
    const result = await addCustomer(store, { em: "a@example.com" });
    await deleteCustomer(store, result.data!.id);
    expect(await store.findById(result.data!.id)).toBeNull();
  });
});

describe("cancelOrder", () => {
  it("requires an order_id and a cancel_token", async () => {
    const ordersStore = new OrdersStoreFake();
    expect((await cancelOrder(ordersStore, "", "tok", SECRET)).ok).toBe(false);
    expect((await cancelOrder(ordersStore, "ORD-1", "", SECRET)).ok).toBe(false);
  });

  it("rejects an invalid cancel token", async () => {
    const ordersStore = new OrdersStoreFake();
    ordersStore.orders = [makeOrderRow({ id: "ORD-1", status: "Awaiting Payment" })];
    const result = await cancelOrder(ordersStore, "ORD-1", "wrong-token", SECRET);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("rejects when the order doesn't exist", async () => {
    const ordersStore = new OrdersStoreFake();
    const token = await makeCancelToken("ORD-missing", SECRET);
    const result = await cancelOrder(ordersStore, "ORD-missing", token, SECRET);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it("rejects cancelling an order that isn't Awaiting Payment", async () => {
    const ordersStore = new OrdersStoreFake();
    ordersStore.orders = [makeOrderRow({ id: "ORD-1", status: "Paid" })];
    const token = await makeCancelToken("ORD-1", SECRET);
    const result = await cancelOrder(ordersStore, "ORD-1", token, SECRET);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Cannot cancel/);
  });

  it("cancels a valid awaiting-payment order and restores stock", async () => {
    const ordersStore = new OrdersStoreFake();
    ordersStore.orders = [makeOrderRow({ id: "ORD-1", status: "Awaiting Payment" })];
    ordersStore.items = [{ order_id: "ORD-1", product_id: "p1", product_name: "Tote", price: 50, quantity: 2 }];
    ordersStore.products.set("p1", { name: "Tote", price: 50, stock: 0 });
    const token = await makeCancelToken("ORD-1", SECRET);

    const result = await cancelOrder(ordersStore, "ORD-1", token, SECRET);
    expect(result.ok).toBe(true);
    expect(ordersStore.orders[0]!.status).toBe("Cancelled");
    expect(ordersStore.products.get("p1")!.stock).toBe(2);
  });
});
