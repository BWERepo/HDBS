// Ports the admin log-viewer half of api/admin.php (`read_log`/`clear_log`/`get_error_log`
// actions) plus the four call sites that used to write directly to disk: applog.php's
// applog()/dbg()/pagelog() helpers (api/applog.php), and square-webhook.php's own
// file_put_contents() call.
//
// api/applog.php wrote plain text files on Hostinger's disk (notify_log.txt, webhook_log.txt,
// error_log.txt, pages.log); a Worker has no filesystem. The earlier applog() port (see
// PROJECT_STATUS.md, "applog.php") replaced those writes with console.error, viewable only live
// via `wrangler tail` — sufficient for the payments-milestone session, but it means the admin log
// viewer itself had nothing left to read. This module is the deliberate re-architecture the user
// chose over dropping the viewer: a real Supabase table (`app_log`) that both the writers below
// and admin.ts's read/clear actions share, so the UI keeps working the way it always did.
//
// Only two of the four original files have real writers today: `notify` (every applog() call site
// already ported — payments.ts's PAYMENT-FAIL/PP-CREATE-FAIL/PP-CAPTURE-FAIL, refunds.ts's
// REFUND-FAIL) and `webhook` (square-webhook.php's own PAID/no-order-found line, now
// handleSquareWebhookEvent's). `error` (dbg(), gated on the `debug_mode` setting) and `pages`
// (pagelog(), gated on `log_page_changes`) have no ported caller yet — same as the live PHP, which
// only ever populates those files once debug mode or page-view logging is actually turned on.
// They're still valid, listable/clearable files (matching the PHP's `$allowed` list exactly), just
// empty until something writes to them.

export type AppLogFile = "notify_log.txt" | "webhook_log.txt" | "error_log.txt" | "pages.log";

export const ALLOWED_LOG_FILES: readonly AppLogFile[] = ["notify_log.txt", "webhook_log.txt", "error_log.txt", "pages.log"];

export interface AppLogEntry {
  loggedAt: string; // ISO, UTC
  context: string;
  message: string;
}

export interface AppLogStore {
  append(file: AppLogFile, entry: { context: string; message: string }): Promise<void>;
  /** Entries for `file`, oldest first (matches PHP's file() read order before the caller reverses). */
  readEntries(file: AppLogFile): Promise<AppLogEntry[]>;
  clear(file: AppLogFile): Promise<void>;
}

export interface AppLogResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

/** Formats one entry the same shape applog()/pagelog() wrote to disk: "<EDT timestamp> | ctx | msg". */
export function formatLogLine(entry: AppLogEntry): string {
  const d = new Date(entry.loggedAt);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const stamp = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${get("dayPeriod")} EDT`;
  return `${stamp} | ${entry.context} | ${entry.message}`;
}

function isAllowed(file: string): file is AppLogFile {
  return (ALLOWED_LOG_FILES as readonly string[]).includes(file);
}

/** Ports api/admin.php's `read_log` action: last 200 lines, newest first, or "No entries yet." */
export async function readLog(store: AppLogStore, file: string): Promise<AppLogResult<{ content: string }>> {
  if (!isAllowed(file)) return { ok: false, error: "Invalid log file", status: 400 };
  const entries = await store.readEntries(file);
  if (entries.length === 0) return { ok: true, data: { content: "No entries yet." } };
  const lines = entries.slice(-200).map(formatLogLine).reverse();
  return { ok: true, data: { content: lines.join("\n") } };
}

/** Ports api/admin.php's `clear_log` action. */
export async function clearLog(store: AppLogStore, file: string): Promise<AppLogResult> {
  if (!isAllowed(file)) return { ok: false, error: "Invalid log file", status: 400 };
  await store.clear(file);
  return { ok: true };
}

const ERROR_LOG_TRUNCATE_AT = 100_000;

/** Ports api/admin.php's `get_error_log` action: full text (not reversed/capped at 200 like
 *  read_log), tail-truncated at 100KB, with its own "not found yet" placeholder message. */
export async function getErrorLog(store: AppLogStore): Promise<AppLogResult<{ log: string }>> {
  const entries = await store.readEntries("error_log.txt");
  if (entries.length === 0) {
    return { ok: true, data: { log: "(error_log.txt not found — enable debug mode and trigger some actions first)" } };
  }
  let content = entries.map(formatLogLine).join("\n");
  if (content.length > ERROR_LOG_TRUNCATE_AT) {
    content = `...(truncated, showing last 100KB)...\n${content.slice(-ERROR_LOG_TRUNCATE_AT)}`;
  }
  return { ok: true, data: { log: content } };
}

// ── In-memory test double ──
export class AppLogStoreFake implements AppLogStore {
  rows: Record<AppLogFile, AppLogEntry[]> = {
    "notify_log.txt": [],
    "webhook_log.txt": [],
    "error_log.txt": [],
    "pages.log": [],
  };

  async append(file: AppLogFile, entry: { context: string; message: string }): Promise<void> {
    this.rows[file].push({ loggedAt: new Date().toISOString(), context: entry.context, message: entry.message });
  }
  async readEntries(file: AppLogFile): Promise<AppLogEntry[]> {
    return this.rows[file].slice();
  }
  async clear(file: AppLogFile): Promise<void> {
    this.rows[file] = [];
  }
}
