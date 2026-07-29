// Copies the live site's static assets from the repo root into public/, which is the Workers
// Static Assets directory.
//
// Why this exists rather than just moving the files: until the Phase 9 cutover, the repo root IS
// the deployed PHP site — deploy.ps1 FTPs js/ and css/ straight to Hostinger. Keeping a hand-
// maintained second copy under public/ would guarantee drift between what production serves and
// what the Worker serves, and that drift would be invisible until someone noticed a bug fix had
// silently not reached one of them.
//
// So: the root copies stay authoritative, and public/ is generated. At Phase 10, when the PHP is
// deleted, the root copies move into public/ for real and this script goes away.
//
// public/index.html is NOT generated here — it is a real source file, derived from index.php
// lines 68+ in Phase 2, and it is tracked in git.

import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "public");

// Directories copied wholesale.
const DIRS = ["js", "css", ".well-known"];

// Individual files. Note that product_images/ and business_logo/ are deliberately absent: those
// are admin-uploaded, live only on the Hostinger server today, and move to R2 — not to public/.
const FILES = [
  "favicon.png",
  "robots.txt",
  "sitemap.xml",
  "HDBSLogo.jpeg",
  "hero.jpg",
  "aboutsuzi.jpeg",
  "QRCode.png",
];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

await mkdir(out, { recursive: true });

let copied = 0;
const missing = [];

for (const dir of DIRS) {
  const src = path.join(root, dir);
  if (!(await exists(src))) {
    missing.push(dir);
    continue;
  }
  const dest = path.join(out, dir);
  await rm(dest, { recursive: true, force: true });
  await cp(src, dest, { recursive: true });
  copied++;
  console.log(`  dir   ${dir}/`);
}

for (const file of FILES) {
  const src = path.join(root, file);
  if (!(await exists(src))) {
    missing.push(file);
    continue;
  }
  await cp(src, path.join(out, file));
  copied++;
  console.log(`  file  ${file}`);
}

console.log(`\nsync-assets: ${copied} item(s) copied into public/`);

if (missing.length) {
  console.warn(`sync-assets: ${missing.length} not found and skipped: ${missing.join(", ")}`);
}

if (!(await exists(path.join(out, "index.html")))) {
  console.warn(
    "sync-assets: public/index.html does not exist yet. It is written by hand in Phase 2 from\n" +
      "             index.php lines 68+ with {{BIZ_*}} tokens. The Worker will 404 until then."
  );
}
