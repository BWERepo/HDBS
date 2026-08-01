// Order confirmation email: ports send_confirm.php ("Resend order confirmation email from
// admin"). This is the template api/orders.php's createOrder() actually calls for its
// in-person-paid confirmation (via a curl to send_confirm.php in the PHP) — NOT
// api/order_confirm_email.php's sendOrderConfirmation(), which is a separate, simpler template
// used only by the Square/PayPal payment processors (process_payment.php/paypal_capture.php),
// neither of which exist yet. That one is deferred alongside payments.
//
// notify.php (internal "New Order Received" alert to Suzi) and order_confirm.php (a third,
// client-triggered variant) are also deferred — both are secondary to the customer-facing
// confirmation, and their actual triggers (a completed live payment) don't exist yet either.

import type { EmailSender } from "./lib/email-sender";
import { spliceLogoHeader } from "./lib/email-format";

export interface OrderForConfirmation {
  id: string;
  customer_email: string | null;
  customer_name: string | null;
  shipping_address: string | null;
  total: number;
  tax_amount: number;
  order_date: string | null;
  order_type: string | null;
  payment_method: string | null;
  check_number: string | null;
  transaction_fee: number;
}

export interface OrderItemForConfirmation {
  product_id: string | null;
  product_name: string | null;
  price: number;
  quantity: number;
  img: string | null;
  sku: string | null;
}

export interface EmailResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface EmailOrderStore {
  getOrderForConfirmation(orderId: string): Promise<OrderForConfirmation | null>;
  getOrderItemsForConfirmation(orderId: string): Promise<OrderItemForConfirmation[]>;
  stampConfirmSentAt(orderId: string, sentAtIso: string): Promise<void>;
  logEmail(entry: { emailType: string; sentTo: string; orderId: string; subject: string; status: "sent" | "failed" | "sink"; body: string }): Promise<void>;
}

const ADMIN_INBOX = "handmadedesignsbysuzi@yahoo.com";

/** Ports send_confirm.php's HTML template: order summary, item table with thumbnails/SKUs, and
 *  full cost breakdown (subtotal/shipping/tax/fee/total). */
