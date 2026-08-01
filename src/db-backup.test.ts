import { describe, it, expect, beforeEach } from "vitest";
import { buildDatabaseBackup, serializeBackupAsJson, BACKUP_TABLES, DbBackupStoreFake } from "./db-backup";

let store: DbBackupStoreFake;

beforeEach(() => {
  store = new DbBackupStoreFake();
});

describe("buildDatabaseBackup", () => {
  it("fetches every table in BACKUP_TABLES, defaulting to an empty array when unseeded", async () => {
    const backup = await buildDatabaseBackup(store);
    expect(Object.keys(backup.data).sort()).toEqual(BACKUP_TABLES.slice().sort());
    expect(backup.data.products).toEqual([]);
  });

  it("includes real rows for a seeded table", async () => {
    store.rows.set("products", [{ id: "p1", name: "Tote Bag" }]);
    const backup = await buildDatabaseBackup(store);
    expect(backup.data.products).toEqual([{ id: "p1", name: "Tote Bag" }]);
  });

  it("stamps generatedAt from the injected clock", async () => {
    const now = new Date("2026-08-01T12:00:00Z");
    const backup = await buildDatabaseBackup(store, now);
    expect(backup.generatedAt).toBe(now.toISOString());
  });
});

describe("serializeBackupAsJson", () => {
  it("produces valid JSON with row counts matching the actual data", async () => {
    store.rows.set("products", [{ id: "p1" }, { id: "p2" }]);
    const backup = await buildDatabaseBackup(store);
    const json = JSON.parse(serializeBackupAsJson(backup));
    expect(json.row_counts.products).toBe(2);
    expect(json.row_counts.orders).toBe(0);
    expect(json.data.products).toEqual([{ id: "p1" }, { id: "p2" }]);
    expect(json.tables).toEqual(BACKUP_TABLES.slice());
  });
});
