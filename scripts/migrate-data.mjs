#!/usr/bin/env node
// Phase 1 data migration: loads a real production data snapshot (the daily db_backup.php dump)
// into a Supabase project — normally staging, per PROJECT_STATUS.md ("Staging Supabase loaded
// from a prod snapshot"). See docs/schema-reconciliation.md and PROJECT_STATUS.md for the
// decisions behind what is/isn't migrated.
//
// ── Parsing approach ──
// api/db_backup.php generates this file with PHP's $pdo->quote() for every value (see that file's
// source) — real, well-defined MySQL string-literal escaping, not an ad-hoc format. That means a
// small hand-written tokenizer is reliable here; it is NOT a generic SQL parser and would not
// survive a real mysqldump's extended-insert quirks or a different escaping scheme.
//
// ── Excluded tables (deliberate, not an oversight) ──
// - admin_sessions, customer_login_attempts, rate_limits: ephemeral security/session bookkeeping
//   tied to production IPs and tokens. Meaningless (or actively confusing) on staging, which gets
//   its own sessions and its own throttle state.
// - prompt_log: orphaned table, already excluded from the target schema (finding 3, ported
//   elsewhere in PROJECT_STATUS.md) — its own endpoint was deleted; the table should not exist.
// - customers, studio_inquiries, studio_project_notes, tax_sweeps: confirmed empty in production
//   (no INSERT block in the dump at all), nothing to migrate.
//
// ── Idempotency strategy, per table ──
// Tables that kept their real MySQL primary key (products.id, orders.id, settings.key_name) or
// have a natural unique key that survived the port (subscribers.email, tn_city_tax (city,county))
// are upserted on that key — re-running only touches changed rows.
//
// Every OTHER migrated table (order_items, refunds, reviews, faqs, email_log, studio_items,
// capital_equipment) uses `bigint generated always as identity` primary keys in Postgres, which
// cannot accept an explicit id via PostgREST (no OVERRIDING SYSTEM VALUE from the REST API) — so
// there is no way to conflict-target the original MySQL row. For order_items/refunds this script
// deletes existing rows scoped to the specific order_ids being (re-)migrated, then inserts fresh;
// for the small standalone content tables (reviews, faqs, email_log, studio_items,
// capital_equipment) it deletes everything in that table, then bulk-inserts — safe because this
// is a one-time snapshot load into a disposable staging project, not a live incremental sync.
//
// ⚠️ Never run --write against the PRODUCTION Supabase project. This script refuses to do so
// unless --allow-prod is also passed, as a second guard beyond "just don't type that URL".

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const BACKUP_DIR = "Z:/Backup/Websites/HDBS/Backup";
const PROD_PROJECT_REF = "ckiyvsejstptrnwkinir";

// ── CLI args ──
const args = process.argv.slice(2);
const write = args.includes("--write");
const allowProd = args.includes("--allow-prod");
const fileArg = args.find((a) => a.startsWith("--file="))?.slice("--file=".length);

function latestBackupFile() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^\d{12}HDBS\.sql$/.test(f))
    .sort();
  if (files.length === 0) throw new Error(`No *HDBS.sql backups found in ${BACKUP_DIR}`);
  return path.join(BACKUP_DIR, files[files.length - 1]);
}

// ── Tokenizer/parser for db_backup.php's PDO::quote()-escaped INSERT statements ──
// Handles: NULL (bare word), and 'single-quoted strings' with backslash escapes for
// \\ \' \" \n \r \0 \x1a — the standard mysqlnd/libmysqlclient quote() escape table.
function parseValueList(text, start) {
  const values = [];
  let i = start;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (text[i] === ")") return { values, next: i + 1 };
    if (text.startsWith("NULL", i)) {
      values.push(null);
      i += 4;
    } else if (text[i] === "'") {
      i++;
      let out = "";
      while (i < n) {
        const ch = text[i];
        if (ch === "\\") {
          const esc = text[i + 1];
          const map = { "\\": "\\", "'": "'", '"': '"', n: "\n", r: "\r", "0": "\0", Z: "\x1a" };
          out += esc in map ? map[esc] : esc;
          i += 2;
        } else if (ch === "'") {
          i++;
          break;
        } else {
          out += ch;
          i++;
        }
      }
      values.push(out);
    } else {
      throw new Error(`Unexpected char ${JSON.stringify(text[i])} at offset ${i}`);
    }
    while (i < n && /\s/.test(text[i])) i++;
    if (text[i] === ",") i++;
    else if (text[i] === ")") {
      i++;
      return { values, next: i };
    }
  }
  throw new Error("Unterminated value tuple");
}

