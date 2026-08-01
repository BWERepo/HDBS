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
import type { OrdersStore, OrderRow, OrderItemRow, OrderInsert, OrderUpdatableFields } from "./orders";
import type { TaxStore, TnCityTaxRow, PendingTaxOrder, TaxSweepRow } from "./tax";
import type { SubscribersStore, SubscriberRow } from "./subscribers";
import type { CustomersStore, CustomerRow } from "./customers";
import type { ReviewsStore, ReviewRow, FaqsStore, FaqRow } from "./content";
import type { ContactStore } from "./contact";
import type { StudioStore, StudioItemRow, StudioInquiryRow, StudioNoteRow } from "./studio";

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

/** Wires orders.ts's OrdersStore to the `orders` and `order_items` tables. */
export class SupabaseOrdersStore implements OrdersStore {
  constructor(private db: SupabaseClient) {}

  async listOrders(): Promise<OrderRow[]> {
    const { data, error } = await this.db
      .from("orders")
      .select(
        "id, customer_name, customer_email, customer_phone, shipping_address, shipping_carrier, tracking_number, confirm_sent_at, shipping_sent_at, total, payment_method, status, square_payment_id, order_date, created_at, tax_amount, tax_swept_date, order_type, transaction_fee, payment_configuration, check_number, refunded_amount, paypal_capture_id, paypal_surcharge"
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

/** Wires studio.ts's StudioStore to `studio_items`, `studio_inquiries`, `studio_project_notes`,
 *  `rate_limits`, and `email_log`. */
export class SupabaseStudioStore implements StudioStore {
  constructor(private db: SupabaseClient) {}

  async listItems(): Promise<StudioItemRow[]> {
    const { data, error } = await this.db.from("studio_items").select("id, section, title, data, image, sort_order, active, created_at");
    checkError("listItems", error);
    return (data ?? []) as StudioItemRow[];
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
