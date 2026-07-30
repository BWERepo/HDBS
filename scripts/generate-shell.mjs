// Generate public/index.html from index.php by replacing every PHP echo with a {{TOKEN}}.
//
// WHY A GENERATOR RATHER THAN A HAND EDIT:
// index.php has 56 PHP tags across 1121 lines, rendering 19 distinct values in three different
// escaping contexts. Converting that by hand risks silently missing one — and a missed echo becomes
// literal "<?php echo $bizNameAttr; ?>" text on the live storefront. This script instead THROWS on
// any PHP expression it does not recognise, so the conversion is provably complete: if it succeeds,
// there is no PHP left and every echo was deliberately mapped.
//
// It is also re-runnable. The PHP site stays live until cutover, so if index.php changes in the
// meantime, regenerate rather than re-editing by hand.
//
// The escaping context each token is rendered in is decided in src/shell.ts, not here. This script
// only records WHICH value goes where.
//
// Usage: npm run generate:shell

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "index.php");
const out = path.join(root, "public", "index.html");

// Exact PHP echo expression -> token name.
//
// The three suffix conventions in index.php map onto three escaping contexts, and the token names
// preserve the distinction because src/shell.ts must reproduce it:
//   *Attr  -> htmlspecialchars(): safe in both attributes and element text  -> {{X}}
//   *Html  -> nl2br(htmlspecialchars()): the same, but newlines become <br> -> {{X_HTML}}
//   json_encode() -> embedded in JSON-LD or a JS literal, NOT html-escaped  -> {{X_JSON}}
const MAP = new Map([
  ["$bizNameAttr", "BIZ_NAME"],
  ["$bizShortNameAttr", "BIZ_SHORT_NAME"],
  ["$bizEmailAttr", "BIZ_EMAIL"],

  ["$bizLogoAbsAttr", "BIZ_LOGO"],
  ["(int)$bizLogoWidth", "BIZ_LOGO_WIDTH"],
  ["(int)$bizLogoHeight", "BIZ_LOGO_HEIGHT"],
  ["htmlspecialchars($bizLogoMime, ENT_QUOTES, 'UTF-8')", "BIZ_LOGO_MIME"],

  ["$bizHeroAbsAttr", "BIZ_HERO"],
  ["$bizHeroOverlineHtml", "BIZ_HERO_OVERLINE_HTML"],
  ["$bizHeroHeadlineHtml", "BIZ_HERO_HEADLINE_HTML"],
  ["$bizHeroCopyHtml", "BIZ_HERO_COPY_HTML"],

  ["$bizAboutTitleAttr", "BIZ_ABOUT_TITLE"],
  ["$bizAboutHeaderAttr", "BIZ_ABOUT_HEADER"],
  ["$bizAboutShortHtml", "BIZ_ABOUT_SHORT_HTML"],
  ["$bizAboutPictureAttr", "BIZ_ABOUT_PICTURE"],
  ["$bizAboutSubheadingAttr", "BIZ_ABOUT_SUBHEADING"],
  ["$bizAboutQuoteAttr", "BIZ_ABOUT_QUOTE"],
  ["$bizAboutStoryHtml", "BIZ_ABOUT_STORY_HTML"],

  ["$bizCopyrightHtml", "BIZ_COPYRIGHT"],
  ["$bizWebsiteByHtml", "BIZ_WEBSITE_BY"],
  ["$bizWebsiteByEmailAttr", "BIZ_WEBSITE_BY_EMAIL"],

  ["json_encode($bizName)", "BIZ_NAME_JSON"],
  ["json_encode($bizShortName)", "BIZ_SHORT_NAME_JSON"],
  ["json_encode($bizEmail)", "BIZ_EMAIL_JSON"],
  ["json_encode($bizLogoAbs)", "BIZ_LOGO_JSON"],
]);

const php = readFileSync(src, "utf8");

// Drop the PHP prologue (index.php lines 1-64): the DB connection and the biz_profile defaults.
// That logic moves to src/shell.ts, which is the one place the defaults now live.
const close = php.indexOf("?>");
if (close === -1) throw new Error("No closing ?> found — is index.php intact?");
let html = php.slice(close + 2).replace(/^\r?\n/, "");

const used = new Set();
const unknown = [];

html = html.replace(/<\?php\s+echo\s+([\s\S]*?);?\s*\?>/g, (match, expr) => {
  const key = expr.trim().replace(/;$/, "");
  const token = MAP.get(key);
  if (!token) {
    unknown.push(key);
    return match;
  }
  used.add(token);
  return `{{${token}}}`;
});

if (unknown.length) {
  console.error("Unrecognised PHP expressions — add them to MAP in this script:");
  for (const u of [...new Set(unknown)]) console.error(`  ${u}`);
  process.exit(1);
}

// Completeness proof: nothing PHP may survive into a static asset. A leftover tag would be served
// as literal text to customers, since Workers Static Assets obviously will not execute it.
if (/<\?php|<\?=/.test(html)) {
  const idx = html.search(/<\?php|<\?=/);
  console.error("PHP still present after conversion, near:");
  console.error("  " + html.slice(Math.max(0, idx - 60), idx + 120).replace(/\n/g, " "));
  process.exit(1);
}

// The version line. index.php rendered these four <div class="site-version-line"> elements empty
// and js/config.js filled them from the DB's major_version/minor_version settings rows. Version
// now comes from version.json via window.BIZ_VERSION, so leave the elements alone here.
const versionLines = (html.match(/site-version-line/g) || []).length;

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, html, "utf8");

const unused = [...MAP.values()].filter((t) => !used.has(t));

console.log(`Wrote ${path.relative(root, out)}`);
console.log(`  ${html.split("\n").length} lines, ${(html.length / 1024).toFixed(1)} KB`);
console.log(`  ${used.size} of ${MAP.size} tokens substituted`);
console.log(`  ${versionLines} .site-version-line element(s) preserved`);
if (unused.length) {
  console.warn(`  NOTE: mapped but never used in index.php: ${unused.join(", ")}`);
}
