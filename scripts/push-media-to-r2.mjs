#!/usr/bin/env node
// Uploads media-mirror/ into an R2 bucket. Fills the gap migrate-data.mjs deliberately leaves:
// that script only handles Postgres rows (the daily db_backup.php SQL dump), never binary files —
// there was no R2 to write to until Phase 2, so media has never had its own migration path.
//
// media-mirror/ was rescued from Hostinger's disk by scripts/pull-media.ps1 (see that file's own
// header for why it's the most important script in the migration: product_images/ and
// business_logo/ were never uploaded FROM the repo, only ever written by the admin UI directly to
// the server's filesystem — the server was the only copy).
//
// ── Bucket/prefix layout, matching src/routes/media.ts and src/business.ts exactly ──
// Public (served through the Worker's GET /product_images/* etc. proxy, src/routes/media.ts):
//   product_images/, business_logo/, business_hero/, business_about/, studio_images/
// Private (admin-gated only, src/business.ts's capital_equipment/business_docs, no public route):
//   capital_equipment_receipts/, business_documents/
//
// Shells out to `wrangler r2 object put` per file rather than the S3 API directly — this repo has
// no R2 access-key credentials configured locally (same reasoning as every other script here:
// wrangler's own OAuth session is the only auth available), and wrangler already has --remote to
// target the real bucket rather than local dev simulation.
//
// Usage:
//   node scripts/push-media-to-r2.mjs                 dry run against production bucket names
//   node scripts/push-media-to-r2.mjs --write          actually upload, to production
//   node scripts/push-media-to-r2.mjs --write --staging   upload to the -staging buckets instead

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

// Every argument below comes from this script's own fixed bucket/prefix names or from
// fs.readdirSync() over media-mirror/ — never from user input — so building a single quoted shell
// command string here (required for npx.cmd to resolve on Windows) carries none of the injection
// risk that pattern normally implies.
function quoteArg(arg) {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

const args = process.argv.slice(2);
const write = args.includes("--write");
const staging = args.includes("--staging");

const MIRROR_DIR = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "media-mirror");

const PUBLIC_BUCKET = staging ? "hdbs-public-staging" : "hdbs-public";
const PRIVATE_BUCKET = staging ? "hdbs-private-staging" : "hdbs-private";

// Directory name -> which bucket it belongs in. Matches src/routes/media.ts's
// PUBLIC_MEDIA_PREFIXES and src/business.ts's capital_equipment_receipts/business_documents
// prefixes exactly — do not rename these without updating both.
const DIRS = [
  { name: "product_images", bucket: PUBLIC_BUCKET },
  { name: "business_logo", bucket: PUBLIC_BUCKET },
  { name: "business_hero", bucket: PUBLIC_BUCKET },
  { name: "business_about", bucket: PUBLIC_BUCKET },
  { name: "studio_images", bucket: PUBLIC_BUCKET },
  { name: "capital_equipment_receipts", bucket: PRIVATE_BUCKET },
  { name: "business_documents", bucket: PRIVATE_BUCKET },
];

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

function contentTypeFor(filename) {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
}

let totalFound = 0;
let totalUploaded = 0;
let totalFailed = 0;
const results = [];

for (const { name, bucket } of DIRS) {
  const dir = path.join(MIRROR_DIR, name);
  if (!fs.existsSync(dir)) {
    results.push({ dir: name, bucket, found: 0, uploaded: 0, note: "directory does not exist in media-mirror/ (known gap — see docs/phase-0-checklist.md)" });
    continue;
  }
  const files = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  totalFound += files.length;
  if (files.length === 0) {
    results.push({ dir: name, bucket, found: 0, uploaded: 0, note: "directory exists but is empty" });
    continue;
  }

  let uploaded = 0;
  let failed = 0;
  for (const file of files) {
    const localPath = path.join(dir, file);
    const key = `${name}/${file}`;
    if (!write) continue;
    try {
      const cmd = [
        process.platform === "win32" ? "npx.cmd" : "npx",
        "wrangler",
        "r2",
        "object",
        "put",
        quoteArg(`${bucket}/${key}`),
        quoteArg(`--file=${localPath}`),
        `--content-type=${contentTypeFor(file)}`,
        "--remote",
      ].join(" ");
      execSync(cmd, { stdio: "pipe" });
      uploaded++;
    } catch (e) {
      failed++;
      console.error(`FAILED: ${bucket}/${key}: ${e.message}`);
    }
  }
  totalUploaded += uploaded;
  totalFailed += failed;
  results.push({ dir: name, bucket, found: files.length, uploaded, note: write ? (failed > 0 ? `${failed} failed` : "ok") : "dry-run" });
}

console.log(write ? "Upload results:" : "Dry run (pass --write to actually upload). Preview only:");
console.table(results);
console.log(`\nTotal: ${totalFound} local files found, ${write ? `${totalUploaded} uploaded, ${totalFailed} failed` : "0 uploaded (dry run)"}.`);

if (totalFailed > 0) process.exitCode = 1;