export function buildOrderConfirmationEmailHtml(
  bizName: string,
  bizEmail: string,
  order: OrderForConfirmation,
  items: OrderItemForConfirmation[]
): string {
  // website_url is read from biz_profile in the PHP, but that field is never actually captured
  // anywhere in the admin UI (BizProfile has no such field) — it is, in practice, always the
  // hardcoded fallback. Using that fallback directly rather than plumbing through a field that's
  // never set is not a behavior change, just skipping a detour to the same value.
  const bizUrl = "https://handmadedesignsbysuzi.com";
  const bizUrlDisplay = bizUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

  const firstName = (order.customer_name ?? "").trim().split(" ")[0] ?? "";
  const address = order.shipping_address ?? "";

  let itemsHtml = "";
  let itemTotal = 0;
  let shipping = 0;
  for (const item of items) {
    if (item.product_id === "_ship") {
      shipping = item.price;
      continue;
    }
    const lineTotal = item.price * item.quantity;
    itemTotal += lineTotal;
    const thumb =
      item.img && item.img.startsWith("http")
        ? `<img src='${item.img}' width='48' height='48' style='object-fit:cover;border-radius:6px;border:1px solid #e8e0b8'>`
        : "<div style='width:48px;height:48px;background:#fdf3d0;border-radius:6px;text-align:center;line-height:48px'>&#128092;</div>";
    const skuHtml = item.sku ? `<div style='font-size:11px;color:#a07810;font-family:monospace'>${item.sku}</div>` : "";
    itemsHtml += `<tr>
          <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;vertical-align:middle'>
            <div style='display:flex;align-items:center;gap:10px'>${thumb}<div><div style='font-weight:600'>${item.product_name ?? ""}</div>${skuHtml}</div></div></td>
          <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:center'>${item.quantity}</td>
          <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:right'>$${item.price.toFixed(2)}</td>
          <td style='padding:8px 12px;border-bottom:1px solid #f0e8d0;text-align:right;font-weight:700;color:#a07810'>$${lineTotal.toFixed(2)}</td>
        </tr>`;
  }

  const shipStr = shipping > 0 ? `$${shipping.toFixed(2)}` : "Free";
  const taxStr = `$${order.tax_amount.toFixed(2)}`;
  const totStr = `$${order.total.toFixed(2)}`;
  const fee = order.transaction_fee;
  const feeRow =
    fee > 0
      ? `<tr><td colspan='3' style='padding:6px 12px;text-align:right;color:#6b6040'>Transaction Fee</td><td style='padding:6px 12px;text-align:right'>$${fee.toFixed(2)}</td></tr>`
      : "";
  const checkRow = order.check_number
    ? `<div style='display:inline-block;width:33%;vertical-align:top;font-size:13px;line-height:1.5;margin-bottom:10px'><span style='color:#a07810;font-size:.7rem;font-weight:700;text-transform:uppercase'>Check #</span><br>${order.check_number}</div>`
    : "";
  const addressBlock = address
    ? `<div style='margin-bottom:20px'><div style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase;margin-bottom:6px'>Shipping To</div><div style='background:#fffdf0;border:1px solid #e8e0b8;border-radius:8px;padding:12px'>${address}</div></div>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset='UTF-8'></head>
<body style='margin:0;padding:20px;background:#fffdf0;font-family:Arial,sans-serif'>
<div style='max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e8e0b8'>
  <div style='background:#a07810;padding:28px;text-align:center'>
    <h1 style='color:#fff;margin:0;font-size:1.4rem'>${bizName}</h1>
    <p style='color:#fdf3d0;margin:.4rem 0 0;font-size:.9rem'>Order Confirmation</p>
  </div>
  <div style='padding:28px'>
    <p>Hi ${firstName}! &#127864;</p>
    <p>Thank you so much for your order! Your bag is being prepared with care.</p>
    <div style='background:#fffdf0;border-radius:8px;padding:16px;margin:20px 0;border:1px solid #e8e0b8'>
      <div style='font-size:0;line-height:0'>
        <div style='display:inline-block;width:33%;vertical-align:top;font-size:13px;line-height:1.5;margin-bottom:10px'><span style='color:#a07810;font-size:.7rem;font-weight:700;text-transform:uppercase'>Order ID</span><br><strong>${order.id}</strong></div>
        <div style='display:inline-block;width:33%;vertical-align:top;font-size:13px;line-height:1.5;margin-bottom:10px'><span style='color:#a07810;font-size:.7rem;font-weight:700;text-transform:uppercase'>Date</span><br>${order.order_date ?? ""}</div>
        <div style='display:inline-block;width:33%;vertical-align:top;font-size:13px;line-height:1.5;margin-bottom:10px'><span style='color:#a07810;font-size:.7rem;font-weight:700;text-transform:uppercase'>Order Type</span><br>${order.order_type ?? "Online"}</div>
        <div style='display:inline-block;width:33%;vertical-align:top;font-size:13px;line-height:1.5;margin-bottom:10px'><span style='color:#a07810;font-size:.7rem;font-weight:700;text-transform:uppercase'>Paid By</span><br>${order.payment_method ?? "—"}</div>
        ${checkRow}
        <div style='display:inline-block;width:33%;vertical-align:top;font-size:13px;line-height:1.5;margin-bottom:10px'><span style='color:#a07810;font-size:.7rem;font-weight:700;text-transform:uppercase'>Total Paid</span><br><strong style='color:#a07810;font-size:1.05rem'>${totStr}</strong></div>
      </div>
    </div>
    ${addressBlock}
    <div style='color:#a07810;font-size:.75rem;font-weight:700;text-transform:uppercase;margin-bottom:8px'>Your Order</div>
    <table style='width:100%;border-collapse:collapse;font-size:.9rem;table-layout:fixed;word-wrap:break-word'>
      <thead><tr style='background:#fffdf0'>
        <th style='padding:8px 12px;text-align:left;border-bottom:2px solid #e8e0b8;color:#a07810'>Item</th>
        <th style='padding:8px 12px;text-align:center;border-bottom:2px solid #e8e0b8;color:#a07810'>Qty</th>
        <th style='padding:8px 12px;text-align:right;border-bottom:2px solid #e8e0b8;color:#a07810'>Price</th>
        <th style='padding:8px 12px;text-align:right;border-bottom:2px solid #e8e0b8;color:#a07810'>Subtotal</th>
      </tr></thead>
      <tbody>${itemsHtml}</tbody>
      <tfoot>
        <tr><td colspan='3' style='padding:6px 12px;text-align:right;color:#6b6040'>Subtotal</td><td style='padding:6px 12px;text-align:right'>$${itemTotal.toFixed(2)}</td></tr>
        <tr><td colspan='3' style='padding:6px 12px;text-align:right;color:#6b6040'>Shipping</td><td style='padding:6px 12px;text-align:right'>${shipStr}</td></tr>
        <tr><td colspan='3' style='padding:6px 12px;text-align:right;color:#6b6040'>Sales Tax</td><td style='padding:6px 12px;text-align:right'>${taxStr}</td></tr>
${feeRow}
        <tr style='border-top:2px solid #e8e0b8'><td colspan='3' style='padding:10px 12px;text-align:right;font-weight:700'>Total</td><td style='padding:10px 12px;text-align:right;font-weight:700;color:#a07810;font-size:1.1rem'>${totStr}</td></tr>
      </tfoot>
    </table>
    <p style='margin-top:24px;color:#6b6040'>Thank you for supporting my little handmade business!</p>
    <p><em style='color:#a07810'>— Susan &#127864;</em></p>
    <div style='margin-top:20px;padding-top:16px;border-top:1px solid #e8e0b8;font-size:.8rem;color:#6b6040;text-align:center'>
      <div>Website: <a href='${bizUrl}' style='color:#a07810;text-decoration:underline'>${bizUrlDisplay}</a></div>
      <div>Email: <a href='mailto:${bizEmail}' style='color:#a07810;text-decoration:underline'>${bizEmail}</a></div>
    </div>
  </div>
</div></body></html>`;
}

