// Guest order lookup: ports api/order_lookup.php.
//   action=request {email}  -> emails a private link to view orders. Response is ALWAYS generic
//                              (never reveals whether the email has orders — no enumeration).
//   action=view    {token}  -> returns the orders for the email encoded in a valid token.
// The account page uses action=view with the token issued at login; guests get a token by email.
//
// ⚠️ This feature was never actually ported during the Cloudflare migration — the PHP route
// existed, but no Hono route was ever wired up for it (see docs/schema-reconciliation.md finding
// 3, which flagged `order_lookup_requests` as a table that "has never existed in production" and
// left porting this feature as an open question pending user confirmation). That confirmation
// came later, once the storefront's "My Orders" flow was found broken on live production.
//
// Item-grouping (splitting out shipping/coupon/store-credit line items) is NOT reimplemented here
// — it reuses orders.ts's own `mapOrderForResponse`, the same mapping the admin order list uses,
// so a customer's view and the admin's view can never drift out of sync on that logic.

import type { EmailSender } from "./lib/email-sender";
import { makeOrderToken, verifyOrderToken } from "./lib/order-token";
import { mapOrderForResponse, type OrderRow, type OrderItemRow } from "./orders";
import { escapeHtml } from "./lib/html-escape";

export interface OrderLookupResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface CustomerOrderItem {
  name: string | null;
  price: number;
  q: number;
}

export interface CustomerOrder {
  id: string;
  date: string;
  status: string | null;
  total: number;
  tax: number;
  shipping: number;
  pay: string | null;
  carrier: string;
  tracking: string;
  refunded: number;
  addr: string | null;
  items: CustomerOrderItem[];
}

export interface OrderLookupStore {
  getRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null>;
  setRateLimit(key: string, attempts: number, lastAt: number): Promise<void>;
  listOrdersForEmail(email: string): Promise<OrderRow[]>;
  listOrderItemsForOrderIds(orderIds: string[]): Promise<OrderItemRow[]>;
}

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECONDS = 900;
const TOKEN_TTL_SECONDS = 2700; // 45 minutes, matches the original PHP

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Trims the full admin OrderDto (via mapOrderForResponse) to only what a customer should see —
 *  no square_payment_id, no internal fee/swept-date/payment-config fields, same as the original
 *  PHP's customerOrders() trimming. */
function toCustomerOrder(order: OrderRow, items: OrderItemRow[]): CustomerOrder {
  const dto = mapOrderForResponse(order, items);
  return {
    id: dto.id,
    date: dto.date,
    status: dto.status,
    total: dto.total,
    tax: dto.tax,
    shipping: dto.shipping,
    pay: dto.pay,
    carrier: dto.carrier,
    tracking: dto.tracking,
    refunded: dto.refunded_amount,
    addr: dto.addr,
    items: dto.items.map((i) => ({ name: i.name, price: i.price, q: i.q })),
  };
}

/** Ports api/order_lookup.php's inline HTML template, same gold/brown palette as every other
 *  transactional email in this codebase. */
export function buildOrderLookupEmailHtml(bizName: string, link: string): string {
  const b = escapeHtml(bizName);
  const safeLink = escapeHtml(link);
  return `<!DOCTYPE html><html><body style='margin:0;padding:20px;background:#fffdf0;font-family:Arial,sans-serif'>
<div style='max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:#2d2220;padding:22px 28px'><h1 style='color:#d4a017;margin:0;font-size:1.35rem'>${b}</h1></div>
  <div style='padding:28px'>
    <h2 style='color:#a07810;margin-top:0'>View your orders</h2>
    <p>Someone (hopefully you) asked to see the orders placed with this email address. Click below to view them:</p>
    <p style='text-align:center;margin:26px 0'>
      <a href='${safeLink}' style='background:#d4a017;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:700;display:inline-block'>View My Orders</a>
    </p>
    <p style='font-size:.85rem;color:#6b6040'>This link expires in 45 minutes. If you didn't request it, you can safely ignore this email — no one can see your orders without it.</p>
  </div>
  <div style='background:#2d2220;padding:14px 28px;text-align:center'>
    <div style='color:rgba(255,255,255,.6);font-size:.78rem'>${b} &bull; Knoxville, TN</div>
  </div>
</div></body></html>`;
}

/** Ports action=request: emails a private "view my orders" link, rate-limited per email (not per
 *  IP — matches the original PHP), response always generic to avoid revealing whether the email
 *  has any orders. */
export async function requestOrderLookupLink(
  store: OrderLookupStore,
  sender: EmailSender,
  bizName: string,
  email: string,
  origin: string,
  tokenSecret: string,
  rateLimitKey: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<OrderLookupResult<{ message: string }>> {
  const normalized = email.toLowerCase().trim();
  if (!isValidEmail(normalized)) return { ok: false, error: "Please enter a valid email address." };

  const GENERIC_MESSAGE = "If we found orders for that email, we've emailed a link to view them.";

  const row = (await store.getRateLimit(rateLimitKey)) ?? { attempts: 0, lastAt: 0 };
  if (row.attempts >= RATE_LIMIT_MAX && now - row.lastAt < RATE_LIMIT_WINDOW_SECONDS) {
    // Still generic — don't reveal the rate limit either, matching the original.
    return { ok: true, data: { message: GENERIC_MESSAGE } };
  }
  const attempts = row.attempts >= RATE_LIMIT_MAX ? 1 : row.attempts + 1;
  await store.setRateLimit(rateLimitKey, attempts, now);

  const orders = await store.listOrdersForEmail(normalized);
  if (orders.length > 0) {
    const token = await makeOrderToken(normalized, TOKEN_TTL_SECONDS, tokenSecret, now);
    const link = `${origin}/?orders=${encodeURIComponent(token)}`;
    // Failure never surfaces — response stays generic, matching the original PHP's @sendEmail.
    await sender.send(normalized, `View your ${bizName} orders`, buildOrderLookupEmailHtml(bizName, link));
  }

  return { ok: true, data: { message: GENERIC_MESSAGE } };
}

/** Ports action=view: returns the orders for the email encoded in a valid token. */
export async function viewOrdersByToken(
  store: OrderLookupStore,
  token: string,
  tokenSecret: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<OrderLookupResult<{ orders: CustomerOrder[]; email: string }>> {
  const email = await verifyOrderToken(token, tokenSecret, now);
  if (!email) return { ok: false, error: "This link is invalid or has expired. Please request a new one.", status: 403 };

  const orders = await store.listOrdersForEmail(email);
  const items = orders.length > 0 ? await store.listOrderItemsForOrderIds(orders.map((o) => o.id)) : [];
  const customerOrders = orders.map((o) => toCustomerOrder(o, items));

  return { ok: true, data: { orders: customerOrders, email } };
}
