// HDBS Worker entry point.
//
// Phase 0 scaffold: middleware, health, and the SPA catch-all are wired; the /api/* route
// modules land in Phases 3-7. The live PHP site on Hostinger is untouched and remains
// authoritative until the Phase 9 cutover.
//
// Route-path rule: every endpoint keeps its existing /api/<name> path. That is not cosmetic —
// the Square and PayPal webhook subscriptions are registered against those URLs, and Square's
// webhook signature is computed over notificationUrl + body. Changing a path means re-creating
// the subscription, which issues a NEW signature key and 401s every webhook until the secret is
// rotated.

import { Hono } from "hono";
import type { Env } from "./types";
import { securityHeaders, redirectWwwToApex } from "./lib/security-headers";
import { cors } from "./lib/cors";
import { timingSafeEqual } from "./lib/http";
import { adminRoute } from "./routes/admin";
import { productsRoute } from "./routes/products";
import { ordersRoute } from "./routes/orders";
import { taxRoute } from "./routes/tax";
import { subscribersRoute } from "./routes/subscribers";
import { customersRoute } from "./routes/customers";
import { contentRoute } from "./routes/content";
import { contactRoute } from "./routes/contact";
import { studioRoute } from "./routes/studio";
import { businessRoute } from "./routes/business";
import { opsRoute } from "./routes/ops";
import { emailRoute } from "./routes/email";
import { mediaRoute } from "./routes/media";
import { paymentsRoute } from "./routes/payments";
import { refundsRoute } from "./routes/refunds";
import { paymentReportsRoute } from "./routes/payment-reports";
import { productsCsvRoute } from "./routes/products-csv";
import { shippingTrackingRoute } from "./routes/shipping-tracking";
import { githubLogRoute } from "./routes/github-log";
import { repoStatsRoute } from "./routes/repo-stats";
import { dbBackupRoute } from "./routes/db-backup";
import { renderStorefront } from "./shell";
import { createDb, SupabaseSettingsStore } from "./db";
import version from "../version.json";

const app = new Hono<{ Bindings: Env }>();

app.use("*", redirectWwwToApex);
app.use("*", securityHeaders);
app.use("/api/*", cors);
app.route("/", adminRoute);
app.route("/", productsRoute);
app.route("/", ordersRoute);
app.route("/", taxRoute);
app.route("/", subscribersRoute);
app.route("/", customersRoute);
app.route("/", contentRoute);
app.route("/", contactRoute);
app.route("/", studioRoute);
app.route("/", businessRoute);
app.route("/", opsRoute);
app.route("/", emailRoute);
app.route("/", mediaRoute);
app.route("/", paymentsRoute);
app.route("/", refundsRoute);
app.route("/", paymentReportsRoute);
app.route("/", productsCsvRoute);
app.route("/", shippingTrackingRoute);
app.route("/", githubLogRoute);
app.route("/", repoStatsRoute);
app.route("/", dbBackupRoute);

// Legacy bookmarks and cached links — carried over from .htaccess lines 8-10.
app.get("/index.html", (c) => c.redirect("/", 301));

