// Validate supabase/migrations/*.sql against the real PostgreSQL grammar.
//
// Uses libpg_query — the actual PostgreSQL parser — compiled to WASM, so it catches genuine syntax
// errors without needing Docker, a local Postgres, or a live Supabase project. That matters here
// because the migrations are hand-converted from MySQL, and a MySQL-ism that slips through
// (backticks, AUTO_INCREMENT, TINYINT, ON DUPLICATE KEY, MODIFY COLUMN) would otherwise not be
// caught until someone ran it against a real database.
//
// What this does NOT check: that referenced tables/columns/functions exist, that types are
// sensible, or that the migrations apply in order. It is a grammar check, not a semantic one.
// Applying them to the staging Supabase project remains the real test.
//
// Usage: npm run validate:migrations

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initModule from "pg-query-emscripten";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "supabase", "migrations");

if (!existsSync(dir)) {
  console.error(`No migrations directory at ${dir}`);
  process.exit(1);
}

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error("No .sql files found.");
  process.exit(1);
}

const pg = await initModule();

// MySQL constructs that must not survive the conversion. The migrations are converted by hand, so
// this is a cheap guard against a copy-paste from docs/schema-live-prod.sql.
const MYSQLISMS = [
  [/`/, "backtick identifier"],
  [/\bAUTO_INCREMENT\b/i, "AUTO_INCREMENT"],
  [/\bTINYINT\b/i, "TINYINT"],
  [/\bMEDIUMTEXT\b|\bLONGTEXT\b/i, "MEDIUMTEXT/LONGTEXT"],
  [/\bDATETIME\b/i, "DATETIME"],
  [/\bON DUPLICATE KEY\b/i, "ON DUPLICATE KEY UPDATE"],
  [/\bENGINE\s*=/i, "ENGINE="],
  [/\bMODIFY COLUMN\b/i, "MODIFY COLUMN"],
  [/\bunsigned\b/i, "UNSIGNED"],
  [/\bSHOW COLUMNS\b/i, "SHOW COLUMNS"],
];

let failed = 0;

for (const f of files) {
  const sql = readFileSync(path.join(dir, f), "utf8");
  const res = pg.parse(sql);

  if (res.error) {
    failed++;
    const upto = sql.slice(0, res.error.cursorpos);
    const line = upto.split("\n").length;
    console.log(`FAIL  ${f}`);
    console.log(`        ${res.error.message}`);
    console.log(`        near line ${line}: ${upto.split("\n").pop().trim().slice(-90)}`);
    continue;
  }

  // Strip comments before scanning, so explanatory prose about MySQL doesn't trip the guard.
  const code = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

  const found = MYSQLISMS.filter(([re]) => re.test(code)).map(([, name]) => name);
  const count = res.parse_tree?.stmts?.length ?? 0;

  if (found.length) {
    failed++;
    console.log(`FAIL  ${f}  (${count} statements) — MySQL syntax left in: ${found.join(", ")}`);
  } else {
    console.log(`OK    ${f}  (${count} statements)`);
  }
}

console.log(
  failed
    ? `\n${failed} of ${files.length} file(s) FAILED`
    : `\nAll ${files.length} migrations parse against the PostgreSQL grammar, with no MySQL syntax left in.`
);
process.exit(failed ? 1 : 0);
