import { describe, it, expect } from "vitest";
import { readLog, clearLog, getErrorLog, formatLogLine, AppLogStoreFake } from "./app-log";

describe("app-log", () => {
  it("readLog rejects a file not in the PHP's own allowlist", async () => {
    const result = await readLog(new AppLogStoreFake(), "some_other_file.txt");
    expect(result).toEqual({ ok: false, error: "Invalid log file", status: 400 });
  });

  it("readLog returns the PHP's placeholder text when a file has no entries yet", async () => {
    const result = await readLog(new AppLogStoreFake(), "notify_log.txt");
    expect(result.data?.content).toBe("No entries yet.");
  });

  it("readLog returns entries newest-first, capped at 200", async () => {
    const store = new AppLogStoreFake();
    for (let i = 0; i < 205; i++) {
      await store.append("notify_log.txt", { context: "CTX", message: `msg-${i}` });
    }
    const result = await readLog(store, "notify_log.txt");
    const lines = result.data!.content.split("\n");
    expect(lines).toHaveLength(200);
    // Newest first: last appended (msg-204) comes first, oldest kept (msg-5) comes last.
    expect(lines[0]).toContain("msg-204");
    expect(lines[lines.length - 1]).toContain("msg-5");
  });

  it("clearLog empties only the named file", async () => {
    const store = new AppLogStoreFake();
    await store.append("notify_log.txt", { context: "A", message: "1" });
    await store.append("webhook_log.txt", { context: "B", message: "2" });
    await clearLog(store, "notify_log.txt");
    expect(await store.readEntries("notify_log.txt")).toHaveLength(0);
    expect(await store.readEntries("webhook_log.txt")).toHaveLength(1);
  });

  it("clearLog rejects an unknown file without touching the store", async () => {
    const result = await clearLog(new AppLogStoreFake(), "../../etc/passwd");
    expect(result).toEqual({ ok: false, error: "Invalid log file", status: 400 });
  });

  it("getErrorLog returns the PHP's own 'not found yet' message when empty", async () => {
    const result = await getErrorLog(new AppLogStoreFake());
    expect(result.data?.log).toBe("(error_log.txt not found — enable debug mode and trigger some actions first)");
  });

  it("getErrorLog returns full (not 200-capped, not reversed) oldest-first text", async () => {
    const store = new AppLogStoreFake();
    await store.append("error_log.txt", { context: "DEBUG", message: "first" });
    await store.append("error_log.txt", { context: "DEBUG", message: "second" });
    const result = await getErrorLog(store);
    const lines = result.data!.log.split("\n");
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
  });

  it("getErrorLog truncates to the last 100KB with the PHP's own truncation banner", async () => {
    const store = new AppLogStoreFake();
    await store.append("error_log.txt", { context: "DEBUG", message: "x".repeat(150_000) });
    const result = await getErrorLog(store);
    expect(result.data!.log.startsWith("...(truncated, showing last 100KB)...\n")).toBe(true);
    expect(result.data!.log.length).toBeLessThan(150_100);
  });

  it("formatLogLine matches applog()'s '<timestamp> | ctx | msg' shape", () => {
    const line = formatLogLine({ loggedAt: "2026-08-01T18:03:45.000Z", context: "PAYMENT-FAIL", message: "Order: ORD-1" });
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2} (AM|PM) EDT \| PAYMENT-FAIL \| Order: ORD-1$/);
  });
});
