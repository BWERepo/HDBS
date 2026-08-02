import { describe, it, expect, beforeEach } from "vitest";
import { buildTokens, renderShell, getBizProfile, invalidateBizProfileCache } from "./shell";
import { resolveBizProfile } from "./lib/biz-profile";

const opts = { origin: "https://handmadedesignsbysuzi.com", version: "1.2.3" };

describe("buildTokens", () => {
  it("html-escapes attribute-context values", () => {
    const biz = resolveBizProfile(JSON.stringify({ name: `Suzi's "Bags" & <Co>` }));
    const t = buildTokens(biz, opts);
    expect(t.BIZ_NAME).toBe("Suzi&#39;s &quot;Bags&quot; &amp; &lt;Co&gt;");
  });

  it("converts newlines to <br /> in *_HTML tokens after escaping", () => {
    const biz = resolveBizProfile(JSON.stringify({ hero_headline: "Line one\nLine two" }));
    const t = buildTokens(biz, opts);
    expect(t.BIZ_HERO_HEADLINE_HTML).toBe("Line one<br />\nLine two");
  });

  it("splits the About story into paragraphs on blank lines", () => {
    const biz = resolveBizProfile(JSON.stringify({ about_story: "Para one.\n\nPara two." }));
    const t = buildTokens(biz, opts);
    const story = t.BIZ_ABOUT_STORY_HTML ?? "";
    expect(story).toContain("<p style=");
    expect(story.match(/<p /g)?.length).toBe(2);
    expect(story).toContain("Para one.");
    expect(story).toContain("Para two.");
  });

  it("JSON-embeds without HTML-escaping, matching json_encode()", () => {
    const biz = resolveBizProfile(JSON.stringify({ name: `Suzi's & Co` }));
    const t = buildTokens(biz, opts);
    expect(t.BIZ_NAME_JSON).toBe(JSON.stringify("Suzi's & Co"));
  });

  // version.json is a build-time constant, not a live database row — this token replaces
  // index.html's old PHP-era fetch('/api/admin.php',{action:'get_version'}), which fired a 501 on
  // every page load because get_version was never ported (see this file's header on BIZ_VERSION).
  it("embeds the version as window.BIZ_VERSION, no admin.php round trip needed", () => {
    const biz = resolveBizProfile(null);
    const t = buildTokens(biz, { origin: "https://handmadedesignsbysuzi.com", version: "3.14.0" });
    expect(t.BIZ_VERSION_JSON).toBe(JSON.stringify("3.14.0"));
  });

  it("embeds deployedAt as window.BIZ_DEPLOYED_AT when present", () => {
    const biz = resolveBizProfile(null);
    const t = buildTokens(biz, { ...opts, deployedAt: "2026-08-02T15:00:00.000Z" });
    expect(t.BIZ_DEPLOYED_AT_JSON).toBe(JSON.stringify("2026-08-02T15:00:00.000Z"));
  });

  it("embeds an empty string for BIZ_DEPLOYED_AT when deployedAt is absent", () => {
    const biz = resolveBizProfile(null);
    const t = buildTokens(biz, opts);
    expect(t.BIZ_DEPLOYED_AT_JSON).toBe(JSON.stringify(""));
  });

  it("neutralises a closing </script> inside a JSON-embedded value", () => {
    const biz = resolveBizProfile(JSON.stringify({ name: `</script><script>alert(1)</script>` }));
    const t = buildTokens(biz, opts);
    expect(t.BIZ_NAME_JSON).not.toContain("</script>");
    expect(t.BIZ_NAME_JSON).toContain("\\u003c/script\\u003e");
  });

  it("resolves a root-relative logo path against the request origin", () => {
    const biz = resolveBizProfile(null);
    const t = buildTokens(biz, opts);
    expect(t.BIZ_LOGO).toBe("https://handmadedesignsbysuzi.com/HDBSLogo.jpeg?v=2");
  });

  it("leaves an already-absolute logo URL untouched", () => {
    const biz = resolveBizProfile(JSON.stringify({ logo: "https://cdn.example.com/logo.jpg" }));
    const t = buildTokens(biz, opts);
    expect(t.BIZ_LOGO).toBe("https://cdn.example.com/logo.jpg");
  });

  it("resolves the logo differently per environment origin, so staging never embeds prod's logo", () => {
    const biz = resolveBizProfile(JSON.stringify({ logo: "/business_logo/logo_123.jpg" }));
    const prod = buildTokens(biz, { origin: "https://handmadedesignsbysuzi.com", version: "1.0.0" });
    const staging = buildTokens(biz, { origin: "https://hdbs-staging.example.workers.dev", version: "1.0.0" });
    expect(prod.BIZ_LOGO).toContain("handmadedesignsbysuzi.com");
    expect(staging.BIZ_LOGO).toContain("hdbs-staging.example.workers.dev");
  });

  it("defaults logo dimensions when not supplied", () => {
    const t = buildTokens(resolveBizProfile(null), opts);
    expect(t.BIZ_LOGO_WIDTH).toBe("748");
    expect(t.BIZ_LOGO_HEIGHT).toBe("913");
    expect(t.BIZ_LOGO_MIME).toBe("image/jpeg");
  });
});

describe("renderShell", () => {
  it("substitutes every occurrence of a token", () => {
    const html = "<title>{{BIZ_NAME}}</title><meta content=\"{{BIZ_NAME}}\">";
    const out = renderShell(html, { BIZ_NAME: "Handmade Designs By Suzi" });
    expect(out).toBe("<title>Handmade Designs By Suzi</title><meta content=\"Handmade Designs By Suzi\">");
  });

  it("leaves an unknown token verbatim rather than blanking it", () => {
    const out = renderShell("<p>{{BIZ_UNKNOWN}}</p>", {});
    expect(out).toBe("<p>{{BIZ_UNKNOWN}}</p>");
  });

  it("does not re-substitute a token-shaped string produced by another substitution", () => {
    // If a value itself contains "{{BIZ_EMAIL}}" it must NOT be expanded a second time — this is
    // exactly why substitution is one regex pass over the ORIGINAL html, not repeated replaceAll
    // calls chained together.
    const html = "{{BIZ_NAME}}";
    const out = renderShell(html, { BIZ_NAME: "{{BIZ_EMAIL}}", BIZ_EMAIL: "leaked@example.com" });
    expect(out).toBe("{{BIZ_EMAIL}}");
  });
});

describe("getBizProfile caching", () => {
  beforeEach(() => invalidateBizProfileCache());

  it("calls the loader once and reuses the result within the TTL", async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      return JSON.stringify({ name: "Cached Name" });
    };
    const now = 1_000_000;
    const a = await getBizProfile(load, now);
    const b = await getBizProfile(load, now + 30_000);
    expect(a.name).toBe("Cached Name");
    expect(b.name).toBe("Cached Name");
    expect(calls).toBe(1);
  });

  it("reloads after the TTL expires", async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      return JSON.stringify({ name: `Call ${calls}` });
    };
    const now = 1_000_000;
    await getBizProfile(load, now);
    await getBizProfile(load, now + 61_000);
    expect(calls).toBe(2);
  });

  it("degrades to defaults, not a thrown error, when the loader fails", async () => {
    const load = async () => {
      throw new Error("settings table unreachable");
    };
    const biz = await getBizProfile(load, 2_000_000);
    expect(biz.name).toBe("Handmade Designs By Suzi");
  });
});
