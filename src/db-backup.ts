// Ports api/db_backup.php's data-export core. NOT a literal port: the PHP built a runnable MySQL
// dump (SHOW CREATE TABLE + INSERT statements) — that format is meaningless against Supabase's
// Postgres, and a Worker has no pg_dump binary to shell out to for a real equivalent. This exports
// every table's rows as JSON instead: not a re-runnable script, but the same underlying guarantee
// (a portable snapshot of every row in the database), which is what actually matters for a backup.
//
// Every table this migration created, sourced from supabase/migrations/*.sql's own `create table`
// statements — kept as a flat list here (not queried from information_schema) since PostgREST
// only exposes the public schema's own tables anyway, and this list is the definitive one.
export const BACKUP_TABLES = [
  "settings",
  "admin_sessions",
  "rate_limits",
  "products",
  "orders",
  "order_items",
  "refunds",
  "order_lookup_requests",
  "customers",
  "customer_login_attempts",
  "subscribers",
  "reviews",
  "faqs",
  "email_log",
  "app_log",
  "tn_city_tax",
  "tax_sweeps",
  "studio_items",
  "studio_inquiries",
  "studio_project_notes",
  "capital_equipment",
  "coupons",
  "coupon_redemptions",
  "store_credit_transactions",
] as const;

export interface DbBackupStore {
  listTableRows(table: string): Promise<Record<string, unknown>[]>;
}

export interface DatabaseBackup {
  generatedAt: string;
  tables: readonly string[];
  data: Record<string, Record<string, unknown>[]>;
}

/** Fetches every row of every table listed in BACKUP_TABLES. */
export async function buildDatabaseBackup(store: DbBackupStore, now: Date = new Date()): Promise<DatabaseBackup> {
  const data: Record<string, Record<string, unknown>[]> = {};
  for (const table of BACKUP_TABLES) {
    data[table] = await store.listTableRows(table);
  }
  return { generatedAt: now.toISOString(), tables: BACKUP_TABLES, data };
}

/** Serializes a backup as pretty-printed JSON — the closest equivalent to the PHP's `.sql` text
 *  blob: a single portable file containing every row of every table. */
export function serializeBackupAsJson(backup: DatabaseBackup): string {
  return JSON.stringify(
    {
      _comment: "Handmade Designs By Suzi — Database Backup (Supabase/Postgres, JSON data export, not a runnable script)",
      generated_at: backup.generatedAt,
      tables: backup.tables,
      row_counts: Object.fromEntries(backup.tables.map((t) => [t, backup.data[t]?.length ?? 0])),
      data: backup.data,
    },
    null,
    2
  );
}

// ── In-memory test double ──
export class DbBackupStoreFake implements DbBackupStore {
  rows = new Map<string, Record<string, unknown>[]>();
  async listTableRows(table: string): Promise<Record<string, unknown>[]> {
    return this.rows.get(table) ?? [];
  }
}
