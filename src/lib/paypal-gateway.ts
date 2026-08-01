// PayPal Orders v2 API client: ports api/paypal.php's shared OAuth/curl helpers plus the
// create/capture calls from paypal_create.php/paypal_capture.php. Injected as an interface, same
// pattern as square-gateway.ts and email-sender.ts, so payments.ts stays unit-testable.
//
// Sandbox vs. live: same reasoning as square-gateway.ts — no runtime env branch here, the caller
// passes PAYPAL_CLIENT_ID/PAYPAL_SECRET (whichever the Worker's own environment holds) and
// apiHosts(env).paypal for the base URL.

export interface PayPalOrderAmounts {
  subtotal: number;
  shipping: number;
  tax: number;
  surcharge: number;
  total: number;
}

export interface PayPalCreateParams {
  orderId: string;
  description: string;
  amounts: PayPalOrderAmounts;
}

export type PayPalCreateResult = { ok: true; paypalOrderId: string } | { ok: false; message: string };

export interface PayPalCaptureParams {
  paypalOrderId: string;
  requestId: string;
}

export type PayPalCaptureResult =
  | { ok: true; captureId: string; status: string; feeUsd: number; fundingSource: "PayPal" | "Venmo" }
  | { ok: false; message: string };

export interface PayPalRefundParams {
  captureId: string;
  requestId: string;
  amount: number;
  noteToPayer: string;
}

export type PayPalRefundResult = { ok: true; refundId: string; status: string } | { ok: false; message: string };

export interface PayPalGateway {
  createOrder(params: PayPalCreateParams): Promise<PayPalCreateResult>;
  captureOrder(params: PayPalCaptureParams): Promise<PayPalCaptureResult>;
  refundCapture(params: PayPalRefundParams): Promise<PayPalRefundResult>;
  /** Ports paypal_status.php's live credential check: a real OAuth2 token exchange, proving the
   *  configured client id/secret actually work, without ever exposing their values. */
  verifyCredentials(): Promise<boolean>;
}

function money(n: number): string {
  return n.toFixed(2);
}

export class LivePayPalGateway implements PayPalGateway {
  constructor(
    private clientId: string,
    private secret: string,
    private baseUrl: string
  ) {}

  async verifyCredentials(): Promise<boolean> {
    if (!this.clientId || !this.secret) return false;
    return (await this.token()) !== null;
  }

  /** OAuth2 client-credentials token. Returns null on failure — ports pp_token()'s "missing
   *  credentials or a non-200 response both just mean no token" behavior. */
  private async token(): Promise<string | null> {
    if (!this.clientId || !this.secret) return null;
    try {
      const res = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${this.clientId}:${this.secret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as { access_token?: string } | null;
      return json?.access_token ?? null;
    } catch {
      return null;
    }
  }

  async createOrder(params: PayPalCreateParams): Promise<PayPalCreateResult> {
    const token = await this.token();
    if (!token) return { ok: false, message: "PayPal is not configured. Please choose another payment method." };

    const { subtotal, shipping, tax, surcharge, total } = params.amounts;
    let json: Record<string, unknown> | null;
    let status: number;
    try {
      const res = await fetch(`${this.baseUrl}/v2/checkout/orders`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: params.orderId,
              custom_id: params.orderId,
              description: params.description,
              amount: {
                currency_code: "USD",
                value: money(total),
                breakdown: {
                  item_total: { currency_code: "USD", value: money(subtotal) },
                  shipping: { currency_code: "USD", value: money(shipping) },
                  tax_total: { currency_code: "USD", value: money(tax) },
                  handling: { currency_code: "USD", value: money(surcharge) },
                },
              },
            },
          ],
        }),
      });
      status = res.status;
      json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } catch {
      return { ok: false, message: "Could not start PayPal checkout. Please try again." };
    }

    const paypalOrderId = json?.id as string | undefined;
    if ((status !== 200 && status !== 201) || !paypalOrderId) {
      return { ok: false, message: "Could not start PayPal checkout. Please try again." };
    }
    return { ok: true, paypalOrderId };
  }

  async captureOrder(params: PayPalCaptureParams): Promise<PayPalCaptureResult> {
    const token = await this.token();
    if (!token) return { ok: false, message: "PayPal is not configured. Please choose another payment method." };

    let json: Record<string, unknown> | null;
    let status: number;
    try {
      const res = await fetch(`${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(params.paypalOrderId)}/capture`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          // Makes the capture idempotent: a network/UI retry reuses the same request id so PayPal
          // returns the original capture instead of charging twice.
          "PayPal-Request-Id": params.requestId,
        },
        body: "{}",
      });
      status = res.status;
      json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } catch {
      return { ok: false, message: "PayPal payment could not be completed. Please try again." };
    }

    type Capture = { id?: string; status?: string; seller_receivable_breakdown?: { paypal_fee?: { value?: string } } };
    const purchaseUnits = json?.purchase_units as { payments?: { captures?: Capture[] } }[] | undefined;
    const capture = purchaseUnits?.[0]?.payments?.captures?.[0];
    const capStatus = capture?.status ?? "";

    if ((status !== 200 && status !== 201) || !capture || (capStatus !== "COMPLETED" && capStatus !== "PENDING")) {
      const details = json?.details as { description?: string }[] | undefined;
      const message = details?.[0]?.description ?? (json?.message as string | undefined) ?? "PayPal payment could not be completed. Please try again.";
      return { ok: false, message };
    }

    const feeUsd = Number(capture.seller_receivable_breakdown?.paypal_fee?.value ?? 0);
    // Venmo rides the PayPal rail (refunds/settlement identical) but is echoed under
    // payment_source.venmo — labeled distinctly so the admin/emails show what was actually used.
    const paymentSource = json?.payment_source as { venmo?: unknown } | undefined;
    const fundingSource: "PayPal" | "Venmo" = paymentSource?.venmo ? "Venmo" : "PayPal";

    return { ok: true, captureId: capture.id ?? "", status: capStatus, feeUsd, fundingSource };
  }

  async refundCapture(params: PayPalRefundParams): Promise<PayPalRefundResult> {
    const token = await this.token();
    if (!token) return { ok: false, message: "PayPal is not configured — cannot process refund." };

    let json: Record<string, unknown> | null;
    let status: number;
    try {
      const res = await fetch(`${this.baseUrl}/v2/payments/captures/${encodeURIComponent(params.captureId)}/refund`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": params.requestId,
        },
        body: JSON.stringify({
          amount: { value: money(params.amount), currency_code: "USD" },
          note_to_payer: params.noteToPayer.slice(0, 250),
        }),
      });
      status = res.status;
      json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } catch {
      return { ok: false, message: "PayPal refund failed: network error" };
    }

    const refundId = json?.id as string | undefined;
    if ((status !== 200 && status !== 201) || !refundId) {
      const details = json?.details as { description?: string }[] | undefined;
      const message = details?.[0]?.description ?? (json?.message as string | undefined) ?? "Unknown PayPal error";
      return { ok: false, message: `PayPal refund failed: ${message}` };
    }
    return { ok: true, refundId, status: (json?.status as string | undefined) ?? "COMPLETED" };
  }
}

export function createPaypalGateway(clientId: string, secret: string, baseUrl: string): PayPalGateway {
  return new LivePayPalGateway(clientId, secret, baseUrl);
}
