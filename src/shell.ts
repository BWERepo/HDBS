// Renders the storefront shell: fetches public/index.html from Workers Static Assets and
// substitutes the {{BIZ_*}} tokens that scripts/generate-shell.mjs put there.
//
// This replaces index.php's server-rendered head. It exists for one reason: social scrapers and
// search engines do not run JavaScript, so the business name, OG image, and JSON-LD must be in the
// HTML as delivered. Everything else about the page is client-rendered and always was.

import type { Env } from "./types";
import { escapeHtml } from "./lib/html-escape";
import { resolveBizProfile, type BizProfile } from "./lib/biz-profile";

/** PHP's nl2br() default output is `<br />`. Escape first, then insert breaks. */
function nl2br(s: string): string {
  return escapeHtml(s).replace(/(\r\n|\n\r|\n|\r)/g, "<br />$1");
}

/**
 * Embed a string in a JSON/JS context, as index.php's json_encode() calls did.
 *
 * `</script` is broken up because these values land inside <script> blocks (the JSON-LD block and
 * the window.BIZ_* line). Without it, a business name containing "</script>" would close the tag
 * early and turn admin-editable text into an XSS vector. PHP's json_encode does not escape `/`
 * by default either, so this is a deliberate hardening of the original, not a port of it.
 */
