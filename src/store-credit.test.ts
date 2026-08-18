import { describe, it, expect } from "vitest";
import { StoreCreditStoreFake, getStoreCreditBalance, spendStoreCredit, myStoreCreditTransactions } from "./store-credit";

describe("spendStoreCredit", () => {
  it("caps the debit at the available balance and logs a negative transaction", async () => {
    const store = new StoreCreditStoreFake();
    store.accounts.add("a@b.com");
    store.balances.set("a@b.com", 10);

    const result = await spendStoreCredit(store, "a@b.com", 25, "ORD-2");
    expect(result.ok).toBe(true);
    expect(result.data!.applied).toBe(10);
    expect(await store.getBalance("a@b.com")).toBe(0);

    const tx = await store.listTransactionsByEmail("a@b.com");
    expect(tx.find((t) => t.order_id === "ORD-2")!.amount).toBe(-10);
  });

  it("fails when the account has no balance", async () => {
    const store = new StoreCreditStoreFake();
    store.accounts.add("a@b.com");
    const result = await spendStoreCredit(store, "a@b.com", 25, "ORD-2");
    expect(result.ok).toBe(false);
  });
});

describe("getStoreCreditBalance / myStoreCreditTransactions", () => {
  it("reports balance and transaction history together", async () => {
    const store = new StoreCreditStoreFake();
    store.accounts.add("a@b.com");
    store.balances.set("a@b.com", 15); // seed a pre-existing balance directly (nothing deposits via app code anymore)
    await spendStoreCredit(store, "a@b.com", 5, "ORD-2");

    const balance = await getStoreCreditBalance(store, "a@b.com");
    expect(balance.data!.balance).toBe(10);

    const history = await myStoreCreditTransactions(store, "a@b.com");
    expect(history.data!.balance).toBe(10);
    expect(history.data!.transactions.length).toBe(1);
  });
});
