// Orders: ports api/orders.php's GET (admin-only list with grouped line items), POST (create),
// PUT (update), and DELETE (single/all) actions. Written against a small store interface, exactly
// like auth.ts/settings.ts/products.ts — fully unit-tested against an in-memory fake, becomes real
// the moment src/db.ts's real store exists for it. requireAdmin gating is left to the route, same
// as products.ts.
//
// ── No real multi-table transaction ──
// The PHP wraps order + item inserts + stock decrements in one MySQL transaction, rolling back
// everything on any failure (e.g. item 3 of 4 is out of stock). PostgREST has no client-side
// multi-statement transaction — each REST call commits independently. Rather than move this
// business logic into a stored procedure (which would duplicate trust-boundary/pricing logic in
// two languages and break the pattern this whole migration follows), createOrder performs an
// explicit compensating rollback on partial failure: delete the order (cascades to any order_items
// already inserted, per the FK) and restore stock for any items already decremented. End state is
// the same as a real rollback; the mechanism is application-level instead of database-level.
//
// ── Atomic stock arithmetic ──
// supabase/migrations/0010_stock_adjustment_functions.sql adds decrement_stock_if_available/
// increment_stock — PostgREST can't express "stock = stock - $1 WHERE stock >= $1" as a plain
// column update, so that one piece of arithmetic (and only that piece) lives in a Postgres
// function, called via RPC. Everything else stays in this file.
//
// ── Cancel token ──
// Ports the migration plan's Auth-section guidance for the DB_PASS-keyed HMAC at
// api/orders.php:222: replaced with ORDER_TOKEN_SECRET, domain-separated ("cancel:" prefix), and
// NOT truncated to 24 hex chars like the original — every existing cancel token is already
// invalidated by the secret change regardless of length, so there's no added migration cost to
// also fixing the truncation the plan calls out as a general issue with this HMAC pattern.

export interface OrderRow {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  shipping_address: string | null;
  shipping_carrier: string | null;
  tracking_number: string | null;
  confirm_sent_at: string | null;
  shipping_sent_at: string | null;
  total: number | null;
  payment_method: string | null;
  status: string | null;
  square_payment_id: string | null;
  order_date: string | null;
  created_at: string | null;
  tax_amount: number | null;
  tax_swept_date: string | null;
  order_type: string | null;
  transaction_fee: number | null;
  payment_configuration: string | null;
  check_number: string | null;
  refunded_amount: number | null;
  paypal_capture_id: string | null;
  paypal_surcharge: number | null;
}

export interface OrderItemRow {
  order_id: string;
  product_id: string | null;
  product_name: string | null;
  price: number | null;
  quantity: number | null;
}

export interface OrderItemDto {
  id: string | null;
  name: string | null;
  price: number;
  q: number;
}

export interface OrderDto {
  id: string;
  date: string;
  time: string;
  cust: string | null;
  email: string | null;
  phone: string | null;
  addr: string | null;
  total: number;
  pay: string | null;
  order_type: string;
  payment_config: string;
  check_number: string;
  fee: number;
  status: string | null;
  refunded_amount: number;
  tax: number;
  swept_date: string | null;
  carrier: string;
  tracking: string;
  confirm_sent: string | null;
  square_payment_id: string | null;
  paypal_surcharge: number;
  shipping_sent: string | null;
  dispDate: string;
  items: OrderItemDto[];
  shipping: number;
  subtotal: number;
}

export interface OrdersStore {
  listOrders(): Promise<OrderRow[]>;
  listOrderItems(): Promise<OrderItemRow[]>;

  getProduct(id: string): Promise<{ name: string; price: number } | null>;
  /** Atomic: true if stock was available and decremented, false if insufficient (no-op on false). */
  decrementStock(id: string, qty: number): Promise<boolean>;
  /** Atomic: always succeeds; used for compensating rollback and stale-order stock reclaim. */
  restoreStock(id: string, qty: number): Promise<void>;

  insertOrder(order: OrderInsert): Promise<void>;
  insertOrderItem(item: OrderItemRow): Promise<void>;
  deleteOrder(id: string): Promise<void>;
  deleteAllOrders(): Promise<void>;
  updateOrderFields(id: string, fields: Partial<OrderUpdatableFields>): Promise<void>;

