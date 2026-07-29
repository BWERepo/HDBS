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

const app = new Hono<{ Bindings: Env }>();

app.use("*", redirectWwwToApex);
app.use("*", securityHeaders);

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
// arrive at any path and must still receive the shell. Static assets are tried first; anything
// that isn't a real file falls through to index.html.
//
// In Phase 2 this is replaced by src/shell.ts, which additionally substitutes the {{BIZ_*}}
// tokens (business name, email, OG image, JSON-LD) that index.php lines 1-67 render today.
app.all("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404) return res;

  const shellUrl = new URL(c.req.url);
  shellUrl.pathname = "/index.html";
  const shell = await c.env.ASSETS.fetch(new Request(shellUrl, { method: "GET" }));
  if (shell.status === 404) return c.text("Not found", 404);

  return new Response(shell.body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

export default app;
