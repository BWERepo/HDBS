// USPS Tracking API (v3) client: ports api/usps.php's shared OAuth2 + tracking-lookup helpers.
// Same injection pattern as square-gateway.ts/paypal-gateway.ts. Unlike Square/PayPal, USPS has
// no sandbox tracking data reachable with this app's product tier (see api/usps.php's own header)
// — this is a read-only lookup with no side effects, so both staging and prod call the real API
// with real credentials; there is no sandbox/live URL split to resolve per-environment here.

export type UspsTrackResult =
  | { ok: true; found: true; status: string; statusCategory: string }
  | { ok: true; found: false; message: string }
  | { ok: false; error: "not_configured" | "auth_failed" | "network_error" };

export interface UspsGateway {
  isConfigured(): boolean;
  trackNumber(trackingNumber: string): Promise<UspsTrackResult>;
}

const USPS_API_BASE = "https://apis.usps.com";

export class LiveUspsGateway implements UspsGateway {
  constructor(
    private consumerKey: string,
    private consumerSecret: string
  ) {}

  isConfigured(): boolean {
    // Ports usps_creds()'s placeholder guard: a key/secret still containing "_HERE" is treated
    // as unset, same as an actually-empty value.
    return !!this.consumerKey && !!this.consumerSecret && !this.consumerKey.includes("_HERE") && !this.consumerSecret.includes("_HERE");
  }

  private async token(): Promise<string | null> {
    if (!this.isConfigured()) return null;
    try {
      const res = await fetch(`${USPS_API_BASE}/oauth2/v3/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: this.consumerKey, client_secret: this.consumerSecret, grant_type: "client_credentials" }),
      });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as { access_token?: string } | null;
      return json?.access_token ?? null;
    } catch {
      return null;
    }
  }

  async trackNumber(trackingNumber: string): Promise<UspsTrackResult> {
    if (!this.isConfigured()) return { ok: false, error: "not_configured" };

    const token = await this.token();
    if (!token) return { ok: false, error: "auth_failed" };

    let res: Response;
    let json: Record<string, unknown> | null;
    try {
      res = await fetch(`${USPS_API_BASE}/tracking/v3/tracking/${encodeURIComponent(trackingNumber.trim())}?expand=DETAIL`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } catch {
      return { ok: false, error: "network_error" };
    }

    if (res.status === 200 && json?.trackingNumber) {
      return { ok: true, found: true, status: (json.status as string | undefined) ?? "", statusCategory: (json.statusCategory as string | undefined) ?? "" };
    }
    // USPS returns 4xx with an error body for unrecognized/invalid tracking numbers.
    if (res.status >= 400 && res.status < 500) {
      const error = json?.error as { message?: string } | undefined;
      const message = error?.message ?? (json?.message as string | undefined) ?? "";
      return { ok: true, found: false, message: message || "Not found in USPS's system" };
    }
    return { ok: false, error: "network_error" };
  }
}

export function createUspsGateway(consumerKey: string, consumerSecret: string): UspsGateway {
  return new LiveUspsGateway(consumerKey, consumerSecret);
}