  /** Orders with status='Awaiting Payment' whose created_at is before `cutoffIso` — see
   *  reclaimStaleOrders' comment for why this compares created_at, not order_date. */
  findStaleAwaitingOrders(cutoffIso: string): Promise<{ id: string }[]>;
  /** Non-shipping line items for one order, for stock restoration during stale cleanup AND for
   *  customers.ts's cancelOrder (same restore-stock-then-cancel shape, different trigger). */
  getOrderItemsForRestore(orderId: string): Promise<{ product_id: string; quantity: number }[]>;
  /** Used by customers.ts's cancelOrder to check the order exists and is still cancellable. */
  getOrderStatus(id: string): Promise<string | null>;
  /** Used by customers.ts's incrementOrderCount — ties the count bump to a real order the caller
   *  just placed, not a bare email, so it can't be used to inflate a stranger's order count. */
  orderBelongsToEmail(orderId: string, email: string): Promise<boolean>;

  /** Ports orders.php's reuse of customer_login_attempts for the per-IP order-creation throttle. */
  getOrderRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null>;
  setOrderRateLimit(key: string, attempts: number, lastAt: number): Promise<void>;
}

export interface OrderItemInput {
  id: string;
  q?: number;
  /** Only honoured when the request is from an admin. */
  price?: number;
}

export interface CreateOrderInput {
  id: string;
  cust?: string;
  email?: string;
  phone?: string;
  addr?: string;
  total: number;
  tax?: number;
  fee?: number;
  pay?: string;
  status?: string;
  date?: string;
  order_type?: string;
  payment_config?: string;
  check_number?: string | null;
  shipping?: number;
  items?: OrderItemInput[];
  /** The storefront sends this literal marker for its own checkout flow; distinguishes a
   *  storefront in-person sale from an admin placing the same kind of order by hand. */
  source?: string;
}

export type OrderInsert = Pick<
  OrderRow,
  | "id"
  | "customer_name"
  | "customer_email"
  | "customer_phone"
  | "shipping_address"
  | "total"
  | "tax_amount"
  | "transaction_fee"
  | "payment_method"
  | "status"
  | "order_date"
  | "order_type"
  | "payment_configuration"
  | "check_number"
>;

export type OrderUpdatableFields = Pick<
  OrderRow,
  | "status"
  | "payment_method"
  | "order_type"
  | "payment_configuration"
  | "check_number"
  | "transaction_fee"
  | "customer_name"
  | "customer_email"
  | "customer_phone"
  | "shipping_address"
  | "total"
  | "tax_amount"
  | "shipping_carrier"
  | "tracking_number"
  | "tax_swept_date"
>;

export interface OrdersResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

const SHIP_PRODUCT_ID = "_ship";
const ORDER_RATE_LIMIT_MAX_ATTEMPTS = 15;
const ORDER_RATE_LIMIT_WINDOW_SECONDS = 3600;
const STALE_ORDER_CUTOFF_SECONDS = 7200;

