// Square Payments API client: ports the single `sq_curl()`-driven charge call in
// api/process_payment.php. Injected as an interface (same shape as EmailSender in
// email-sender.ts) so payments.ts's business logic stays unit-testable against a fake that never
// makes a real network call.
//
// Sandbox vs. live is no longer a runtime branch on a `square_mode` DB setting (api/paypal.php's
// pp_env()-style host switching) — per this migration's own architecture (src/types.ts's header:
// "Secret NAMES are identical across both Workers; only the values differ"), staging's
// SQUARE_TOKEN/SQUARE_LOCATION_ID secrets simply ARE sandbox credentials, and apiHosts(env)
// already picks the matching base URL from ENVIRONMENT. This also means the PHP's
// SQUARE_SANDBOX_LOCATION_ID override has no equivalent here — there's only ever one location id
// per Worker, which is whichever one the environment's own secret holds.

export interface SquareChargeParams {
  sourceId: string;
  idempotencyKey: string;
  amountCents: number;
  locationId: string;
  note: string;
  buyerEmail: string;
}

export type SquareChargeResult =
  | { ok: true; paymentId: string; status: string }
  | { ok: false; message: string };

export interface SquareGateway {
  charge(params: SquareChargeParams): Promise<SquareChargeResult>;
}

/** Ports process_payment.php's $codeMap exactly, including the fallback chain (mapped message ->
 *  Square's own `detail` -> generic). */
const SQUARE_ERROR_MESSAGES: Record<string, string> = {
  CARD_DECLINED: "Your card was declined. Please try a different card.",
  CVV_FAILURE: "Card security code did not match. Please check and try again.",
  ADDRESS_VERIFICATION_FAILURE: "Billing ZIP code did not match. Please check and try again.",
  CARD_EXPIRED: "Your card has expired. Please use a different card.",
  INSUFFICIENT_FUNDS: "Insufficient funds. Please try a different card.",
  INVALID_CARD: "Invalid card number. Please check and try again.",
  CARD_NOT_SUPPORTED: "This card type is not supported. Please try a different card.",
  UNAUTHORIZED: "Payment configuration error. Please contact us.",
  NOT_FOUND: "Payment configuration error. Please contact us.",
};

export class LiveSquareGateway implements SquareGateway {
  constructor(
    private token: string,
    private baseUrl: string
  ) {}

  async charge(params: SquareChargeParams): Promise<SquareChargeResult> {
    let json: Record<string, unknown> | null;
    try {
      const res = await fetch(`${this.baseUrl}/v2/payments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "Square-Version": "2024-01-18",
        },
        body: JSON.stringify({
          source_id: params.sourceId,
          idempotency_key: params.idempotencyKey,
          amount_money: { amount: params.amountCents, currency: "USD" },
          location_id: params.locationId,
          note: params.note,
          buyer_email_address: params.buyerEmail,
        }),
      });
      json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } catch {
      return { ok: false, message: "Payment failed. Please try again." };
    }

    const payment = json?.payment as { id: string; status: string } | undefined;
    if (!json || !payment) {
      const errors = json?.errors as { code?: string; detail?: string }[] | undefined;
      const errCode = errors?.[0]?.code ?? "";
      const message = SQUARE_ERROR_MESSAGES[errCode] ?? errors?.[0]?.detail ?? "Payment failed. Please try again.";
      return { ok: false, message };
    }
    return { ok: true, paymentId: payment.id, status: payment.status };
  }
}

export function createSquareGateway(token: string, baseUrl: string): SquareGateway {
  return new LiveSquareGateway(token, baseUrl);
}
