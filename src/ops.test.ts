import { describe, it, expect, beforeEach } from "vitest";
import { listEmailLog, logEmail, clearEmailLog, EmailLogStoreFake } from "./ops";

let store: EmailLogStoreFake;

beforeEach(() => {
  store = new EmailLogStoreFake();
});

describe("logEmail / listEmailLog", () => {
  it("logs an entry with defaults for missing fields", async () => {
    await logEmail(store, {});
    expect(store.rows[0]).toMatchObject({ email_type: "unknown", sent_to: "", order_id: "", status: "sent", error_msg: null });
  });

  it("logs an entry with provided fields", async () => {
    await logEmail(store, { email_type: "Order Confirmation", sent_to: "a@x.com", order_id: "ORD-1", subject: "Hi", status: "failed", error_msg: "SMTP timeout" });
    expect(store.rows[0]).toMatchObject({ email_type: "Order Confirmation", sent_to: "a@x.com", order_id: "ORD-1", status: "failed", error_msg: "SMTP timeout" });
  });

  it("lists newest first", async () => {
    await logEmail(store, { email_type: "A" });
    store.rows[0]!.sent_at = "2026-01-01T00:00:00Z";
    await logEmail(store, { email_type: "B" });
    store.rows[1]!.sent_at = "2026-01-02T00:00:00Z";
    const result = await listEmailLog(store, {});
    expect(result.data?.logs.map((r) => r.email_type)).toEqual(["B", "A"]);
  });

  it("filters by order_id", async () => {
    await logEmail(store, { email_type: "A", order_id: "ORD-1" });
    await logEmail(store, { email_type: "B", order_id: "ORD-2" });
    const result = await listEmailLog(store, { orderId: "ORD-1" });
    expect(result.data?.logs).toHaveLength(1);
    expect(result.data?.logs[0]!.email_type).toBe("A");
  });

  it("filters by type", async () => {
    await logEmail(store, { email_type: "Contact Form" });
    await logEmail(store, { email_type: "Order Confirmation" });
    const result = await listEmailLog(store, { type: "Contact Form" });
    expect(result.data?.logs).toHaveLength(1);
  });

  it("caps at 500 rows", async () => {
    for (let i = 0; i < 510; i++) await logEmail(store, { email_type: `E${i}` });
    const result = await listEmailLog(store, {});
    expect(result.data?.logs).toHaveLength(500);
  });
});

describe("clearEmailLog", () => {
  it("removes every row", async () => {
    await logEmail(store, { email_type: "A" });
    await clearEmailLog(store);
    expect((await listEmailLog(store, {})).data?.logs).toEqual([]);
  });
});
