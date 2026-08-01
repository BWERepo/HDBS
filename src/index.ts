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

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    environment: c.env.ENVIRONMENT,
    // Phase 0 marker. Once src/db.ts exists this grows a Supabase reachability check, which is
    // what the deploy skills actually gate on.
    phase: 0,
  })
);

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
    const shell = await renderStorefront(c.env, c.req.raw, load, version.version);
    if (shell) return shell;
  }

  // A fresh GET request is built rather than forwarding c.req.raw as-is: with run_worker_first
  // enabled, re-fetching the ASSETS binding with the exact incoming Request object 500'd in local
  // dev (`wrangler dev`) with no logged error — a plain GET avoids whatever that request carries
  // that the local asset server chokes on. Confirmed against a real request, not assumed.
  const res = await c.env.ASSETS.fetch(new Request(c.req.url, { method: "GET" }));
  if (res.status !== 404) return res;

  const shell = await renderStorefront(c.env, c.req.raw, load, version.version);
  return shell ?? c.text("Not found", 404);
});

export default app;