/** Ports `date('n/j/Y', strtotime($o['order_date']))` — no leading zeros on month/day. */
function formatOrderDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${m}/${d}/${y}`;
}

/** Ports created_at (stored UTC) -> America/New_York -> `g:i A` (e.g. "1:37 PM"). */
function formatOrderTime(createdAt: string | null): string {
  if (!createdAt) return "";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toUpperCase();
  return `${hour}:${minute} ${dayPeriod}`;
}

/** Ports api/orders.php's GET mapping, including the itemMap grouping and shipping/subtotal split. */
export function mapOrderForResponse(order: OrderRow, items: OrderItemRow[]): OrderDto {
  const orderItems = items.filter((i) => i.order_id === order.id);
  const shippingItem = orderItems.find((i) => i.product_id === SHIP_PRODUCT_ID);
  const displayItems = orderItems
    .filter((i) => i.product_id !== SHIP_PRODUCT_ID)
    .map((i) => ({ id: i.product_id, name: i.product_name, price: Number(i.price ?? 0), q: Number(i.quantity ?? 0) }));
  const subtotal = displayItems.reduce((sum, i) => sum + i.price * i.q, 0);

  return {
    id: order.id,
    date: formatOrderDate(order.order_date),
    time: formatOrderTime(order.created_at),
    cust: order.customer_name,
    email: order.customer_email,
    phone: order.customer_phone,
    addr: order.shipping_address,
    total: Number(order.total ?? 0),
    pay: order.payment_method,
    order_type: order.order_type ?? "Online",
    payment_config: order.payment_configuration ?? "Online",
    check_number: order.check_number ?? "",
    fee: Number(order.transaction_fee ?? 0),
    status: order.status,
    refunded_amount: Number(order.refunded_amount ?? 0),
    tax: Number(order.tax_amount ?? 0),
    swept_date: order.tax_swept_date,
    carrier: order.shipping_carrier ?? "USPS",
    tracking: order.tracking_number ?? "",
    confirm_sent: order.confirm_sent_at,
    square_payment_id: order.square_payment_id,
    paypal_surcharge: Number(order.paypal_surcharge ?? 0),
    shipping_sent: order.shipping_sent_at,
    dispDate: formatOrderDate(order.order_date),
    items: displayItems,
    shipping: Number(shippingItem?.price ?? 0),
    subtotal,
  };
}

/** Ports api/orders.php's GET action: every order, newest-first, with grouped line items. */
export async function listOrders(store: OrdersStore): Promise<OrderDto[]> {
  const [orders, items] = await Promise.all([store.listOrders(), store.listOrderItems()]);
  return orders.map((o) => mapOrderForResponse(o, items));
}

/**
 * Ports api/orders.php's stale-order reclaim pass: any order still 'Awaiting Payment' after
 * `STALE_ORDER_CUTOFF_SECONDS` (2h) is cancelled and its non-shipping items' stock restored, so
 * abandoned checkouts can't permanently drain inventory. Runs unconditionally on every order
 * creation attempt in the PHP (admin or guest) — same here.
 *
 * ⚠️ Deliberate correction, not a literal port: the PHP compares `order_date < cutoff`, but
 * `order_date` is a DATE column (no time-of-day) while cutoff is a full timestamp — MySQL
 * compares a DATE against a DATETIME by treating the date as its midnight instant, so this
 * condition is true for essentially every order placed earlier the same day (today's midnight is
 * almost always before "now minus 2 hours"), not just ones truly 2+ hours old. That reads as an
 * accidental near-tautology in the original rather than the intended 2-hour freshness window, so
 * this port compares against `created_at` (a real timestamp) instead, which is what a 2-hour
 * staleness check actually requires.
 */
export async function reclaimStaleOrders(store: OrdersStore, now: Date = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_ORDER_CUTOFF_SECONDS * 1000).toISOString();
  const stale = await store.findStaleAwaitingOrders(cutoff);
  for (const { id } of stale) {
    const items = await store.getOrderItemsForRestore(id);
    for (const item of items) await store.restoreStock(item.product_id, item.quantity);
    await store.updateOrderFields(id, { status: "Cancelled" });
  }
}

async function checkAndRecordOrderRateLimit<T = Record<string, never>>(
  store: OrdersStore,
  key: string,
  now: number
): Promise<OrdersResult<T> | null> {
  const row = (await store.getOrderRateLimit(key)) ?? { attempts: 0, lastAt: 0 };
  if (row.attempts >= ORDER_RATE_LIMIT_MAX_ATTEMPTS && now - row.lastAt < ORDER_RATE_LIMIT_WINDOW_SECONDS) {
    return { ok: false, error: "Too many orders from this network. Please try again later." };
  }
  const attempts = row.attempts >= ORDER_RATE_LIMIT_MAX_ATTEMPTS ? 1 : row.attempts + 1;
  await store.setOrderRateLimit(key, attempts, now);
  return null;
}

/** Domain-separated HMAC-SHA256 cancel token — see this file's header for why it's full-length. */
export async function makeCancelToken(orderId: string, orderTokenSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(orderTokenSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`cancel:${orderId}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Ports api/orders.php's POST action. `rateLimitKey` is the caller's already-hashed per-IP key
 * (the route computes it from the request, matching subscribers.ts's pattern); `onInPersonPaid`
 * is an optional hook for the confirmation email api/orders.php:207-219 fires synchronously —
 * left as a no-op until email.ts exists, since order-creation logic shouldn't hard-depend on it.
 */
export async function createOrder(
  store: OrdersStore,
  input: CreateOrderInput,
  isAdmin: boolean,
  rateLimitKey: string,
  orderTokenSecret: string,
  now: Date = new Date(),
  onInPersonPaid: (orderId: string) => Promise<void> = async () => {}
): Promise<OrdersResult<{ cancel_token: string }>> {
  if (!input.id || !input.total) return { ok: false, error: "Missing order id or total" };

  if (!isAdmin) {
    const limited = await checkAndRecordOrderRateLimit<{ cancel_token: string }>(store, rateLimitKey, Math.floor(now.getTime() / 1000));
    if (limited) return limited;
  }

  await reclaimStaleOrders(store, now);

  const isInPersonPaid =
    input.source === "storefront" && input.payment_config === "InPerson" && (input.pay === "Cash" || input.pay === "Check");
  const status = !isAdmin && !isInPersonPaid ? "Awaiting Payment" : (input.status ?? "Awaiting Payment");

  await store.insertOrder({
    id: input.id,
    customer_name: input.cust ?? "",
    customer_email: input.email ?? "",
    customer_phone: input.phone ?? "",
    shipping_address: input.addr ?? "",
    total: Number(input.total),
    tax_amount: Number(input.tax ?? 0),
    transaction_fee: Number(input.fee ?? 0),
    payment_method: input.pay ?? "Credit Card",
    status,
    // order_date is a DATE column (no time-of-day); default to today rather than a full
    // datetime string, matching what the column actually stores rather than what PHP's literal
    // `date('Y-m-d H:i:s')` default expression produces before MySQL truncates it on insert.
    order_date: input.date ?? now.toISOString().slice(0, 10),
    order_type: input.order_type ?? "Online",
    payment_configuration: input.payment_config ?? "Online",
    check_number: input.check_number ?? null,
  });

  const decremented: { id: string; qty: number }[] = [];
  const rollback = async () => {
    for (const d of decremented) await store.restoreStock(d.id, d.qty);
    await store.deleteOrder(input.id);
  };

  const shipping = Number(input.shipping ?? 0);
  if (shipping > 0) {
    await store.insertOrderItem({ order_id: input.id, product_id: SHIP_PRODUCT_ID, product_name: "Shipping", price: shipping, quantity: 1 });
  }

  for (const item of input.items ?? []) {
    if (!item.id || item.id === SHIP_PRODUCT_ID) continue;
    const qty = Number(item.q ?? 1);
    const product = await store.getProduct(item.id);
    if (!product) {
      await rollback();
      return { ok: false, error: `Failed to save order: Unknown product: ${item.id}`, status: 500 };
    }
    const price = isAdmin && item.price !== undefined ? Number(item.price) : product.price;
    await store.insertOrderItem({ order_id: input.id, product_id: item.id, product_name: product.name, price, quantity: qty });

    const decrementedOk = await store.decrementStock(item.id, qty);
    if (!decrementedOk) {
      await rollback();
      return { ok: false, error: `Failed to save order: Item is out of stock: ${product.name}`, status: 500 };
    }
    decremented.push({ id: item.id, qty });
  }

  if (isInPersonPaid) await onInPersonPaid(input.id);

  return { ok: true, data: { cancel_token: await makeCancelToken(input.id, orderTokenSecret) } };
}

/** Ports api/orders.php's PUT action. Caller must have already required admin. */
export async function updateOrder(store: OrdersStore, id: string, fields: Partial<OrderUpdatableFields>): Promise<OrdersResult> {
  if (!id) return { ok: false, error: "Missing id" };
  if (Object.keys(fields).length > 0) await store.updateOrderFields(id, fields);
  return { ok: true };
}

/** Ports api/orders.php's DELETE action (single order). Caller must have already required admin. */
export async function deleteOrder(store: OrdersStore, id: string): Promise<OrdersResult> {
  if (!id) return { ok: false, error: "Missing id or delete_all flag" };
  await store.deleteOrder(id);
  return { ok: true };
}

/** Ports api/orders.php's DELETE action (delete_all flag). Caller must have already required admin. */
export async function deleteAllOrders(store: OrdersStore): Promise<OrdersResult> {
  await store.deleteAllOrders();
  return { ok: true };
}

// ── In-memory test double ──
export class OrdersStoreFake implements OrdersStore {
  orders: OrderRow[] = [];
  items: OrderItemRow[] = [];
  products = new Map<string, { name: string; price: number; stock: number }>();
  orderRateLimits = new Map<string, { attempts: number; lastAt: number }>();

  async listOrders(): Promise<OrderRow[]> {
    return this.orders;
  }
  async listOrderItems(): Promise<OrderItemRow[]> {
    return this.items;
  }

  async getProduct(id: string): Promise<{ name: string; price: number } | null> {
    const p = this.products.get(id);
    return p ? { name: p.name, price: p.price } : null;
  }
  async decrementStock(id: string, qty: number): Promise<boolean> {
    const p = this.products.get(id);
    if (!p || p.stock < qty) return false;
    p.stock -= qty;
    return true;
  }
  async restoreStock(id: string, qty: number): Promise<void> {
    const p = this.products.get(id);
    if (p) p.stock += qty;
  }

  async insertOrder(order: OrderInsert): Promise<void> {
    // Simulates the real column's `default now()` — created_at isn't part of OrderInsert since
    // the real DB stamps it automatically on insert.
    this.orders.unshift(makeOrderRow({ ...order, created_at: new Date().toISOString() }));
  }
  async insertOrderItem(item: OrderItemRow): Promise<void> {
    this.items.push(item);
  }
  async deleteOrder(id: string): Promise<void> {
    this.orders = this.orders.filter((o) => o.id !== id);
    this.items = this.items.filter((i) => i.order_id !== id); // mirrors the real FK's ON DELETE CASCADE
  }
  async deleteAllOrders(): Promise<void> {
    this.orders = [];
    this.items = []; // cascade
  }
  async updateOrderFields(id: string, fields: Partial<OrderUpdatableFields>): Promise<void> {
    const order = this.orders.find((o) => o.id === id);
    if (order) Object.assign(order, fields);
  }

  async findStaleAwaitingOrders(cutoffIso: string): Promise<{ id: string }[]> {
    return this.orders
      .filter((o) => o.status === "Awaiting Payment" && o.created_at !== null && o.created_at < cutoffIso)
      .map((o) => ({ id: o.id }));
  }
  async getOrderItemsForRestore(orderId: string): Promise<{ product_id: string; quantity: number }[]> {
    return this.items
      .filter((i) => i.order_id === orderId && i.product_id !== SHIP_PRODUCT_ID)
      .map((i) => ({ product_id: i.product_id!, quantity: Number(i.quantity ?? 0) }));
  }
  async getOrderStatus(id: string): Promise<string | null> {
    return this.orders.find((o) => o.id === id)?.status ?? null;
  }
  async orderBelongsToEmail(orderId: string, email: string): Promise<boolean> {
    return this.orders.some((o) => o.id === orderId && o.customer_email?.toLowerCase() === email.toLowerCase());
  }

  async getOrderRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null> {
    return this.orderRateLimits.get(key) ?? null;
  }
  async setOrderRateLimit(key: string, attempts: number, lastAt: number): Promise<void> {
    this.orderRateLimits.set(key, { attempts, lastAt });
  }
}

export function makeOrderRow(overrides: Partial<OrderRow> & Pick<OrderRow, "id">): OrderRow {
  return {
    customer_name: null,
    customer_email: null,
    customer_phone: null,
    shipping_address: null,
    shipping_carrier: null,
    tracking_number: null,
    confirm_sent_at: null,
    shipping_sent_at: null,
    total: 0,
    payment_method: null,
    status: null,
    square_payment_id: null,
    order_date: null,
    created_at: null,
    tax_amount: 0,
    tax_swept_date: null,
    order_type: "Online",
    transaction_fee: 0,
    payment_configuration: "Online",
    check_number: null,
    refunded_amount: 0,
    paypal_capture_id: null,
    paypal_surcharge: 0,
    ...overrides,
  };
}
