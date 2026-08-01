// Ops: ports api/email_log.php only. See PROJECT_STATUS.md for why deploy_log.php and
// github_log.php are deliberately not ported in this pass:
//
// - deploy_log.php writes to a local file and auto-bumps minor_version for the old FTP-deploy
//   pipeline (deploy.ps1/watch.ps1). That pipeline doesn't exist in the Cloudflare architecture —
//   deploys are `wrangler deploy`, versioning is version.json + git history — so this endpoint
//   has nothing left to serve, not a gap to fill.
// - github_log.php is a live external API integration (GitHub commits) with its own filesystem
//   cache. Lower priority than the business-logic modules, similar to USPS tracking — deferred,
//   not because it's hard, but because it isn't core storefront/admin functionality.
// - api/applog.php has no HTTP endpoint of its own; per the migration plan it becomes
//   console.log/wrangler tail, which is a call-site concern, not a module to port.

export interface EmailLogRow {
  id: number;
  sent_at: string;
  email_type: string;
  sent_to: string;
  order_id: string;
  subject: string | null;
  status: string;
  error_msg: string | null;
  email_body: string | null;
}

export interface OpsResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface EmailLogStore {
  listEmailLog(filters: { orderId?: string; type?: string }): Promise<EmailLogRow[]>;
  insertEmailLogEntry(entry: { emailType: string; sentTo: string; orderId: string; subject: string; status: string; errorMsg: string | null }): Promise<void>;
  clearEmailLog(): Promise<void>;
}

/** Ports api/email_log.php's GET action. Caller must have already required admin. Caps at 500
 *  rows, matching the PHP's `LIMIT 500`. */
export async function listEmailLog(store: EmailLogStore, filters: { orderId?: string; type?: string }): Promise<OpsResult<{ logs: EmailLogRow[] }>> {
  const rows = await store.listEmailLog(filters);
  return { ok: true, data: { logs: rows.slice(0, 500) } };
}

/** Ports api/email_log.php's POST action (admin only — internal server-side calls use the store
 *  directly, matching the PHP comment that this HTTP path is for admin/manual use). */
export async function logEmail(
  store: EmailLogStore,
  input: { email_type?: string; sent_to?: string; order_id?: string; subject?: string; status?: string; error_msg?: string }
): Promise<OpsResult> {
  await store.insertEmailLogEntry({
    emailType: input.email_type ?? "unknown",
    sentTo: input.sent_to ?? "",
    orderId: input.order_id ?? "",
    subject: input.subject ?? "",
    status: input.status ?? "sent",
    errorMsg: input.error_msg ?? null,
  });
  return { ok: true };
}

/** Ports api/email_log.php's DELETE action. Caller must have already required admin. */
export async function clearEmailLog(store: EmailLogStore): Promise<OpsResult> {
  await store.clearEmailLog();
  return { ok: true };
}

// ── In-memory test double ──
export class EmailLogStoreFake implements EmailLogStore {
  rows: EmailLogRow[] = [];
  private nextId = 1;

  async listEmailLog(filters: { orderId?: string; type?: string }): Promise<EmailLogRow[]> {
    return this.rows
      .filter((r) => (!filters.orderId || r.order_id === filters.orderId) && (!filters.type || r.email_type === filters.type))
      .slice()
      .sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  }
  async insertEmailLogEntry(entry: { emailType: string; sentTo: string; orderId: string; subject: string; status: string; errorMsg: string | null }): Promise<void> {
    this.rows.push({
      id: this.nextId++,
      sent_at: new Date().toISOString(),
      email_type: entry.emailType,
      sent_to: entry.sentTo,
      order_id: entry.orderId,
      subject: entry.subject,
      status: entry.status,
      error_msg: entry.errorMsg,
      email_body: null,
    });
  }
  async clearEmailLog(): Promise<void> {
    this.rows = [];
  }
}