// The Supabase reachability check the Phase 0 stub always promised. Built during the DR
// consolidation (DR_CONSOLIDATION_PLAN.md in the BusinessWebExpress repo) after a staging cutover
// burned several deploy cycles on a wrong SUPABASE_URL/KEY pair that could only be diagnosed by
// tailing the Worker: `wrangler secret put` is write-only, so nothing could report which project
// the Worker was actually talking to. This answers that in one request.
//
// The public response stays deliberately thin — `ok` and `environment` only. Everything that
// identifies infrastructure (Supabase host, schema, the driving error text) requires SMOKE_TOKEN
// via X-Smoke-Token. That secret has been declared in Env since Phase 0 for exactly this purpose
// and currently has no consumer; this is it. An anonymous caller learns whether the site is
// healthy, which is all a health check owes the public.
app.get("/api/health", async (c) => {
  const supplied = c.req.header("X-Smoke-Token") ?? "";
  const detailed = supplied !== "" && timingSafeEqual(supplied, c.env.SMOKE_TOKEN ?? "");

  let dbOk = false;
  let dbError: string | null = null;
  try {
    // Cheapest round trip that still proves all three things at once: the key authenticates, the
    // schema resolves, and the grants allow a read.
    //
    // NOT `{ head: true }`, which is otherwise the natural choice here. A HEAD request has no
    // response body, so supabase-js has no JSON to parse and hands back an error whose `message`
    // is empty — the check still fails correctly but reports nothing about why. That cost a deploy
    // cycle during the DR cutover: "db unreachable … error=" is a worse diagnostic than no
    // diagnostic, because it looks like the check itself is broken. One row is cheap; keep it.
    const { error } = await createDb(c.env).from("settings").select("key_name").limit(1);
    if (error) dbError = `${error.code ?? "?"}: ${error.message || "(no message)"}${error.hint ? ` hint=${error.hint}` : ""}`;
    else dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  // On failure, put the same three facts into the Worker log, where `wrangler tail` can reach them
  // without SMOKE_TOKEN. Deliberately host-only and error-only: enough to tell "wrong project"
  // from "wrong schema" from "wrong key" at a glance, with no secret material. This is exactly the
  // information whose absence made the DR staging cutover a guessing game.
  if (!dbOk) {
    console.error(
      `health: db unreachable host=${safeHost(c.env.SUPABASE_URL)} schema=${c.env.SUPABASE_DB_SCHEMA ?? "public"} error=${dbError}`
    );
  }

  return c.json({
    ok: dbOk,
    environment: c.env.ENVIRONMENT,
    ...(detailed
      ? {
          schema: c.env.SUPABASE_DB_SCHEMA ?? "public",
          // Host only, never the key. The project ref is the one fact that disambiguates "which
          // project is this Worker pointed at" — the question that was unanswerable above.
          supabaseHost: safeHost(c.env.SUPABASE_URL),
          dbError,
        }
      : {}),
  });
});

/** Host of a URL, or a marker — never throws, so even a malformed secret yields a usable answer. */
function safeHost(raw: string | undefined): string {
  if (!raw) return "(unset)";
  try {
    return new URL(raw).host;
  } catch {
    return "(unparseable)";
  }
}

// ── SPA catch-all ──
// The admin back office routes client-side on the #/admin hash, so a deep link or a refresh can
// arrive at any path and must still receive the rendered shell, not the raw static file.
//
// ⚠️ index.html must NEVER be served directly by the ASSETS binding. Static Assets resolves "/"
// (and "/index.html") straight to the file with a 200, which means a naive "try ASSETS first,
// fall back to the shell on 404" check — the first version of this route — never reaches the
// renderer for the one file that actually needs rendering. The token substitution silently never
// ran and every {{BIZ_*}} placeholder shipped to the browser verbatim. Caught by an actual local
// request, not by the unit tests, which only exercised renderShell() in isolation and had no way
// to notice it was never being called.
//
// So: any path that would resolve to index.html (the document routes, "/" and "/index.html",
// PLUS every path with no file extension, since that is what the SPA's hash router expects for
// deep links like /admin or /store) is rendered explicitly and unconditionally. Everything else
// goes through ASSETS first and only falls back to the shell on a genuine 404.
function wantsShell(pathname: string): boolean {
  if (pathname === "/" || pathname === "/index.html") return true;
  const lastSegment = pathname.split("/").pop() ?? "";
  return !lastSegment.includes(".");
}

app.all("*", async (c) => {
  const load = () => new SupabaseSettingsStore(createDb(c.env), c.env.R2_PUBLIC).getSetting("biz_profile");

  if (wantsShell(new URL(c.req.url).pathname)) {
    const shell = await renderStorefront(c.env, c.req.raw, load, version.version, version.deployedAt);
    if (shell) return shell;
  }

  // A fresh GET request is built rather than forwarding c.req.raw as-is: with run_worker_first
  // enabled, re-fetching the ASSETS binding with the exact incoming Request object 500'd in local
  // dev (`wrangler dev`) with no logged error — a plain GET avoids whatever that request carries
  // that the local asset server chokes on. Confirmed against a real request, not assumed.
  const res = await c.env.ASSETS.fetch(new Request(c.req.url, { method: "GET" }));
  if (res.status !== 404) return res;

  const shell = await renderStorefront(c.env, c.req.raw, load, version.version, version.deployedAt);
  return shell ?? c.text("Not found", 404);
});

export default app;