function jsonEmbed(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

/**
 * Reproduces index.php:61-63 — split the About story on blank lines and wrap each paragraph in a
 * styled <p>. The inline style is copied verbatim; it is not in a stylesheet.
 */
function renderAboutStory(story: string): string {
  return story
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map(
      (p) =>
        `<p style="color:#4a3f35;line-height:1.9;font-size:.95rem;margin-bottom:1.2rem">${nl2br(p)}</p>`
    )
    .join("");
}

/**
 * Make a possibly-relative media path absolute against the requesting origin.
 *
 * og:image and twitter:image must be absolute URLs — many scrapers will not resolve a relative
 * one. index.php satisfied that by hardcoding the production domain (line 17), which is also why
 * staging embedded production's logo. Deriving it from the request instead means each environment
 * advertises its own assets, and there is no hardcoded hostname left in the shell.
 */
function absolutise(pathOrUrl: string, origin: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return origin.replace(/\/$/, "") + (pathOrUrl.startsWith("/") ? pathOrUrl : "/" + pathOrUrl);
}

export interface ShellOptions {
  /** Origin of the incoming request, used to absolutise OG image URLs. */
  origin: string;
  /** From version.json, rendered into window.BIZ_VERSION for the footer version lines. */
  version: string;
  /** From version.json's `deployedAt` (stamped by scripts/stamp-deploy-time.mjs immediately before
   *  every real deploy), rendered into window.BIZ_DEPLOYED_AT. ISO string; absent on a `wrangler
   *  dev` build that never ran the stamp script, in which case the footer omits the deploy time
   *  rather than showing something misleading. */
  deployedAt?: string;
  /**
   * Intrinsic logo dimensions for og:image:width/height.
   *
   * index.php:20-24 called getimagesize() on the logo file on EVERY page load to get these — a
   * synchronous filesystem read per request. There is no equivalent in a Worker (the logo lives in
   * R2), and the values only matter as a hint to scrapers. Defaults are the known dimensions of
   * the stock HDBSLogo.jpeg; Phase 3 can persist real dimensions into biz_profile at upload time,
   * which is strictly better than measuring on every request.
   */
  logoWidth?: number;
  logoHeight?: number;
  logoMime?: string;
}

export function buildTokens(biz: BizProfile, opts: ShellOptions): Record<string, string> {
  const logoAbs = absolutise(biz.logo, opts.origin);

  return {
    // htmlspecialchars() equivalents — safe in both attributes and element text.
    BIZ_NAME: escapeHtml(biz.name),
    BIZ_SHORT_NAME: escapeHtml(biz.short_name),
    BIZ_EMAIL: escapeHtml(biz.email),
    BIZ_LOGO: escapeHtml(logoAbs),
    BIZ_HERO: escapeHtml(absolutise(biz.hero_image, opts.origin)),
    BIZ_ABOUT_TITLE: escapeHtml(biz.about_title),
    BIZ_ABOUT_HEADER: escapeHtml(biz.about_header),
    BIZ_ABOUT_PICTURE: escapeHtml(biz.about_picture),
    BIZ_ABOUT_SUBHEADING: escapeHtml(biz.about_subheading),
    BIZ_ABOUT_QUOTE: escapeHtml(biz.about_quote),
    BIZ_COPYRIGHT: escapeHtml(biz.copyright_statement),
    BIZ_WEBSITE_BY: escapeHtml(biz.website_by),
    BIZ_WEBSITE_BY_EMAIL: escapeHtml(biz.website_by_email),

    // nl2br(htmlspecialchars()) equivalents — admin-entered text where line breaks are meaningful.
    BIZ_HERO_OVERLINE_HTML: nl2br(biz.hero_overline),
    BIZ_HERO_HEADLINE_HTML: nl2br(biz.hero_headline),
    BIZ_HERO_COPY_HTML: nl2br(biz.hero_copy),
    BIZ_ABOUT_SHORT_HTML: nl2br(biz.about_short),
    BIZ_ABOUT_STORY_HTML: renderAboutStory(biz.about_story),

    // json_encode() equivalents — JSON-LD and the window.BIZ_* globals. NOT html-escaped.
    BIZ_NAME_JSON: jsonEmbed(biz.name),
    BIZ_SHORT_NAME_JSON: jsonEmbed(biz.short_name),
    BIZ_EMAIL_JSON: jsonEmbed(biz.email),
    BIZ_LOGO_JSON: jsonEmbed(logoAbs),
    // The half of this design that was never finished: `version` has been accepted as a
    // ShellOptions field since Phase 2, but nothing ever turned it into a token, so
    // public/index.html's leftover PHP-era `fetch('/api/admin.php',{action:'get_version'})` script
    // (never a {{TOKEN}} site, so scripts/generate-shell.mjs had no reason to touch it) kept firing
    // on every page load against an action that was never ported — a 501 on every single visit.
    // Completing the intended design: version.json is a build-time constant, not something that
    // needs a live round trip, so index.html now reads window.BIZ_VERSION directly instead.
    BIZ_VERSION_JSON: jsonEmbed(opts.version),
    // Deploy timestamp shown after the version in the footer (public/index.html formats it
    // client-side as EST). Empty string, not omitted, when absent — window.BIZ_DEPLOYED_AT must
    // always exist so the footer script's `||` fallback doesn't need a `typeof` check.
    BIZ_DEPLOYED_AT_JSON: jsonEmbed(opts.deployedAt ?? ""),

    // Numeric / literal.
    BIZ_LOGO_WIDTH: String(opts.logoWidth ?? 748),
    BIZ_LOGO_HEIGHT: String(opts.logoHeight ?? 913),
    BIZ_LOGO_MIME: escapeHtml(opts.logoMime ?? "image/jpeg"),
  };
}

/**
 * Substitute every {{TOKEN}}.
 *
 * Done in ONE regex pass rather than a chain of replaceAll calls, so that a substituted value
 * containing something that looks like a token cannot itself be re-substituted. Admin-editable
 * text reaches these values, so that is a real (if unlikely) injection path.
 *
 * An unknown token is left verbatim rather than blanked — a visible `{{BIZ_WHATEVER}}` on the page
 * is a far better failure mode than silently losing content, and the smoke suite asserts no
 * `{{` survives in a rendered response.
 */
export function renderShell(html: string, tokens: Record<string, string>): string {
  return html.replace(/\{\{([A-Z_]+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name]! : match
  );
}

// ── Cached biz_profile ──
// Module scope persists across requests within a Worker isolate, so this is a per-isolate cache
// with a short TTL — the same memoisation idea as BusinessWebExpress's lazy server entry. It keeps
// the storefront from issuing a settings query on every single page view, which is what index.php
// did (it opened a MySQL connection per request just to read this one row).
let cached: { profile: BizProfile; at: number } | null = null;
const TTL_MS = 60_000;

export function invalidateBizProfileCache(): void {
  cached = null;
}

/**
 * Fetch and cache the biz_profile row.
 *
 * `load` is injected rather than importing the DB client directly, so this stays unit-testable and
 * so Phase 2 can run with no database at all: passing a loader that returns null yields the full
 * default profile, which is exactly the Phase 2 milestone (real chrome, no data).
 */
export async function getBizProfile(
  load: () => Promise<string | null>,
  now: number = Date.now()
): Promise<BizProfile> {
  if (cached && now - cached.at < TTL_MS) return cached.profile;
  let raw: string | null = null;
  try {
    raw = await load();
  } catch {
    // A settings read failure must not take the storefront down; index.php degraded to defaults
    // here too. Serving the page with default copy beats serving a 500.
  }
  const profile = resolveBizProfile(raw);
  cached = { profile, at: now };
  return profile;
}

/** Fetch public/index.html from Static Assets and render it. */
export async function renderStorefront(
  env: Env,
  request: Request,
  load: () => Promise<string | null>,
  version: string,
  deployedAt?: string
): Promise<Response | null> {
  const url = new URL(request.url);
  url.pathname = "/index.html";
  url.search = "";

  const assetRes = await env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
  if (!assetRes.ok) return null;

  const [html, biz] = await Promise.all([assetRes.text(), getBizProfile(load)]);
  const origin = new URL(request.url).origin;
  const rendered = renderShell(html, buildTokens(biz, { origin, version, deployedAt }));

  return new Response(rendered, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
