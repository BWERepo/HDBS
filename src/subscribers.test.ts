import { describe, it, expect, beforeEach } from "vitest";
import { listSubscribers, subscribe, unsubscribe, SubscribersStoreFake } from "./subscribers";

let store: SubscribersStoreFake;

beforeEach(() => {
  store = new SubscribersStoreFake();
});

describe("subscribe", () => {
  it("rejects an invalid email", async () => {
    const result = await subscribe(store, "key1", "not-an-email", "");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid email/);
  });

  it("subscribes a new, valid email", async () => {
    const result = await subscribe(store, "key1", "person@example.com", "");
    expect(result.ok).toBe(true);
    const subs = (await listSubscribers(store)).data?.subscribers ?? [];
    expect(subs.map((s) => s.email)).toEqual(["person@example.com"]);
  });

  it("rejects a duplicate subscription", async () => {
    await subscribe(store, "key1", "person@example.com", "");
    const result = await subscribe(store, "key1", "person@example.com", "");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Already subscribed/);
  });

  it("backfills source on a duplicate with no existing source, without erroring", async () => {
    await subscribe(store, "key1", "person@example.com", "");
    await subscribe(store, "key1", "person@example.com", "Coming Soon: Widget");
    const existing = await store.findSubscriber("person@example.com");
    expect(existing?.source).toBe("Coming Soon: Widget");
  });

  it("does not overwrite an existing source on a duplicate", async () => {
    await subscribe(store, "key1", "person@example.com", "Footer");
    await subscribe(store, "key1", "person@example.com", "Coming Soon: Widget");
    const existing = await store.findSubscriber("person@example.com");
    expect(existing?.source).toBe("Footer");
  });

  it("stores null source when none is provided", async () => {
    await subscribe(store, "key1", "person@example.com", "");
    const existing = await store.findSubscriber("person@example.com");
    expect(existing?.source).toBeNull();
  });

  it("allows 5 subscribe attempts per key then blocks the 6th within the window", async () => {
    const now = 1000;
    for (let i = 0; i < 5; i++) {
      const result = await subscribe(store, "keyA", `person${i}@example.com`, "", now);
      expect(result.ok).toBe(true);
    }
    const blocked = await subscribe(store, "keyA", "person6@example.com", "", now + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe(429);
    expect(blocked.error).toMatch(/Too many requests/);
  });

  it("resets the rate limit after the 15-minute window passes", async () => {
    const now = 1000;
    for (let i = 0; i < 5; i++) await subscribe(store, "keyB", `p${i}@example.com`, "", now);
    const afterWindow = now + 901;
    const result = await subscribe(store, "keyB", "fresh@example.com", "", afterWindow);
    expect(result.ok).toBe(true);
  });

  it("rate limits are independent per key", async () => {
    for (let i = 0; i < 5; i++) await subscribe(store, "keyC", `p${i}@example.com`, "", 1000);
    const otherKey = await subscribe(store, "keyD", "fresh@example.com", "", 1000);
    expect(otherKey.ok).toBe(true);
  });
});

describe("unsubscribe", () => {
  it("requires an email", async () => {
    const result = await unsubscribe(store, "");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Email required/);
  });

  it("removes an existing subscriber", async () => {
    await subscribe(store, "key1", "person@example.com", "");
    const result = await unsubscribe(store, "person@example.com");
    expect(result.ok).toBe(true);
    expect((await listSubscribers(store)).data?.subscribers).toEqual([]);
  });
});