function parseMysqlDump(text) {
  const tables = {};
  const headerRe = /INSERT INTO `(\w+)` \(([^)]+)\) VALUES\n/g;
  let m;
  while ((m = headerRe.exec(text))) {
    const table = m[1];
    const columns = m[2].split(",").map((c) => c.replace(/`/g, "").trim());
    let i = headerRe.lastIndex;
    const rows = [];
    while (true) {
      while (/\s/.test(text[i])) i++;
      if (text[i] !== "(") throw new Error(`Expected '(' for table ${table} at offset ${i}`);
      const { values, next } = parseValueList(text, i + 1);
      if (values.length !== columns.length) {
        throw new Error(`${table}: row has ${values.length} values but ${columns.length} columns`);
      }
      rows.push(values);
      i = next;
      while (/\s/.test(text[i])) i++;
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === ";") {
        i++;
        break;
      }
      throw new Error(`Expected ',' or ';' after row for table ${table} at offset ${i}`);
    }
    tables[table] = { columns, rows };
    headerRe.lastIndex = i;
  }
  return tables;
}

function rowObjects({ columns, rows }) {
  return rows.map((values) => Object.fromEntries(columns.map((c, idx) => [c, values[idx]])));
}

// ── Type coercion helpers ──
const num = (v) => (v === null ? null : Number(v));
const int = (v) => (v === null ? null : parseInt(v, 10));
const bool01 = (v) => v === "1";
/** MySQL's current_timestamp()-defaulted columns on this server store UTC (confirmed empirically:
 *  orders.confirm_sent_at lines up with email_log.sent_at for the same event once sent_at is
 *  converted from America/New_York — see below). A naive 'YYYY-MM-DD HH:MM:SS' string is UTC. */
const utc = (v) => (v === null ? null : v.replace(" ", "T") + "Z");
/** email_log.sent_at is the one deliberate exception: api/db_backup.php's own sibling,
 *  api/email_log.php's insert (and the raw INSERT in db_backup.php's cron path), stamps it via
 *  CONVERT_TZ(NOW(),'+00:00','-04:00') — i.e. NOW() (UTC) converted to Eastern before storage.
 *  Confirmed empirically: order ORD-MR57UJ0A's confirm_sent_at ('2026-07-03 17:39:22', UTC) and
 *  email_log id 102's sent_at ('2026-07-03 13:39:24') are the same instant once sent_at is read
 *  as America/New_York (17:39 UTC - 4h = 13:39 EDT). Converts wall-clock-in-NY to a true UTC
 *  instant, DST-aware, via the standard double-format trick. */
function nyToUtc(v) {
  if (v === null) return null;
  const asIfUtc = new Date(v.replace(" ", "T") + "Z").getTime();
  const inNy = new Date(new Date(asIfUtc).toLocaleString("en-US", { timeZone: "America/New_York" })).getTime();
  const inUtc = new Date(new Date(asIfUtc).toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return new Date(asIfUtc + (inUtc - inNy)).toISOString();
}

// ── Table configs ──
// mode: "upsert" (natural key survived the port) | "delete-scoped" (delete rows matching a scope
// derived from this batch, e.g. order_id in (...), then insert fresh) | "replace-all" (delete
// every row in the table, then insert fresh — only for small standalone content tables).
const TABLES = [
  {
    mysqlTable: "settings",
    pgTable: "settings",
    mode: "upsert",
    conflict: "key_name",
    transform: (r) => ({ key_name: r.key_name, value: r.value }),
  },
  {
    mysqlTable: "products",
    pgTable: "products",
    mode: "upsert",
    conflict: "id",
    transform: (r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      description: r.description,
      price: num(r.price),
      stock: int(r.stock),
      category: r.category,
      badge: r.badge,
      img1: r.img1,
      img2: r.img2,
      img3: r.img3,
      created_at: utc(r.created_at),
      updated_at: utc(r.updated_at),
      weight: num(r.weight),
      size: r.size,
      sell: bool01(r.sell),
      ship_mode: r.ship_mode,
      ship_fixed: num(r.ship_fixed),
      coming_soon: bool01(r.coming_soon),
      cogm: num(r.cogm),
      launch_date: r.launch_date,
    }),
  },
  {
    mysqlTable: "orders",
    pgTable: "orders",
    mode: "upsert",
    conflict: "id",
    transform: (r) => ({
      id: r.id,
      customer_name: r.customer_name,
      customer_email: r.customer_email,
      customer_phone: r.customer_phone,
      shipping_address: r.shipping_address,
      shipping_carrier: r.shipping_carrier,
      tracking_number: r.tracking_number,
      confirm_sent_at: utc(r.confirm_sent_at),
      shipping_sent_at: utc(r.shipping_sent_at),
      total: num(r.total),
      payment_method: r.payment_method,
      status: r.status,
      square_payment_id: r.square_payment_id,
      order_date: r.order_date,
      created_at: utc(r.created_at),
      tax_amount: num(r.tax_amount),
      tax_swept_date: r.tax_swept_date,
      order_type: r.order_type,
      transaction_fee: num(r.transaction_fee),
      payment_configuration: r.payment_configuration,
      check_number: r.check_number,
      refunded_amount: num(r.refunded_amount),
      paypal_capture_id: r.paypal_capture_id,
      paypal_surcharge: num(r.paypal_surcharge),
    }),
  },
  {
    mysqlTable: "order_items",
    pgTable: "order_items",
    mode: "delete-scoped",
    scopeColumn: "order_id",
    transform: (r) => ({
      order_id: r.order_id,
      product_id: r.product_id,
      product_name: r.product_name,
      price: num(r.price),
      quantity: int(r.quantity),
    }),
  },
  {
    mysqlTable: "refunds",
    pgTable: "refunds",
    mode: "delete-scoped",
    scopeColumn: "order_id",
    transform: (r) => ({
      order_id: r.order_id,
      amount: num(r.amount),
      reason: r.reason,
      method: r.method,
      square_refund_id: r.square_refund_id,
      status: r.status,
      created_at: utc(r.created_at),
    }),
  },
  {
    mysqlTable: "reviews",
    pgTable: "reviews",
    mode: "replace-all",
    transform: (r) => ({
      customer_name: r.customer_name,
      product_name: r.product_name,
      rating: int(r.rating),
      review_text: r.review_text,
      status: r.status,
      created_at: utc(r.created_at),
    }),
  },
  {
    mysqlTable: "faqs",
    pgTable: "faqs",
    mode: "replace-all",
    transform: (r) => ({
      question: r.question,
      answer: r.answer,
      sort_order: int(r.sort_order),
      created_at: utc(r.created_at),
    }),
  },
  {
    mysqlTable: "email_log",
    pgTable: "email_log",
    mode: "replace-all",
    transform: (r) => ({
      sent_at: nyToUtc(r.sent_at),
      email_type: r.email_type,
      sent_to: r.sent_to,
      order_id: r.order_id,
      subject: r.subject,
      status: r.status,
      error_msg: r.error_msg,
      email_body: r.email_body,
    }),
  },
  {
    mysqlTable: "subscribers",
    pgTable: "subscribers",
    mode: "upsert",
    conflict: "email",
    transform: (r) => ({ email: r.email, subscribed_at: utc(r.subscribed_at), source: r.source }),
  },
  {
    mysqlTable: "tn_city_tax",
    pgTable: "tn_city_tax",
    mode: "upsert",
    conflict: "city,county",
    transform: (r) => ({ city: r.city, county: r.county, tax_rate: num(r.tax_rate), updated_at: utc(r.updated_at) }),
  },
  {
    mysqlTable: "studio_items",
    pgTable: "studio_items",
    mode: "replace-all",
    transform: (r) => ({
      section: r.section,
      title: r.title,
      data: r.data,
      image: r.image,
      sort_order: int(r.sort_order),
      active: bool01(r.active),
      created_at: utc(r.created_at),
    }),
  },
  {
    mysqlTable: "capital_equipment",
    pgTable: "capital_equipment",
    mode: "replace-all",
    transform: (r) => ({
      description: r.description,
      purchase_date: r.purchase_date,
      purchase_price: num(r.purchase_price),
      receipt_filename: r.receipt_filename,
      receipt_orig_name: r.receipt_orig_name,
      created_at: utc(r.created_at),
    }),
  },
];

async function run() {
  const file = fileArg ?? latestBackupFile();
  console.log(`Reading ${file}`);
  const text = fs.readFileSync(file, "utf8");
  const dump = parseMysqlDump(text);

  let db = null;
  if (write) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("--write requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars to be set.");
    }
    if (url.includes(PROD_PROJECT_REF) && !allowProd) {
      throw new Error(
        `Refusing to write to the PRODUCTION project (${PROD_PROJECT_REF}) without --allow-prod. ` +
          `This should be running against staging.`
      );
    }
    db = createClient(url, key, { auth: { persistSession: false } });
    console.log(`Writing to ${url}`);
  } else {
    console.log("Dry run (pass --write to actually load data). Preview only:\n");
  }

  const summary = [];

  for (const cfg of TABLES) {
    const source = dump[cfg.mysqlTable];
    if (!source) {
      summary.push({ table: cfg.pgTable, read: 0, written: 0, note: "no rows in dump" });
      continue;
    }
    const objects = rowObjects(source);
    const transformed = objects.map(cfg.transform);

    if (!write) {
      console.log(`${cfg.pgTable} (${cfg.mysqlTable} -> ${cfg.mode}): ${transformed.length} rows`);
      if (transformed[0]) console.log("  sample:", JSON.stringify(transformed[0]).slice(0, 300));
      summary.push({ table: cfg.pgTable, read: transformed.length, written: 0, note: "dry-run" });
      continue;
    }

    if (cfg.mode === "upsert") {
      const { error } = await db.from(cfg.pgTable).upsert(transformed, { onConflict: cfg.conflict });
      if (error) throw new Error(`${cfg.pgTable} upsert failed: ${error.message}`);
    } else if (cfg.mode === "delete-scoped") {
      const scopeValues = [...new Set(transformed.map((r) => r[cfg.scopeColumn]))];
      if (scopeValues.length > 0) {
        const { error: delErr } = await db.from(cfg.pgTable).delete().in(cfg.scopeColumn, scopeValues);
        if (delErr) throw new Error(`${cfg.pgTable} scoped delete failed: ${delErr.message}`);
      }
      const { error } = await db.from(cfg.pgTable).insert(transformed);
      if (error) throw new Error(`${cfg.pgTable} insert failed: ${error.message}`);
    } else if (cfg.mode === "replace-all") {
      const { error: delErr } = await db.from(cfg.pgTable).delete().gte("id", 0);
      if (delErr) throw new Error(`${cfg.pgTable} replace-all delete failed: ${delErr.message}`);
      if (transformed.length > 0) {
        const { error } = await db.from(cfg.pgTable).insert(transformed);
        if (error) throw new Error(`${cfg.pgTable} insert failed: ${error.message}`);
      }
    }
    console.log(`${cfg.pgTable}: ${transformed.length} rows loaded (${cfg.mode})`);
    summary.push({ table: cfg.pgTable, read: transformed.length, written: transformed.length, note: cfg.mode });
  }

  console.log("\nSummary:");
  console.table(summary);
}

run().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
