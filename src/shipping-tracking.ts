// Shipping tracking validation: ports api/validate_tracking.php. Client-side format checks
// already cover UPS/FedEx/Other; only USPS has a live API here (src/lib/usps-gateway.ts).

import type { UspsGateway, UspsTrackResult } from "./lib/usps-gateway";

export interface TrackingResultDto {
  number: string;
}

export interface ValidateTrackingResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

const MAX_NUMBERS_PER_REQUEST = 10;

export interface ValidateTrackingInput {
  carrier?: string;
  numbers?: unknown;
}

/** Ports api/validate_tracking.php in full: validates the request shape, then looks up each
 *  tracking number (capped at 10 per request) against the live USPS API. */
export async function validateTracking(
  gateway: UspsGateway,
  input: ValidateTrackingInput
): Promise<ValidateTrackingResult<{ configured: boolean; results: (TrackingResultDto & UspsTrackResult)[] }>> {
  const carrier = (input.carrier ?? "").trim();
  const numbers = (Array.isArray(input.numbers) ? input.numbers : [])
    .map((n) => String(n).trim())
    .filter((n) => n !== "");

  if (carrier !== "USPS") return { ok: false, error: "Only USPS supports live validation" };
  if (numbers.length === 0) return { ok: false, error: "No tracking numbers provided" };

  if (!gateway.isConfigured()) return { ok: true, data: { configured: false, results: [] } };

  const results: (TrackingResultDto & UspsTrackResult)[] = [];
  for (const number of numbers.slice(0, MAX_NUMBERS_PER_REQUEST)) {
    results.push({ number, ...(await gateway.trackNumber(number)) });
  }

  return { ok: true, data: { configured: true, results } };
}

// ── Test double ──
export class FakeUspsGateway implements UspsGateway {
  configured = true;
  results = new Map<string, UspsTrackResult>();
  defaultResult: UspsTrackResult = { ok: true, found: true, status: "Delivered", statusCategory: "Delivered" };
  calls: string[] = [];

  isConfigured(): boolean {
    return this.configured;
  }
  async trackNumber(trackingNumber: string): Promise<UspsTrackResult> {
    this.calls.push(trackingNumber);
    return this.results.get(trackingNumber) ?? this.defaultResult;
  }
}
