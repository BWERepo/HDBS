// Worker bindings and environment.
//
// Every value here is set per-Worker, replacing api/config.php's single
// `stripos($_SERVER['HTTP_HOST'], 'staging')` check — which drove the DB name, the DB user, the
// secrets file path, ALLOWED_ORIGIN, and error display all at once. Config is now explicit, so a
// request arriving on an unexpected hostname cannot flip the app into the wrong mode.
//
// Secret NAMES are identical across both Workers; only the values differ (sandbox vs live).
// scripts/check-secret-parity.sh depends on that, and it is what lets the Square/PayPal base URL
// be chosen from ENVIRONMENT instead of a family of `if ($__staging)` branches.

export interface Env {
  // ── Bindings ──
  ASSETS: Fetcher;
  R2_PUBLIC: R2Bucket;
  R2_PRIVATE: R2Bucket;

  // ── Vars (wrangler.jsonc) ──
  ENVIRONMENT: "production" | "staging";
  /** "live" calls Resend; "sink" renders and logs the email but never sends. */
  EMAIL_MODE: "live" | "sink";
  /** Optional: on staging, allow real sends but only ever to this one address. */
  EMAIL_SINK_OVERRIDE?: string;
  /**
   * Postgres schema this Worker's tables live in. Part of the DR consolidation that collapses
   * the three Supabase projects into one (see the BusinessWebExpress repo's
   * DR_CONSOLIDATION_PLAN.md): each site-per-environment gets its own schema in a single project.
   * Optional, and db.ts falls back to "public" — so a Worker deployed without the var keeps
   * reading the schema it always did rather than silently pointing at a different site's data.
   */
  SUPABASE_DB_SCHEMA?: string;

  // ── Secrets (wrangler secret put) ──
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  /** Replaces the DB_PASS-keyed HMAC in api/order_token.php, orders.php and customers.php. */
  ORDER_TOKEN_SECRET: string;
  /** Gates GET /api/smoke. Compared in constant time, as the PHP did with hash_equals. */
  SMOKE_TOKEN: string;

  SQUARE_TOKEN: string;
  SQUARE_APP_ID: string;
  SQUARE_LOCATION_ID: string;
  SQUARE_WEBHOOK_SIG_KEY: string;

  PAYPAL_CLIENT_ID: string;
  PAYPAL_SECRET: string;

  USPS_CONSUMER_KEY: string;
  USPS_CONSUMER_SECRET: string;

  // Switched from Resend to Brevo 2026-08-01 — see src/lib/email-sender.ts's header for why.
  BREVO_API_KEY: string;
}

export type AppBindings = { Bindings: Env };

/** Square and PayPal API hosts, chosen by environment rather than by a per-call-site branch. */
export function apiHosts(env: Env) {
  const live = env.ENVIRONMENT === "production";
  return {
    square: live ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com",
    paypal: live ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
  };
}
