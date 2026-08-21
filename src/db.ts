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
import type { DonationsStore, DonationRow } from "./donations";
import type { OrdersStore, OrderRow, OrderItemRow, OrderInsert, OrderUpdatableFields } from "./orders";
import type { TaxStore, TnCityTaxRow, PendingTaxOrder, TaxSweepRow } from "./tax";
import type { SubscribersStore, SubscriberRow } from "./subscribers";
import type { CustomersStore, CustomerRow } from "./customers";
import type { ReviewsStore, ReviewRow, FaqsStore, FaqRow } from "./content";
import type { ContactStore } from "./contact";
import type { StudioStore, StudioItemRow, StudioInquiryRow, StudioNoteRow } from "./studio";
import type { CapitalEquipmentStore, CapitalEquipmentRow, BusinessDocsFileStore } from "./business";
import type { EmailLogStore, EmailLogRow } from "./ops";
import type { EmailOrderStore, OrderForConfirmation, OrderItemForConfirmation } from "./email";
import type { RefundsStore, RefundRow } from "./refunds";
import type { DbBackupStore } from "./db-backup";
import type { AppLogStore, AppLogFile, AppLogEntry } from "./app-log";
import type { CouponsStore, CouponBatchRow, CouponCodeRow, CouponCodeLookup } from "./coupons";
import type { StoreCreditStore, StoreCreditTransactionRow } from "./store-credit";
import type { OrderLookupStore } from "./order-lookup";

