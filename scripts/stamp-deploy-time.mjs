#!/usr/bin/env node
// Stamps version.json's `deployedAt` with the current UTC instant, immediately before every real
// deploy. Wired into wrangler.jsonc's `build.command`, same mechanism as sync-assets.mjs, so it
// runs regardless of whether the deploy was triggered via an npm script or a bare `npx wrangler
// deploy` — see sync-assets.mjs's own header for why that distinction matters (a bare wrangler
// invocation skipping an npm-script-only hook has bitten this project before).
//
// Rendered client-side as "<version> · deployed <date, time> EST" in the footer's
// .site-version-line (public/index.html) — see src/shell.ts's BIZ_DEPLOYED_AT_JSON token.
//
// Not run under `wrangler dev` in a way that matters: local dev doesn't reflect a real deploy
// anyway, so a locally-stamped timestamp is harmless, not misleading in a way that costs anything.

import fs from "node:fs";
import path from "node:path";

const VERSION_FILE = path.join(import.meta.dirname, "..", "version.json");

const current = JSON.parse(fs.readFileSync(VERSION_FILE, "utf8"));
current.deployedAt = new Date().toISOString();
fs.writeFileSync(VERSION_FILE, JSON.stringify(current, null, 2) + "\n");

console.log(`Stamped version.json deployedAt = ${current.deployedAt}`);
