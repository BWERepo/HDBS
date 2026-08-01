// Order listing: ports api/orders.php's GET action (admin-only order list with grouped line
// items). Written against a small store interface, exactly like auth.ts/settings.ts/products.ts —
// fully unit-tested against an in-memory fake, becomes real the moment src/db.ts's real store
// exists for it.
//
// Deliberately NOT ported in this pass: POST (create order), PUT (update), DELETE. Order creation
// carries stock-decrement transactions, a per-IP rate limit, and a cancel-token HMAC that needs
// ORDER_TOKEN_SECRET (replacing the DB_PASS-keyed HMAC per the migration plan's Auth section) —
// genuinely payment-adjacent logic that deserves its own careful pass, not a rider on a read
// endpoint. requireAdmin gating for GET is left to the route, same as products.ts.

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
}

const SHIP_PRODUCT_ID = "_ship";

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

// ── In-memory test double ──
export class OrdersStoreFake implements OrdersStore {
  orders: OrderRow[] = [];
  items: OrderItemRow[] = [];

  async listOrders(): Promise<OrderRow[]> {
    return this.orders;
  }
  async listOrderItems(): Promise<OrderItemRow[]> {
    return this.items;
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