// The single runtime Supabase client. `db.schema` is what routes every `.from("…")` below at the
// DR project's per-site schemas (hdbs_staging / hdbs_prod) without touching any of the ~250 table
// name literals — which matters because HDBS has no generated types, so `tsc` would not have
// caught a rename. The "public" fallback is deliberate: an unset var means "behave exactly as
// before", not "guess", so a Worker that misses the var reads its own old schema rather than
// another site's rows.
export function createDb(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    // The `as "public"` is a type-level lie and nothing more, the same one BusinessWebExpress's
    // src/integrations/supabase/db-schema.ts carries for the same reason: supabase-js types
    // `db.schema` as a literal drawn from the client's schema generic, so a plain `string` leaves
    // that generic unresolved and the annotated return type stops matching. Safe because the
    // schemas are structural clones of each other — nothing reads this value as a type at runtime.
    db: { schema: (env.SUPABASE_DB_SCHEMA || "public") as "public" },
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

/** Stale rows past every purpose's throttle window (the longest of which — login/security-answer
 *  lockout — is 900s) are safe to delete; 24h leaves a wide, deliberately generous margin. */
const RATE_LIMIT_PRUNE_AGE_SECONDS = 24 * 3600;

/**
 * Cleanup for the two ephemeral security-state tables nothing else ever prunes on its own:
 * `admin_sessions` already gets an opportunistic sweep on every login (see
 * SupabaseAdminAuthStore.deleteExpiredSessions above, called from auth.ts's login()), but that
 * only runs when someone logs in — this is the real backstop. `rate_limits` (shared throttle
 * state for contact/reviews/subscribers/studio/order-lookup/login) has never had ANY prune path;
 * see wrangler.jsonc's cron-trigger comment and PROJECT_STATUS.md for how that gap was found.
 * Called from src/index.ts's `scheduled()` handler, the first one this codebase has ever had.
 */
export async function pruneExpiredSecurityState(db: SupabaseClient, now: number): Promise<void> {
  const nowSeconds = Math.floor(now / 1000);
  const { error: sessionsError } = await db.from("admin_sessions").delete().lt("expires", nowSeconds);
  checkError("pruneExpiredSecurityState(admin_sessions)", sessionsError);

  const { error: rateLimitsError } = await db
    .from("rate_limits")
    .delete()
    .lt("last_at", nowSeconds - RATE_LIMIT_PRUNE_AGE_SECONDS);
  checkError("pruneExpiredSecurityState(rate_limits)", rateLimitsError);
}

/** Wires settings.ts's SettingsStore to the `settings` table and R2_PUBLIC (biz_profile's
 *  logo/hero/about image uploads — customer-facing, same bucket as product images). */
export class SupabaseSettingsStore implements SettingsStore {
  constructor(
    private db: SupabaseClient,
    private r2: R2Bucket
  ) {}

  getSetting(key: string): Promise<string | null> {
    return getSettingRow(this.db, key);
  }
  setSetting(key: string, value: string): Promise<void> {
    return setSettingRow(this.db, key, value);
  }
  putImage(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    return r2Put(this.r2, key, bytes, contentType);
  }
  deleteImage(key: string): Promise<void> {
    return r2Delete(this.r2, key);
  }
}

/** Wires products.ts's ProductsStore to the `products` table. */
/** Wires products.ts's ProductsStore to the `products` table (Supabase) and R2_PUBLIC (image
 *  files) — the same dual-binding pattern as SupabaseCapitalEquipmentStore below, but against the
 *  public bucket rather than the private one, since product images are customer-facing. */
export class SupabaseProductsStore implements ProductsStore {
  constructor(
    private db: SupabaseClient,
    private r2: R2Bucket
  ) {}

  async listProducts(): Promise<ProductRow[]> {
    const { data, error } = await this.db
      .from("products")
      .select(
        "id, sku, name, description, price, stock, category, badge, weight, size, sell, donated, img1, img2, img3, ship_mode, ship_fixed, coming_soon, cogm, launch_date"
      )
      .order("created_at", { ascending: true });
    checkError("listProducts", error);
    return (data ?? []) as ProductRow[];
  }

  async upsertProduct(row: ProductRow): Promise<void> {
    const { error } = await this.db.from("products").upsert(row, { onConflict: "id" });
    checkError("upsertProduct", error);
  }

  async deleteProduct(id: string): Promise<void> {
    const { error } = await this.db.from("products").delete().eq("id", id);
    checkError("deleteProduct", error);
  }

  async deleteAllProducts(): Promise<void> {
    const { error } = await this.db.from("products").delete().not("id", "is", null);
    checkError("deleteAllProducts", error);
  }

  putProductImage(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    return r2Put(this.r2, key, bytes, contentType);
  }
}

/** Wires donations.ts's DonationsStore to the `donations` table. */
export class SupabaseDonationsStore implements DonationsStore {
  constructor(private db: SupabaseClient) {}

  async insertDonation(row: Omit<DonationRow, "id" | "created_at">): Promise<number> {
    const { data, error } = await this.db.from("donations").insert(row).select("id").single();
    checkError("insertDonation", error);
    return (data as { id: number }).id;
  }
  async listDonations(): Promise<DonationRow[]> {
    const { data, error } = await this.db.from("donations").select("*");
    checkError("listDonations", error);
    return (data ?? []) as DonationRow[];
  }
  async deleteDonation(id: number): Promise<void> {
    const { error } = await this.db.from("donations").delete().eq("id", id);
    checkError("deleteDonation", error);
  }
  async productExists(productId: string): Promise<boolean> {
    const { data, error } = await this.db.from("products").select("id").eq("id", productId).maybeSingle();
    checkError("productExists", error);
    return !!data;
  }
}

/** Wires orders.ts's OrdersStore to the `orders` and `order_items` tables. */
export class SupabaseOrdersStore implements OrdersStore {
  constructor(private db: SupabaseClient) {}

  async listOrders(): Promise<OrderRow[]> {
    const { data, error } = await this.db
      .from("orders")
      .select(
        "id, customer_name, customer_email, customer_phone, shipping_address, shipping_carrier, tracking_number, confirm_sent_at, shipping_sent_at, total, payment_method, status, square_payment_id, order_date, created_at, tax_amount, tax_swept_date, order_type, transaction_fee, payment_configuration, check_number, refunded_amount, paypal_capture_id, paypal_surcharge, square_surcharge"
      )
      .order("created_at", { ascending: false });
    checkError("listOrders", error);
    return (data ?? []) as OrderRow[];
  }

  async listOrderItems(): Promise<OrderItemRow[]> {
    const { data, error } = await this.db
      .from("order_items")
      .select("order_id, product_id, product_name, price, quantity");
    checkError("listOrderItems", error);
    return (data ?? []) as OrderItemRow[];
  }

  async getOrder(id: string): Promise<OrderRow | null> {
    const { data, error } = await this.db
      .from("orders")
      .select(
        "id, customer_name, customer_email, customer_phone, shipping_address, shipping_carrier, tracking_number, confirm_sent_at, shipping_sent_at, total, payment_method, status, square_payment_id, order_date, created_at, tax_amount, tax_swept_date, order_type, transaction_fee, payment_configuration, check_number, refunded_amount, paypal_capture_id, paypal_surcharge, square_surcharge"
      )
      .eq("id", id)
      .maybeSingle();
    checkError("getOrder", error);
    return data as OrderRow | null;
  }

  async getOrderItems(id: string): Promise<OrderItemRow[]> {
    const { data, error } = await this.db
      .from("order_items")
      .select("order_id, product_id, product_name, price, quantity")
      .eq("order_id", id);
    checkError("getOrderItems", error);
    return (data ?? []) as OrderItemRow[];
  }

  async claimForProcessing(id: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("orders")
      .update({ status: "Processing" })
      .eq("id", id)
      .eq("status", "Awaiting Payment")
      .select("id");
    checkError("claimForProcessing", error);
    return (data ?? []).length > 0;
  }

  async releaseFromProcessing(id: string): Promise<void> {
    const { error } = await this.db.from("orders").update({ status: "Awaiting Payment" }).eq("id", id).eq("status", "Processing");
    checkError("releaseFromProcessing", error);
  }

  async findOrderByAmount(amountDollars: number): Promise<{ id: string } | null> {
    // PostgREST has no direct ABS(total - x) < 0.01 expression filter, so this widens to a small
    // range instead — equivalent for currency amounts, which never need sub-cent precision.
    const { data, error } = await this.db
      .from("orders")
      .select("id, total")
      .not("status", "in", "(Paid,Cancelled)")
      .gte("total", amountDollars - 0.01)
      .lte("total", amountDollars + 0.01)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    checkError("findOrderByAmount", error);
    return data ? { id: data.id as string } : null;
  }

  async findOrderBySquarePaymentId(value: string): Promise<{ id: string } | null> {
    const { data, error } = await this.db.from("orders").select("id").eq("square_payment_id", value).maybeSingle();
    checkError("findOrderBySquarePaymentId", error);
    return data ? { id: data.id as string } : null;
  }

  async listPaypalCapturedOrders(begin: string, end: string): Promise<OrderRow[]> {
    let query = this.db
      .from("orders")
      .select("id, order_date, created_at, customer_email, payment_method, total, tax_amount, transaction_fee, refunded_amount, paypal_capture_id")
      .not("paypal_capture_id", "is", null)
      .neq("paypal_capture_id", "");
    if (begin) query = query.gte("order_date", begin);
    if (end) query = query.lte("order_date", end);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(500);
    checkError("listPaypalCapturedOrders", error);
    return (data ?? []) as OrderRow[];
  }

  async getTaxAndRefundBySquarePaymentIds(paymentIds: string[]): Promise<Map<string, { tax: number; refunded: number }>> {
    const map = new Map<string, { tax: number; refunded: number }>();
    if (paymentIds.length === 0) return map;
    const { data, error } = await this.db.from("orders").select("square_payment_id, tax_amount, refunded_amount").in("square_payment_id", paymentIds);
    checkError("getTaxAndRefundBySquarePaymentIds", error);
    for (const row of data ?? []) {
      map.set(row.square_payment_id as string, { tax: Number(row.tax_amount ?? 0), refunded: Number(row.refunded_amount ?? 0) });
    }
    return map;
  }

  async getProduct(id: string): Promise<{ name: string; price: number } | null> {
    const { data, error } = await this.db.from("products").select("name, price").eq("id", id).maybeSingle();
    checkError("getProduct", error);
    return data ? { name: data.name, price: Number(data.price) } : null;
  }

  async decrementStock(id: string, qty: number): Promise<boolean> {
    const { data, error } = await this.db.rpc("decrement_stock_if_available", { p_product_id: id, p_qty: qty });
    checkError("decrementStock", error);
    return data === true;
  }

  async restoreStock(id: string, qty: number): Promise<void> {
    const { error } = await this.db.rpc("increment_stock", { p_product_id: id, p_qty: qty });
    checkError("restoreStock", error);
  }

  async insertOrder(order: OrderInsert): Promise<void> {
    const { error } = await this.db.from("orders").insert(order);
    checkError("insertOrder", error);
  }

  async insertOrderItem(item: OrderItemRow): Promise<void> {
    const { error } = await this.db.from("order_items").insert(item);
    checkError("insertOrderItem", error);
  }

  async deleteOrder(id: string): Promise<void> {
    const { error } = await this.db.from("orders").delete().eq("id", id);
    checkError("deleteOrder", error);
  }

  async deleteAllOrders(): Promise<void> {
    // order_items cascades via the FK; deleting every order is enough.
    const { error } = await this.db.from("orders").delete().not("id", "is", null);
    checkError("deleteAllOrders", error);
  }

  async updateOrderFields(id: string, fields: Partial<OrderUpdatableFields>): Promise<void> {
    const { error } = await this.db.from("orders").update(fields).eq("id", id);
    checkError("updateOrderFields", error);
  }

  async findStaleAwaitingOrders(cutoffIso: string): Promise<{ id: string }[]> {
    const { data, error } = await this.db
      .from("orders")
      .select("id")
      .eq("status", "Awaiting Payment")
      .lt("created_at", cutoffIso);
    checkError("findStaleAwaitingOrders", error);
    return (data ?? []) as { id: string }[];
  }

  async getOrderItemsForRestore(orderId: string): Promise<{ product_id: string; quantity: number }[]> {
    const { data, error } = await this.db
      .from("order_items")
      .select("product_id, quantity")
      .eq("order_id", orderId)
      .neq("product_id", "_ship");
    checkError("getOrderItemsForRestore", error);
    return (data ?? []) as { product_id: string; quantity: number }[];
  }

  async getOrderStatus(id: string): Promise<string | null> {
    const { data, error } = await this.db.from("orders").select("status").eq("id", id).maybeSingle();
    checkError("getOrderStatus", error);
    return data?.status ?? null;
  }

  async orderBelongsToEmail(orderId: string, email: string): Promise<boolean> {
    const { data, error } = await this.db.from("orders").select("id").eq("id", orderId).ilike("customer_email", email).maybeSingle();
    checkError("orderBelongsToEmail", error);
    return data !== null;
  }

  async getOrderRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null> {
    const { data, error } = await this.db
      .from("customer_login_attempts")
      .select("attempts, last_at")
      .eq("email_hash", key)
      .maybeSingle();
    checkError("getOrderRateLimit", error);
    return data ? { attempts: Number(data.attempts), lastAt: Number(data.last_at) } : null;
  }

  async setOrderRateLimit(key: string, attempts: number, lastAt: number): Promise<void> {
    const { error } = await this.db
      .from("customer_login_attempts")
      .upsert({ email_hash: key, attempts, last_at: lastAt });
    checkError("setOrderRateLimit", error);
  }
}

/** Wires refunds.ts's RefundsStore to the `refunds` table. */
export class SupabaseRefundsStore implements RefundsStore {
  constructor(private db: SupabaseClient) {}

  async listRefundsForOrder(orderId: string): Promise<RefundRow[]> {
    const { data, error } = await this.db
      .from("refunds")
      .select("id, order_id, amount, reason, method, square_refund_id, status, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false });
    checkError("listRefundsForOrder", error);
    return (data ?? []) as RefundRow[];
  }

  async insertRefund(row: Pick<RefundRow, "order_id" | "amount" | "reason" | "method" | "square_refund_id" | "status">): Promise<void> {
    const { error } = await this.db.from("refunds").insert(row);
    checkError("insertRefund", error);
  }
}

/** Wires db-backup.ts's DbBackupStore to any of BACKUP_TABLES via a generic `select *`. */
export class SupabaseDbBackupStore implements DbBackupStore {
  constructor(private db: SupabaseClient) {}

  async listTableRows(table: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.db.from(table).select("*");
    checkError(`listTableRows(${table})`, error);
    return (data ?? []) as Record<string, unknown>[];
  }
}

/** Wires tax.ts's TaxStore to `tn_city_tax`, `tax_sweeps`, and `orders`. */
export class SupabaseTaxStore implements TaxStore {
  constructor(private db: SupabaseClient) {}

  async listCities(search: string): Promise<TnCityTaxRow[]> {
    let query = this.db.from("tn_city_tax").select("id, city, county, tax_rate").order("city", { ascending: true });
    // .ilike(), not .like() — MySQL's *_ai_ci collation made this search case/accent-insensitive.
    if (search) query = query.or(`city.ilike.%${search}%,county.ilike.%${search}%`);
    const { data, error } = await query;
    checkError("listCities", error);
    return (data ?? []) as TnCityTaxRow[];
  }

  async upsertCity(city: string, county: string, taxRate: number): Promise<void> {
    const { error } = await this.db
      .from("tn_city_tax")
      .upsert({ city, county, tax_rate: taxRate }, { onConflict: "city,county" });
    checkError("upsertCity", error);
  }

  async deleteCity(id: number): Promise<void> {
    const { error } = await this.db.from("tn_city_tax").delete().eq("id", id);
    checkError("deleteCity", error);
  }

  async listPendingTaxOrders(): Promise<PendingTaxOrder[]> {
    const { data, error } = await this.db
      .from("orders")
      .select("id, order_date, tax_amount")
      .gt("tax_amount", 0)
      .is("tax_swept_date", null)
      .order("order_date", { ascending: true });
    checkError("listPendingTaxOrders", error);
    return (data ?? []) as PendingTaxOrder[];
  }

  async listSweeps(): Promise<TaxSweepRow[]> {
    const { data, error } = await this.db
      .from("tax_sweeps")
      .select("*")
      .order("sweep_date", { ascending: false })
      .order("id", { ascending: false });
    checkError("listSweeps", error);
    return (data ?? []) as TaxSweepRow[];
  }

  async insertSweep(sweep: Omit<TaxSweepRow, "id" | "created_at">): Promise<number> {
    const { data, error } = await this.db.from("tax_sweeps").insert(sweep).select("id").single();
    checkError("insertSweep", error);
    return (data as { id: number }).id;
  }

  async markOrdersSwept(orderIds: string[], sweptAt: string): Promise<void> {
    const { error } = await this.db.from("orders").update({ tax_swept_date: sweptAt }).in("id", orderIds);
    checkError("markOrdersSwept", error);
  }

  async updateSweep(id: number, fields: Partial<Pick<TaxSweepRow, "sweep_date" | "total_tax" | "order_count">>): Promise<void> {
    const { error } = await this.db.from("tax_sweeps").update(fields).eq("id", id);
    checkError("updateSweep", error);
  }

  async deleteSweep(id: number): Promise<void> {
    const { error } = await this.db.from("tax_sweeps").delete().eq("id", id);
    checkError("deleteSweep", error);
  }
}

/** Wires subscribers.ts's SubscribersStore to `subscribers` and `rate_limits`. */
export class SupabaseSubscribersStore implements SubscribersStore {
  constructor(private db: SupabaseClient) {}

  async listSubscribers(): Promise<SubscriberRow[]> {
    const { data, error } = await this.db
      .from("subscribers")
      .select("email, subscribed_at")
      .order("subscribed_at", { ascending: false });
    checkError("listSubscribers", error);
    return ((data ?? []) as { email: string; subscribed_at: string }[]).map((r) => ({
      email: r.email,
      date: formatMonthDayYear(r.subscribed_at),
    }));
  }

  async findSubscriber(email: string): Promise<{ source: string | null } | null> {
    const { data, error } = await this.db.from("subscribers").select("source").eq("email", email).maybeSingle();
    checkError("findSubscriber", error);
    return data ? { source: data.source } : null;
  }

  async insertSubscriber(email: string, source: string | null): Promise<void> {
    const { error } = await this.db.from("subscribers").insert({ email, source });
    checkError("insertSubscriber", error);
  }

  async updateSubscriberSourceIfEmpty(email: string, source: string): Promise<void> {
    const { error } = await this.db.from("subscribers").update({ source }).eq("email", email).or("source.is.null,source.eq.");
    checkError("updateSubscriberSourceIfEmpty", error);
  }

  async deleteSubscriber(email: string): Promise<void> {
    const { error } = await this.db.from("subscribers").delete().eq("email", email);
    checkError("deleteSubscriber", error);
  }

  async getRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null> {
    const { data, error } = await this.db.from("rate_limits").select("attempts, last_at").eq("key_hash", key).maybeSingle();
    checkError("getRateLimit", error);
    return data ? { attempts: Number(data.attempts), lastAt: Number(data.last_at) } : null;
  }

  async setRateLimit(key: string, attempts: number, lastAt: number): Promise<void> {
    const { error } = await this.db.from("rate_limits").upsert({ key_hash: key, attempts, last_at: lastAt });
    checkError("setRateLimit", error);
  }
}

/** Ports PHP's DATE_FORMAT(subscribed_at, '%m/%d/%Y'). */
function formatMonthDayYear(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

const CUSTOMER_COLUMNS = "id, first_name, last_name, email, password_hash, phone, sec_question, sec_answer, order_count, joined_at";

/** Wires customers.ts's CustomersStore to the `customers` and `customer_login_attempts` tables. */
export class SupabaseCustomersStore implements CustomersStore {
  constructor(private db: SupabaseClient) {}

  async listCustomers(): Promise<CustomerRow[]> {
    const { data, error } = await this.db.from("customers").select(CUSTOMER_COLUMNS).order("joined_at", { ascending: false });
    checkError("listCustomers", error);
    return (data ?? []) as CustomerRow[];
  }

  async findByEmail(email: string): Promise<CustomerRow | null> {
    const { data, error } = await this.db.from("customers").select(CUSTOMER_COLUMNS).ilike("email", email).maybeSingle();
    checkError("findByEmail", error);
    return data as CustomerRow | null;
  }

  async findById(id: string): Promise<CustomerRow | null> {
    const { data, error } = await this.db.from("customers").select(CUSTOMER_COLUMNS).eq("id", id).maybeSingle();
    checkError("findById", error);
    return data as CustomerRow | null;
  }

  async insertCustomer(row: Omit<CustomerRow, "order_count" | "joined_at">): Promise<void> {
    const { error } = await this.db.from("customers").insert(row);
    checkError("insertCustomer", error);
  }

  async updateCustomerFields(id: string, fields: Partial<Pick<CustomerRow, "first_name" | "last_name" | "email" | "phone">>): Promise<void> {
    const { error } = await this.db.from("customers").update(fields).eq("id", id);
    checkError("updateCustomerFields", error);
  }

  async updatePasswordHash(id: string, hash: string): Promise<void> {
    const { error } = await this.db.from("customers").update({ password_hash: hash }).eq("id", id);
    checkError("updatePasswordHash", error);
  }

  async updateSecAnswer(id: string, hash: string): Promise<void> {
    const { error } = await this.db.from("customers").update({ sec_answer: hash }).eq("id", id);
    checkError("updateSecAnswer", error);
  }

  async incrementOrderCount(email: string): Promise<void> {
    // Read-then-write, not atomic like the stock decrement's RPC — accepted here because a
    // customer's own order_count being off-by-one under concurrent requests (extremely unlikely:
    // it fires once per real, already-placed order) has none of oversell's financial/inventory
    // consequences. Not worth another RPC for a display counter.
    const cust = await this.findByEmail(email);
    if (!cust) return;
    const { error } = await this.db.from("customers").update({ order_count: cust.order_count + 1 }).eq("id", cust.id);
    checkError("incrementOrderCount", error);
  }

  async deleteCustomer(id: string): Promise<void> {
    const { error } = await this.db.from("customers").delete().eq("id", id);
    checkError("deleteCustomer", error);
  }

  async getAttempt(key: string): Promise<{ attempts: number; lastAt: number } | null> {
    const { data, error } = await this.db.from("customer_login_attempts").select("attempts, last_at").eq("email_hash", key).maybeSingle();
    checkError("getAttempt", error);
    return data ? { attempts: Number(data.attempts), lastAt: Number(data.last_at) } : null;
  }

  async setAttempt(key: string, attempts: number, lastAt: number): Promise<void> {
    const { error } = await this.db.from("customer_login_attempts").upsert({ email_hash: key, attempts, last_at: lastAt });
    checkError("setAttempt", error);
  }
}

// ── rate_limits — shared by reviews, contact, and studio-inquiry submission ──
async function getGenericRateLimit(db: SupabaseClient, key: string): Promise<{ attempts: number; lastAt: number } | null> {
  const { data, error } = await db.from("rate_limits").select("attempts, last_at").eq("key_hash", key).maybeSingle();
  checkError("getRateLimit", error);
  return data ? { attempts: Number(data.attempts), lastAt: Number(data.last_at) } : null;
}
async function setGenericRateLimit(db: SupabaseClient, key: string, attempts: number, lastAt: number): Promise<void> {
  const { error } = await db.from("rate_limits").upsert({ key_hash: key, attempts, last_at: lastAt });
  checkError("setRateLimit", error);
}
async function insertEmailLog(
  db: SupabaseClient,
  entry: { emailType: string; sentTo: string; subject: string; status: "sent" | "failed" | "sink"; body: string; orderId?: string }
): Promise<void> {
  const { error } = await db.from("email_log").insert({
    email_type: entry.emailType,
    sent_to: entry.sentTo,
    order_id: entry.orderId ?? "",
    subject: entry.subject,
    status: entry.status,
    email_body: entry.body,
  });
  checkError("insertEmailLog", error);
}

/** Wires content.ts's ReviewsStore to `reviews` and `rate_limits`. */
export class SupabaseReviewsStore implements ReviewsStore {
  constructor(private db: SupabaseClient) {}

  async listReviews(onlyApproved: boolean): Promise<ReviewRow[]> {
    let query = this.db.from("reviews").select("id, customer_name, product_name, rating, review_text, status, created_at").order("created_at", { ascending: false });
    if (onlyApproved) query = query.eq("status", "approved");
    const { data, error } = await query;
    checkError("listReviews", error);
    return (data ?? []) as ReviewRow[];
  }
  async insertReview(row: Pick<ReviewRow, "customer_name" | "product_name" | "rating" | "review_text">): Promise<void> {
    const { error } = await this.db.from("reviews").insert(row);
    checkError("insertReview", error);
  }
  async updateReviewStatus(id: number, status: string): Promise<void> {
    const { error } = await this.db.from("reviews").update({ status }).eq("id", id);
    checkError("updateReviewStatus", error);
  }
  async deleteReview(id: number): Promise<void> {
    const { error } = await this.db.from("reviews").delete().eq("id", id);
    checkError("deleteReview", error);
  }
  getRateLimit(key: string) {
    return getGenericRateLimit(this.db, key);
  }
  setRateLimit(key: string, attempts: number, lastAt: number) {
    return setGenericRateLimit(this.db, key, attempts, lastAt);
  }
}

/** Wires content.ts's FaqsStore to `faqs`. */
export class SupabaseFaqsStore implements FaqsStore {
  constructor(private db: SupabaseClient) {}

  async listFaqs(): Promise<FaqRow[]> {
    const { data, error } = await this.db.from("faqs").select("id, question, answer, sort_order").order("sort_order", { ascending: true }).order("id", { ascending: true });
    checkError("listFaqs", error);
    return (data ?? []) as FaqRow[];
  }
  async insertFaq(row: Pick<FaqRow, "question" | "answer" | "sort_order">): Promise<void> {
    const { error } = await this.db.from("faqs").insert(row);
    checkError("insertFaq", error);
  }
  async updateFaq(id: number, question: string, answer: string): Promise<void> {
    const { error } = await this.db.from("faqs").update({ question, answer }).eq("id", id);
    checkError("updateFaq", error);
  }
  async updateFaqSortOrder(id: number, sortOrder: number): Promise<void> {
    const { error } = await this.db.from("faqs").update({ sort_order: sortOrder }).eq("id", id);
    checkError("updateFaqSortOrder", error);
  }
  async deleteFaq(id: number): Promise<void> {
    const { error } = await this.db.from("faqs").delete().eq("id", id);
    checkError("deleteFaq", error);
  }
}

/** Wires contact.ts's ContactStore to `rate_limits` and `email_log`. */
export class SupabaseContactStore implements ContactStore {
  constructor(private db: SupabaseClient) {}

  getRateLimit(key: string) {
    return getGenericRateLimit(this.db, key);
  }
  setRateLimit(key: string, attempts: number, lastAt: number) {
    return setGenericRateLimit(this.db, key, attempts, lastAt);
  }
  logEmail(entry: { emailType: string; sentTo: string; subject: string; status: "sent" | "failed" | "sink"; body: string }) {
    return insertEmailLog(this.db, entry);
  }
}

/** Wires order-lookup.ts's OrderLookupStore to `order_lookup_requests` (its own dedicated rate
 *  limit table, not the generic `rate_limits` one — matches the original PHP's design, and the
 *  table already existed from migration 0003, just never used) plus `orders`/`order_items`
 *  filtered by email. */
export class SupabaseOrderLookupStore implements OrderLookupStore {
  constructor(private db: SupabaseClient) {}

  async getRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null> {
    const { data, error } = await this.db.from("order_lookup_requests").select("attempts, last_at").eq("email_hash", key).maybeSingle();
    checkError("getRateLimit", error);
    return data ? { attempts: Number(data.attempts), lastAt: Number(data.last_at) } : null;
  }

  async setRateLimit(key: string, attempts: number, lastAt: number): Promise<void> {
    const { error } = await this.db.from("order_lookup_requests").upsert({ email_hash: key, attempts, last_at: lastAt });
    checkError("setRateLimit", error);
  }

  async listOrdersForEmail(email: string): Promise<OrderRow[]> {
    const { data, error } = await this.db
      .from("orders")
      .select(
        "id, customer_name, customer_email, customer_phone, shipping_address, shipping_carrier, tracking_number, confirm_sent_at, shipping_sent_at, total, payment_method, status, square_payment_id, order_date, created_at, tax_amount, tax_swept_date, order_type, transaction_fee, payment_configuration, check_number, refunded_amount, paypal_capture_id, paypal_surcharge, square_surcharge"
      )
      .eq("customer_email", email)
      .order("created_at", { ascending: false });
    checkError("listOrdersForEmail", error);
    return (data ?? []) as OrderRow[];
  }

  async listOrderItemsForOrderIds(orderIds: string[]): Promise<OrderItemRow[]> {
    const { data, error } = await this.db.from("order_items").select("order_id, product_id, product_name, price, quantity").in("order_id", orderIds);
    checkError("listOrderItemsForOrderIds", error);
    return (data ?? []) as OrderItemRow[];
  }
}

/** Wires studio.ts's StudioStore to `studio_items`, `studio_inquiries`, `studio_project_notes`,
 *  `rate_limits`, `email_log`, and R2_PUBLIC (gallery/hero image uploads — same bucket as product
 *  images and biz_profile, since studio content is customer-facing). */
export class SupabaseStudioStore implements StudioStore {
  constructor(
    private db: SupabaseClient,
    private r2: R2Bucket
  ) {}

  async listItems(): Promise<StudioItemRow[]> {
    const { data, error } = await this.db.from("studio_items").select("id, section, title, data, image, sort_order, active, created_at");
    checkError("listItems", error);
    return (data ?? []) as StudioItemRow[];
  }
  async getItem(id: number): Promise<StudioItemRow | null> {
    const { data, error } = await this.db
      .from("studio_items")
      .select("id, section, title, data, image, sort_order, active, created_at")
      .eq("id", id)
      .maybeSingle();
    checkError("getItem", error);
    return (data as StudioItemRow | null) ?? null;
  }
  putImage(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    return r2Put(this.r2, key, bytes, contentType);
  }
  deleteImage(key: string): Promise<void> {
    return r2Delete(this.r2, key);
  }
  async countItemsBySection(section: string): Promise<number> {
    const { count, error } = await this.db.from("studio_items").select("id", { count: "exact", head: true }).eq("section", section);
    checkError("countItemsBySection", error);
    return count ?? 0;
  }
  async insertItem(row: Pick<StudioItemRow, "section" | "title" | "data" | "sort_order">): Promise<number> {
    const { data, error } = await this.db.from("studio_items").insert(row).select("id").single();
    checkError("insertItem", error);
    return (data as { id: number }).id;
  }
  async updateItem(id: number, fields: Partial<Pick<StudioItemRow, "title" | "data" | "image" | "sort_order" | "active">>): Promise<void> {
    const { error } = await this.db.from("studio_items").update(fields).eq("id", id);
    checkError("updateItem", error);
  }
  async updateItemSortOrder(id: number, sortOrder: number): Promise<void> {
    const { error } = await this.db.from("studio_items").update({ sort_order: sortOrder }).eq("id", id);
    checkError("updateItemSortOrder", error);
  }
  async deleteItem(id: number): Promise<void> {
    const { error } = await this.db.from("studio_items").delete().eq("id", id);
    checkError("deleteItem", error);
  }

  async listInquiries(): Promise<StudioInquiryRow[]> {
    const { data, error } = await this.db.from("studio_inquiries").select("*");
    checkError("listInquiries", error);
    return (data ?? []) as StudioInquiryRow[];
  }
  async listAllNotes(): Promise<StudioNoteRow[]> {
    const { data, error } = await this.db.from("studio_project_notes").select("*");
    checkError("listAllNotes", error);
    return (data ?? []) as StudioNoteRow[];
  }
  async insertInquiry(row: Omit<StudioInquiryRow, "id" | "created_at">): Promise<number> {
    const { data, error } = await this.db.from("studio_inquiries").insert(row).select("id").single();
    checkError("insertInquiry", error);
    return (data as { id: number }).id;
  }
  async updateInquiryStatus(id: number, status: string): Promise<void> {
    const { error } = await this.db.from("studio_inquiries").update({ status }).eq("id", id);
    checkError("updateInquiryStatus", error);
  }
  async updateInquiryDueDate(id: number, dueDate: string | null): Promise<void> {
    const { error } = await this.db.from("studio_inquiries").update({ due_date: dueDate }).eq("id", id);
    checkError("updateInquiryDueDate", error);
  }
  async deleteInquiry(id: number): Promise<void> {
    const { error } = await this.db.from("studio_inquiries").delete().eq("id", id);
    checkError("deleteInquiry", error);
  }
  async insertNote(projectId: number, noteText: string): Promise<StudioNoteRow> {
    const { data, error } = await this.db.from("studio_project_notes").insert({ project_id: projectId, note_text: noteText }).select("*").single();
    checkError("insertNote", error);
    return data as StudioNoteRow;
  }
  async deleteNote(id: number): Promise<void> {
    const { error } = await this.db.from("studio_project_notes").delete().eq("id", id);
    checkError("deleteNote", error);
  }

  getRateLimit(key: string) {
    return getGenericRateLimit(this.db, key);
  }
  setRateLimit(key: string, attempts: number, lastAt: number) {
    return setGenericRateLimit(this.db, key, attempts, lastAt);
  }
  logEmail(entry: { emailType: string; sentTo: string; subject: string; status: "sent" | "failed" | "sink"; body: string }) {
    return insertEmailLog(this.db, entry);
  }
}

// ── R2_PRIVATE-backed file storage, shared shape for capital_equipment receipts and business_docs ──
async function r2Put(r2: R2Bucket, key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await r2.put(key, bytes, { httpMetadata: { contentType } });
}
async function r2Get(r2: R2Bucket, key: string): Promise<Uint8Array | null> {
  const obj = await r2.get(key);
  if (!obj) return null;
  return new Uint8Array(await obj.arrayBuffer());
}
async function r2Delete(r2: R2Bucket, key: string): Promise<void> {
  await r2.delete(key);
}

/** Wires business.ts's CapitalEquipmentStore to the `capital_equipment` table (Supabase) and
 *  R2_PRIVATE (receipt files) — the only store in this file backed by two different bindings. */
export class SupabaseCapitalEquipmentStore implements CapitalEquipmentStore {
  constructor(
    private db: SupabaseClient,
    private r2: R2Bucket
  ) {}

  async listItems(): Promise<CapitalEquipmentRow[]> {
    const { data, error } = await this.db
      .from("capital_equipment")
      .select("id, description, purchase_date, purchase_price, receipt_filename, receipt_orig_name, created_at")
      .order("purchase_date", { ascending: false })
      .order("id", { ascending: false });
    checkError("listItems", error);
    return (data ?? []) as CapitalEquipmentRow[];
  }
  async getItem(id: number): Promise<CapitalEquipmentRow | null> {
    const { data, error } = await this.db.from("capital_equipment").select("*").eq("id", id).maybeSingle();
    checkError("getItem", error);
    return data as CapitalEquipmentRow | null;
  }
  async insertItem(description: string, purchaseDate: string, price: number): Promise<number> {
    const { data, error } = await this.db
      .from("capital_equipment")
      .insert({ description, purchase_date: purchaseDate, purchase_price: price })
      .select("id")
      .single();
    checkError("insertItem", error);
    return (data as { id: number }).id;
  }
  async updateItem(id: number, description: string, purchaseDate: string, price: number): Promise<void> {
    const { error } = await this.db.from("capital_equipment").update({ description, purchase_date: purchaseDate, purchase_price: price }).eq("id", id);
    checkError("updateItem", error);
  }
  async deleteItem(id: number): Promise<void> {
    const { error } = await this.db.from("capital_equipment").delete().eq("id", id);
    checkError("deleteItem", error);
  }
  async setReceiptMeta(id: number, filename: string | null, origName: string | null): Promise<void> {
    const { error } = await this.db.from("capital_equipment").update({ receipt_filename: filename, receipt_orig_name: origName }).eq("id", id);
    checkError("setReceiptMeta", error);
  }
  putReceiptFile(key: string, bytes: Uint8Array, contentType: string) {
    return r2Put(this.r2, key, bytes, contentType);
  }
  getReceiptFile(key: string) {
    return r2Get(this.r2, key);
  }
  deleteReceiptFile(key: string) {
    return r2Delete(this.r2, key);
  }
}

/** Wires business.ts's BusinessDocsFileStore to R2_PRIVATE. Metadata lives in `settings` via
 *  SupabaseSettingsStore, already built — this only handles the file bytes. */
export class R2BusinessDocsFileStore implements BusinessDocsFileStore {
  constructor(private r2: R2Bucket) {}

  putReceiptFile(key: string, bytes: Uint8Array, contentType: string) {
    return r2Put(this.r2, key, bytes, contentType);
  }
  getReceiptFile(key: string) {
    return r2Get(this.r2, key);
  }
  deleteReceiptFile(key: string) {
    return r2Delete(this.r2, key);
  }
}

/** Wires ops.ts's EmailLogStore to `email_log`. */
export class SupabaseEmailLogStore implements EmailLogStore {
  constructor(private db: SupabaseClient) {}

  async listEmailLog(filters: { orderId?: string; type?: string }): Promise<EmailLogRow[]> {
    let query = this.db.from("email_log").select("*").order("sent_at", { ascending: false }).limit(500);
    if (filters.orderId) query = query.eq("order_id", filters.orderId);
    if (filters.type) query = query.eq("email_type", filters.type);
    const { data, error } = await query;
    checkError("listEmailLog", error);
    return (data ?? []) as EmailLogRow[];
  }
  async insertEmailLogEntry(entry: { emailType: string; sentTo: string; orderId: string; subject: string; status: string; errorMsg: string | null }): Promise<void> {
    const { error } = await this.db.from("email_log").insert({
      email_type: entry.emailType,
      sent_to: entry.sentTo,
      order_id: entry.orderId,
      subject: entry.subject,
      status: entry.status,
      error_msg: entry.errorMsg,
    });
    checkError("insertEmailLogEntry", error);
  }
  async clearEmailLog(): Promise<void> {
    const { error } = await this.db.from("email_log").delete().not("id", "is", null);
    checkError("clearEmailLog", error);
  }
}

/** Wires app-log.ts's AppLogStore to the `app_log` table (see supabase/migrations/0011_app_log.sql
 *  and app-log.ts's own header for why this table exists at all). */
export class SupabaseAppLogStore implements AppLogStore {
  constructor(private db: SupabaseClient) {}

  async append(file: AppLogFile, entry: { context: string; message: string }): Promise<void> {
    const { error } = await this.db.from("app_log").insert({ file, context: entry.context, message: entry.message });
    checkError("appendAppLog", error);
  }
  async readEntries(file: AppLogFile): Promise<AppLogEntry[]> {
    const { data, error } = await this.db.from("app_log").select("*").eq("file", file).order("logged_at", { ascending: true });
    checkError("readAppLogEntries", error);
    return ((data ?? []) as { logged_at: string; context: string; message: string }[]).map((r) => ({
      loggedAt: r.logged_at,
      context: r.context,
      message: r.message,
    }));
  }
  async clear(file: AppLogFile): Promise<void> {
    const { error } = await this.db.from("app_log").delete().eq("file", file);
    checkError("clearAppLog", error);
  }
}

/** Wires email.ts's EmailOrderStore to `orders`, `order_items` (joined with `products` in JS,
 *  since product_id is deliberately not a real FK), and `email_log`. */
export class SupabaseEmailOrderStore implements EmailOrderStore {
  constructor(private db: SupabaseClient) {}

  async getOrderForConfirmation(orderId: string): Promise<OrderForConfirmation | null> {
    const { data, error } = await this.db
      .from("orders")
      .select("id, customer_email, customer_name, shipping_address, total, tax_amount, order_date, order_type, payment_method, check_number, transaction_fee")
      .eq("id", orderId)
      .maybeSingle();
    checkError("getOrderForConfirmation", error);
    if (!data) return null;
    return {
      ...data,
      total: Number(data.total),
      tax_amount: Number(data.tax_amount),
      transaction_fee: Number(data.transaction_fee),
    } as OrderForConfirmation;
  }

  async getOrderItemsForConfirmation(orderId: string): Promise<OrderItemForConfirmation[]> {
    const { data: items, error } = await this.db.from("order_items").select("product_id, product_name, price, quantity").eq("order_id", orderId);
    checkError("getOrderItemsForConfirmation", error);
    const rows = (items ?? []) as { product_id: string | null; product_name: string | null; price: number; quantity: number }[];

    const productIds = rows.map((r) => r.product_id).filter((id): id is string => !!id && id !== "_ship");
    const productInfo = new Map<string, { img: string | null; sku: string | null }>();
    if (productIds.length > 0) {
      const { data: products, error: prodError } = await this.db.from("products").select("id, img1, sku").in("id", productIds);
      checkError("getOrderItemsForConfirmation(products)", prodError);
      for (const p of (products ?? []) as { id: string; img1: string | null; sku: string | null }[]) {
        productInfo.set(p.id, { img: p.img1, sku: p.sku });
      }
    }

    return rows.map((r) => ({
      product_id: r.product_id,
      product_name: r.product_name,
      price: Number(r.price),
      quantity: Number(r.quantity),
      img: r.product_id ? (productInfo.get(r.product_id)?.img ?? null) : null,
      sku: r.product_id ? (productInfo.get(r.product_id)?.sku ?? null) : null,
    }));
  }

  async stampConfirmSentAt(orderId: string, sentAtIso: string): Promise<void> {
    const { error } = await this.db.from("orders").update({ confirm_sent_at: sentAtIso }).eq("id", orderId);
    checkError("stampConfirmSentAt", error);
  }

  async logEmail(entry: { emailType: string; sentTo: string; orderId: string; subject: string; status: "sent" | "failed" | "sink"; body: string }): Promise<void> {
    const { error } = await this.db.from("email_log").insert({
      email_type: entry.emailType,
      sent_to: entry.sentTo,
      order_id: entry.orderId,
      subject: entry.subject,
      status: entry.status,
      email_body: entry.body,
    });
    checkError("logEmail", error);
  }
}

/** Wires coupons.ts's CouponsStore to `coupons`, `coupon_redemptions`, and the
 *  redeem_coupon_if_available RPC (see supabase/migrations/0012_coupons.sql). */
type CouponCodeWithBatchRow = CouponCodeRow & { coupons: { active: boolean; amount: number; expires_at: string | null } | null };

export class SupabaseCouponsStore implements CouponsStore {
  constructor(private db: SupabaseClient) {}

  async insertBatch(row: Omit<CouponBatchRow, "id" | "used_count">): Promise<number> {
    const { data, error } = await this.db.from("coupons").insert(row).select("id").single();
    checkError("insertBatch", error);
    return (data as { id: number }).id;
  }
  async insertCodes(rows: { code: string; batch_id: number }[]): Promise<void> {
    const { error } = await this.db.from("coupon_codes").insert(rows);
    checkError("insertCodes", error);
  }
  async listBatches(): Promise<CouponBatchRow[]> {
    const { data, error } = await this.db.from("coupon_batch_summary").select("*").order("created_at", { ascending: false });
    checkError("listBatches", error);
    return (data ?? []) as CouponBatchRow[];
  }
  async getBatch(id: number): Promise<CouponBatchRow | null> {
    const { data, error } = await this.db.from("coupon_batch_summary").select("*").eq("id", id).maybeSingle();
    checkError("getBatch", error);
    return data as CouponBatchRow | null;
  }
  async setActive(id: number, active: boolean): Promise<void> {
    const { error } = await this.db.from("coupons").update({ active }).eq("id", id);
    checkError("setActive", error);
  }
  async updateBatch(id: number, fields: { amount: number; expires_at: string | null }): Promise<void> {
    const { error } = await this.db.from("coupons").update(fields).eq("id", id);
    checkError("updateBatch", error);
  }
  async deleteBatch(id: number): Promise<void> {
    const { error } = await this.db.from("coupons").delete().eq("id", id);
    checkError("deleteBatch", error);
  }
  async listCodesByBatch(id: number): Promise<CouponCodeRow[]> {
    const { data, error } = await this.db.from("coupon_codes").select("*").eq("batch_id", id);
    checkError("listCodesByBatch", error);
    return (data ?? []) as CouponCodeRow[];
  }
  async codeExists(code: string): Promise<boolean> {
    const { data, error } = await this.db.from("coupon_codes").select("code").eq("code", code).maybeSingle();
    checkError("codeExists", error);
    return !!data;
  }
  async getCodeForValidation(code: string): Promise<CouponCodeLookup | null> {
    const { data, error } = await this.db.from("coupon_codes").select("code, redeemed_at, coupons(active, amount, expires_at)").eq("code", code).maybeSingle();
    checkError("getCodeForValidation", error);
    const row = data as unknown as CouponCodeWithBatchRow | null;
    if (!row || !row.coupons) return null;
    return { code: row.code, redeemed_at: row.redeemed_at, batch_active: row.coupons.active, batch_amount: Number(row.coupons.amount), batch_expires_at: row.coupons.expires_at };
  }
  async redeemCodeIfAvailable(code: string, orderId: string, email: string | null, discountAmount: number): Promise<{ ok: boolean }> {
    const { data, error } = await this.db
      .rpc("redeem_code_if_available", { p_code: code, p_order_id: orderId, p_email: email, p_discount_amount: discountAmount })
      .maybeSingle();
    checkError("redeemCodeIfAvailable", error);
    const row = data as { ok: boolean } | null;
    return { ok: !!row?.ok };
  }
  async listCodesByEmail(email: string): Promise<CouponCodeRow[]> {
    const { data, error } = await this.db.from("coupon_codes").select("*").eq("customer_email", email);
    checkError("listCodesByEmail", error);
    return (data ?? []) as CouponCodeRow[];
  }
}

/** Wires store-credit.ts's StoreCreditStore to `customers.store_credit_balance`,
 *  `store_credit_transactions`, and the debit_store_credit_if_available RPC (see
 *  supabase/migrations/0012_coupons.sql). Nothing currently deposits into this balance — coupons
 *  are percent-off only — but any pre-existing balance remains spendable via this store. */
export class SupabaseStoreCreditStore implements StoreCreditStore {
  constructor(private db: SupabaseClient) {}

  async debitIfAvailable(email: string, requestedAmount: number): Promise<{ ok: boolean; applied: number }> {
    const { data, error } = await this.db.rpc("debit_store_credit_if_available", { p_email: email, p_requested: requestedAmount }).maybeSingle();
    checkError("debitIfAvailable", error);
    const row = data as { ok: boolean; applied: number } | null;
    return row ? { ok: row.ok, applied: Number(row.applied) } : { ok: false, applied: 0 };
  }
  async insertTransaction(row: Omit<StoreCreditTransactionRow, "id" | "created_at">): Promise<void> {
    const { error } = await this.db.from("store_credit_transactions").insert(row);
    checkError("insertTransaction", error);
  }
  async getBalance(email: string): Promise<number> {
    const { data, error } = await this.db.from("customers").select("store_credit_balance").eq("email", email).maybeSingle();
    checkError("getBalance", error);
    return data ? Number(data.store_credit_balance ?? 0) : 0;
  }
  async listTransactionsByEmail(email: string): Promise<StoreCreditTransactionRow[]> {
    const { data, error } = await this.db.from("store_credit_transactions").select("*").eq("customer_email", email);
    checkError("listTransactionsByEmail", error);
    return (data ?? []) as StoreCreditTransactionRow[];
  }
}
