// Supabase service-role client + the store adapters that wire the store interfaces in auth.ts,
// settings.ts, and products.ts (AdminAuthStore, SettingsStore, ProductsStore) to real tables.
//
// The Worker uses service-role exclusively — the browser never talks to Supabase directly, RLS
// is enabled on every table with no permissive policies, and that is the whole point (a leaked
// publishable/anon key is inert). See supabase/migrations/0001_core.sql's header for the
// rationale note this file's callers should not "fix".
//
// Not unit-tested here: there is no live Supabase project in CI, and mocking supabase-js's query
// builder buys little confidence over the real thing. Per PROJECT_STATUS.md's Phase 2 lesson,
// the actual verification step for this file is `wrangler dev` + `curl` against a real project,
// not a unit test — the store-interface business logic in auth.ts/settings.ts/products.ts is
// already covered there, against fakes, which is what makes this adapter layer thin enough to
// trust by inspection.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./types";
import type { AdminAuthStore, AdminSession } from "./auth";
import type { SettingsStore } from "./settings";
import type { ProductsStore, ProductRow } from "./products";

export function createDb(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/** Throws with the Postgres/PostgREST error message rather than swallowing it silently. */
function checkError(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

// ── settings table — shared by both AdminAuthStore and SettingsStore below ──
async function getSettingRow(db: SupabaseClient, key: string): Promise<string | null> {
  const { data, error } = await db.from("settings").select("value").eq("key_name", key).maybeSingle();
  checkError(`getSetting(${key})`, error);
  return data?.value ?? null;
}

async function setSettingRow(db: SupabaseClient, key: string, value: string): Promise<void> {
  const { error } = await db.from("settings").upsert({ key_name: key, value });
  checkError(`setSetting(${key})`, error);
}

/** Wires auth.ts's AdminAuthStore to the `settings` and `admin_sessions` tables. */
export class SupabaseAdminAuthStore implements AdminAuthStore {
  constructor(private db: SupabaseClient) {}

  getSetting(key: string): Promise<string | null> {
    return getSettingRow(this.db, key);
  }
  setSetting(key: string, value: string): Promise<void> {
    return setSettingRow(this.db, key, value);
  }

  async findSession(token: string): Promise<AdminSession | null> {
    const { data, error } = await this.db
      .from("admin_sessions")
      .select("token, expires")
      .eq("token", token)
      .maybeSingle();
    checkError("findSession", error);
    return data ? { token: data.token, expires: Number(data.expires) } : null;
  }

  async insertSession(session: AdminSession): Promise<void> {
    const { error } = await this.db.from("admin_sessions").insert(session);
    checkError("insertSession", error);
  }

  async deleteSession(token: string): Promise<void> {
    const { error } = await this.db.from("admin_sessions").delete().eq("token", token);
    checkError("deleteSession", error);
  }

  async deleteSessionsExcept(token: string): Promise<void> {
    const { error } = await this.db.from("admin_sessions").delete().neq("token", token);
    checkError("deleteSessionsExcept", error);
  }

  async deleteAllSessions(): Promise<void> {
    // PostgREST requires a filter on delete; admin_sessions.expires is `not null`, so this
    // matches every row without needing a dedicated "delete all" escape hatch.
    const { error } = await this.db.from("admin_sessions").delete().gte("expires", 0);
    checkError("deleteAllSessions", error);
  }

  async deleteExpiredSessions(now: number): Promise<void> {
    const { error } = await this.db.from("admin_sessions").delete().lt("expires", now);
    checkError("deleteExpiredSessions", error);
  }
}

/** Wires settings.ts's SettingsStore to the same `settings` table. */
export class SupabaseSettingsStore implements SettingsStore {
  constructor(private db: SupabaseClient) {}

  getSetting(key: string): Promise<string | null> {
    return getSettingRow(this.db, key);
  }
  setSetting(key: string, value: string): Promise<void> {
    return setSettingRow(this.db, key, value);
  }
}

/** Wires products.ts's ProductsStore to the `products` table. */
export class SupabaseProductsStore implements ProductsStore {
  constructor(private db: SupabaseClient) {}

  async listProducts(): Promise<ProductRow[]> {
    const { data, error } = await this.db
      .from("products")
      .select(
        "id, sku, name, description, price, stock, category, badge, weight, size, sell, img1, img2, img3, ship_mode, ship_fixed, coming_soon, cogm, launch_date"
      )
      .order("created_at", { ascending: true });
    checkError("listProducts", error);
    return (data ?? []) as ProductRow[];
  }
}
