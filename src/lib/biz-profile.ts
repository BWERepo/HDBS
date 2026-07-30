// The biz_profile settings row, and the fallback defaults for every field it can supply.
//
// This is the direct port of index.php lines 1-63. Those 63 lines were the ENTIRE server-rendered
// surface of the site: read one JSON row from the settings table, and interpolate ~19 values into
// meta tags, JSON-LD, window.BIZ_* globals, and a handful of visible page elements (hero copy, the
// About teaser, the multi-paragraph About story, the footers).
//
// ⚠️ The defaults below are load-bearing and must stay byte-identical to the PHP, because
// js/admin-business.js carries its own copies as BIZ_HERO_*_DEFAULT / BIZ_ABOUT_*_DEFAULT
// constants and compares against them to decide whether an admin has overridden a field. If these
// drift, the admin UI will show a field as "customised" when it is not, or vice versa.
// index.php lines 30 and 47 both call this out explicitly.

export interface BizProfile {
  name: string;
  short_name: string;
  email: string;
  logo: string;
  hero_image: string;
  hero_overline: string;
  hero_headline: string;
  hero_copy: string;
  copyright_statement: string;
  website_by: string;
  website_by_email: string;
  about_title: string;
  about_header: string;
  about_short: string;
  about_story: string;
  about_picture: string;
  about_subheading: string;
  about_quote: string;
}

/** Defaults transcribed from index.php lines 4-60. Do not reword. */
export const BIZ_DEFAULTS: Omit<BizProfile, "copyright_statement"> = {
  // api/config.php:232 — bizName() falls back to this if biz_profile is unset or corrupt.
  name: "Handmade Designs By Suzi",
  short_name: "By Suzi",
  email: "handmadedesignsbysuzi@yahoo.com",

  // index.php:17 hardcoded the production domain here. Now a root-relative path, absolutised
  // per-request against the requesting origin (see resolveShellValues) so that staging embeds its
  // own logo rather than fetching production's.
  logo: "/HDBSLogo.jpeg?v=2",
  hero_image: "/hero.jpg?v=3",

  hero_overline: "Handmade in Knoxville, Tennessee",
  hero_headline: "Handcrafted. One of a kind.\nNever repeated.",
  hero_copy:
    "Upcycled tote bags, purses, and quilts — sewn one stitch at a time by Suzi.",

  website_by: "Website by Business Web Express",
  website_by_email: "info@businesswebexpress.com",

  about_title: "About Suzi",
  about_header: "Every bag carries a story",
  about_short:
    "I believe handmade pieces carry stories that mass-produced products never can. Each bag begins as a one-of-a-kind idea and an upcycled find, then becomes something you'll carry for years — sewn here in Knoxville, never repeated.",
  about_story:
    "I'm a retired gal who has always had a passion for creating things. For years, quilting was my love — there's something magical about transforming fabric into something beautiful and lasting.\n\nWhen I moved to Knoxville, my quilting frame — usually about 10 feet wide — simply wouldn't fit. Rather than give up on my craft, I discovered that an embroidery machine can do quilting too, albeit in its own unique way. And I fell in love all over again.\n\nWhat started as a workaround became a whole new passion — creating one-of-a-kind bags and purses with intricate embroidered details you won't find anywhere else. Every stitch, every seam, every bag is made with care, right here in Knoxville.",
  about_picture: "/aboutsuzi.jpeg?v=2",
  about_subheading: "From Quilting Frames to Embroidery Machines",
  about_quote: "I know that you'll love your bag.",
};

/**
 * The copyright default stays live-bound to the business name rather than being a flat string —
 * index.php:40 does exactly this, and index.php:38-39 explains why: it tracks the business name
 * until an admin explicitly overrides it.
 */
export function defaultCopyright(bizName: string): string {
  return `© 2026 ${bizName} · Knoxville, TN`;
}

/**
 * Merge a parsed biz_profile row over the defaults.
 *
 * Uses PHP `!empty()` semantics deliberately: the PHP tested `!empty($bz['x'])`, which treats an
 * empty string, "0", and null all as absent. A field cleared to "" in the admin therefore falls
 * back to the default rather than rendering blank — matching current behaviour exactly.
 */
export function resolveBizProfile(raw: string | null | undefined): BizProfile {
  let parsed: Partial<Record<keyof BizProfile, unknown>> = {};
  if (raw) {
    try {
      const j = JSON.parse(raw);
      if (j && typeof j === "object") parsed = j as typeof parsed;
    } catch {
      // index.php wrapped this in try/catch and kept the fallbacks, so a corrupt biz_profile row
      // degrades to defaults instead of taking the storefront down. Preserve that.
    }
  }

  const pick = (key: keyof BizProfile, fallback: string): string => {
    const v = parsed[key];
    if (typeof v === "string" && v !== "" && v !== "0") return v;
    if (typeof v === "number" && v !== 0) return String(v);
    return fallback;
  };

  const name = pick("name", BIZ_DEFAULTS.name);

  return {
    name,
    short_name: pick("short_name", BIZ_DEFAULTS.short_name),
    email: pick("email", BIZ_DEFAULTS.email),
    logo: pick("logo", BIZ_DEFAULTS.logo),
    hero_image: pick("hero_image", BIZ_DEFAULTS.hero_image),
    hero_overline: pick("hero_overline", BIZ_DEFAULTS.hero_overline),
    hero_headline: pick("hero_headline", BIZ_DEFAULTS.hero_headline),
    hero_copy: pick("hero_copy", BIZ_DEFAULTS.hero_copy),
    copyright_statement: pick("copyright_statement", defaultCopyright(name)),
    website_by: pick("website_by", BIZ_DEFAULTS.website_by),
    website_by_email: pick("website_by_email", BIZ_DEFAULTS.website_by_email),
    about_title: pick("about_title", BIZ_DEFAULTS.about_title),
    about_header: pick("about_header", BIZ_DEFAULTS.about_header),
    about_short: pick("about_short", BIZ_DEFAULTS.about_short),
    about_story: pick("about_story", BIZ_DEFAULTS.about_story),
    about_picture: pick("about_picture", BIZ_DEFAULTS.about_picture),
    about_subheading: pick("about_subheading", BIZ_DEFAULTS.about_subheading),
    about_quote: pick("about_quote", BIZ_DEFAULTS.about_quote),
  };
}