export interface SendConfirmationOptions {
  preview?: boolean;
}

/**
 * Ports send_confirm.php's whole action: fetch order + items, build the email, and either
 * preview it (no send, no log — but still logo-spliced, matching the PHP's
 * `_emailLogoHeader($html)` call in the preview branch) or send + log + stamp confirm_sent_at.
 */
export async function sendOrderConfirmationEmail(
  store: EmailOrderStore,
  sender: EmailSender,
  bizName: string,
  bizEmail: string,
  orderId: string,
  options: SendConfirmationOptions = {},
  now: Date = new Date()
): Promise<EmailResult<{ to: string; preview?: boolean; html?: string; subject?: string }>> {
  if (!orderId) return { ok: false, error: "Missing order_id" };

  const order = await store.getOrderForConfirmation(orderId);
  if (!order) return { ok: false, error: "Order not found" };

  const items = await store.getOrderItemsForConfirmation(orderId);
  const html = buildOrderConfirmationEmailHtml(bizName, bizEmail, order, items);
  const subject = `Your Order from ${bizName} - #${orderId}`;

  const noCustEmail = !order.customer_email || order.customer_email.trim() === "";
  const recipients = noCustEmail ? [ADMIN_INBOX] : [order.customer_email!, ADMIN_INBOX];

  if (options.preview) {
    return { ok: true, data: { preview: true, html: spliceLogoHeader(html), subject, to: noCustEmail ? ADMIN_INBOX : order.customer_email! } };
  }

  const result = await sender.send(recipients, subject, html);
  const logTo = noCustEmail ? "admin-only" : order.customer_email!;

  await store.stampConfirmSentAt(orderId, now.toISOString());
  await store.logEmail({ emailType: "Order Confirmation", sentTo: logTo, orderId, subject: `Order Confirmation - #${orderId}`, status: result.status, body: result.html });

  return { ok: result.sent, error: result.sent ? undefined : String(result.status), data: { to: logTo } };
}
