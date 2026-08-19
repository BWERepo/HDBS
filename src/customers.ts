// Customer accounts: ports api/customers.php's register/login/security-question/password-reset/
// change-password/inc_orders/admin CRUD/cancel_order actions.
//
// ⭐ Production has ZERO customer rows (verified — db_backup.php only emits an INSERT block for
// tables with data, and there is none here). No account has ever been created on the live site.
// That doesn't change what gets ported (the front end's register/login forms are real and must
// keep working), but it does mean there's no legacy data whose exact byte-format must be
// preserved — new registrations use hashPassword() (PBKDF2) directly rather than needing a
// bcrypt-compatibility path, the same way a brand-new admin password would.
//
// Reuses password.ts's hashPassword/verifyPassword (same bcrypt-tolerant, PBKDF2-issuing
// functions auth.ts uses for the admin account) and lib/order-token.ts for the account
// order-view token. Same store-interface + fake pattern as every other module.
//
// One deliberate parity addition, not in the original PHP: reset_password's security-answer check
// does NOT auto-rehash a legacy plaintext answer to bcrypt/PBKDF2 on success, unlike auth.ts's
// admin equivalent (which does, and documents why). Added the same self-healing behavior here for
// consistency — free to do since there are zero real accounts for it to affect, and it closes the
// same "verified-correct answer left sitting in plaintext forever" gap auth.ts already flagged.

import { hashPassword, verifyPassword } from "./lib/password";
import { makeOrderToken } from "./lib/order-token";
import { makeCancelToken, type OrdersStore } from "./orders";
import { timingSafeEqual } from "./lib/http";

export interface CustomerRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  password_hash: string | null;
  phone: string | null;
  sec_question: string | null;
  sec_answer: string | null;
  order_count: number;
  joined_at: string | null;
}

export interface CustomerListItem {
  id: string;
  fn: string | null;
  ln: string | null;
  name: string;
  em: string;
  ph: string | null;
  orders: number;
  joined: string;
}

export interface CustomerProfile {
  id: string;
  fn: string | null;
  ln: string | null;
  name: string;
  em: string;
  ph: string | null;
  orders: number;
  secQ?: string | null;
  orders_token: string;
}

export interface CustomersResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface CustomersStore {
  listCustomers(): Promise<CustomerRow[]>;
  findByEmail(email: string): Promise<CustomerRow | null>;
  findById(id: string): Promise<CustomerRow | null>;
  insertCustomer(row: Omit<CustomerRow, "order_count" | "joined_at">): Promise<void>;
  updateCustomerFields(id: string, fields: Partial<Pick<CustomerRow, "first_name" | "last_name" | "email" | "phone">>): Promise<void>;
  updatePasswordHash(id: string, hash: string): Promise<void>;
  updateSecAnswer(id: string, hash: string): Promise<void>;
  incrementOrderCount(email: string): Promise<void>;
  deleteCustomer(id: string): Promise<void>;

  /** Shared customer_login_attempts bucket, keyed by caller-supplied prefix+identifier — same
   *  table api/orders.php's order-creation throttle also uses (six lazy-create sites in the PHP,
   *  one table, many prefixes). */
  getAttempt(key: string): Promise<{ attempts: number; lastAt: number } | null>;
  setAttempt(key: string, attempts: number, lastAt: number): Promise<void>;
}

function fullName(fn: string | null, ln: string | null): string {
  return `${fn ?? ""} ${ln ?? ""}`.trim();
}

/** Formats as mm/dd/yyyy. */
function formatJoined(joinedAt: string | null): string {
  if (!joinedAt) return "";
  const d = new Date(joinedAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function toListItem(row: CustomerRow): CustomerListItem {
  return {
    id: row.id,
    fn: row.first_name,
    ln: row.last_name,
    name: fullName(row.first_name, row.last_name),
    em: row.email,
    ph: row.phone,
    orders: row.order_count,
    joined: formatJoined(row.joined_at),
  };
}

function randomCustomerId(now: number = Date.now()): string {
  const rand = 100 + Math.floor(Math.random() * 900); // matches PHP's rand(100, 999)
  return `C${now}${rand}`;
}

async function checkAndRecordAttempt(
  store: CustomersStore,
  key: string,
  maxAttempts: number,
  windowSeconds: number,
  now: number
): Promise<CustomersResult | null> {
  const row = (await store.getAttempt(key)) ?? { attempts: 0, lastAt: 0 };
  if (row.attempts >= maxAttempts && now - row.lastAt < windowSeconds) {
    const mins = Math.ceil((windowSeconds - (now - row.lastAt)) / 60);
    return { ok: false, error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }
  return null;
}

async function recordAttemptFailure(store: CustomersStore, key: string, attempts: number, now: number): Promise<void> {
  await store.setAttempt(key, attempts + 1, now);
}

async function clearAttempts(store: CustomersStore, key: string): Promise<void> {
  await store.setAttempt(key, 0, 0);
}

/** Ports api/customers.php's `action=list`. Caller must have already required admin. */
export async function listCustomers(store: CustomersStore): Promise<CustomersResult<{ customers: CustomerListItem[] }>> {
  const rows = await store.listCustomers();
  return { ok: true, data: { customers: rows.map(toListItem) } };
}

export interface RegisterInput {
  em: string;
  pw: string;
  fn?: string;
  ln?: string;
  ph?: string;
  secQ?: string;
  secA?: string;
}

/** Ports api/customers.php's `action=register`. `rateLimitKey` is the caller's per-IP key. */
export async function registerCustomer(
  store: CustomersStore,
  input: RegisterInput,
  rateLimitKey: string,
  orderTokenSecret: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<CustomersResult<{ id: string; name: string; em: string; orders_token: string }>> {
  if (!input.em || !input.pw) return { ok: false, error: "Email and password required" };
  if (input.pw.length < 6) return { ok: false, error: "Password must be at least 6 characters" };

  const rgRow = (await store.getAttempt(rateLimitKey)) ?? { attempts: 0, lastAt: 0 };
  if (rgRow.attempts >= 5 && now - rgRow.lastAt < 3600) {
    return { ok: false, error: "Too many registration attempts from this network. Please try again later." };
  }
  const attempts = rgRow.attempts >= 5 ? 0 : rgRow.attempts;
  await store.setAttempt(rateLimitKey, attempts + 1, now);

  if (await store.findByEmail(input.em)) return { ok: false, error: "Email already registered" };

  const id = randomCustomerId();
  const fn = input.fn ?? "";
  const ln = input.ln ?? "";
  await store.insertCustomer({
    id,
    first_name: fn,
    last_name: ln,
    email: input.em,
    password_hash: await hashPassword(input.pw),
    phone: input.ph ?? "",
    sec_question: input.secQ ?? "",
    sec_answer: input.secA ? await hashPassword(input.secA.toLowerCase().trim()) : "",
  });

  return {
    ok: true,
    data: { id, name: fullName(fn, ln), em: input.em, orders_token: await makeOrderToken(input.em, 86400, orderTokenSecret, now) },
  };
}

/** Ports api/customers.php's `action=login`. `rateLimitKey` is the caller's per-email key. */
export async function loginCustomer(
  store: CustomersStore,
  email: string,
  password: string,
  rateLimitKey: string,
  orderTokenSecret: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<CustomersResult<CustomerProfile>> {
  if (!email || !password) return { ok: false, error: "Email and password required" };

  const aRow = (await store.getAttempt(rateLimitKey)) ?? { attempts: 0, lastAt: 0 };
  if (aRow.attempts >= 10 && now - aRow.lastAt < 900) {
    const mins = Math.ceil((900 - (now - aRow.lastAt)) / 60);
    return { ok: false, error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }
  const baseAttempts = aRow.attempts >= 10 ? 0 : aRow.attempts;

  const cust = await store.findByEmail(email);
  const verified = cust?.password_hash ? await verifyPassword(password, cust.password_hash) : { valid: false, needsRehash: false };
  if (!cust || !verified.valid) {
    await recordAttemptFailure(store, rateLimitKey, baseAttempts, now);
    return { ok: false, error: "Incorrect email or password" };
  }

  await clearAttempts(store, rateLimitKey);
  if (verified.needsRehash) await store.updatePasswordHash(cust.id, await hashPassword(password));

  return {
    ok: true,
    data: {
      id: cust.id,
      fn: cust.first_name,
      ln: cust.last_name,
      name: fullName(cust.first_name, cust.last_name),
      em: cust.email,
      ph: cust.phone,
      orders: cust.order_count,
      secQ: cust.sec_question,
      orders_token: await makeOrderToken(cust.email, 86400, orderTokenSecret, now),
    },
  };
}

/** Ports api/customers.php's `action=get_sec_question`. */
export async function getCustomerSecurityQuestion(store: CustomersStore, email: string): Promise<CustomersResult<{ question: string }>> {
  if (!email) return { ok: false, error: "Email required" };
  const cust = await store.findByEmail(email);
  if (!cust) return { ok: false, error: "No account found with that email" };
  if (!cust.sec_question) return { ok: false, error: "No security question set for this account" };
  return { ok: true, data: { question: cust.sec_question } };
}

/** Ports api/customers.php's `action=reset_password`. `rateLimitKey` is the caller's per-email key. */
export async function resetCustomerPassword(
  store: CustomersStore,
  email: string,
  answer: string,
  newPassword: string,
  rateLimitKey: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<CustomersResult> {
  if (!email || !answer || !newPassword) return { ok: false, error: "Missing fields" };

  const rRow = (await store.getAttempt(rateLimitKey)) ?? { attempts: 0, lastAt: 0 };
  if (rRow.attempts >= 5 && now - rRow.lastAt < 900) {
    const mins = Math.ceil((900 - (now - rRow.lastAt)) / 60);
    return { ok: false, error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }
  const baseAttempts = rRow.attempts >= 5 ? 0 : rRow.attempts;

  const cust = await store.findByEmail(email);
  if (!cust) return { ok: false, error: "Account not found" };

  const given = answer.toLowerCase().trim();
  const stored = cust.sec_answer ?? "";
  const isHashed = stored.startsWith("$2y$") || stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("pbkdf2$");
  const result = stored === "" ? { valid: false, needsRehash: false } : isHashed ? await verifyPassword(given, stored) : { valid: given === stored, needsRehash: given === stored };

  if (!result.valid) {
    await recordAttemptFailure(store, rateLimitKey, baseAttempts, now);
    return { ok: false, error: "Incorrect answer" };
  }
  await clearAttempts(store, rateLimitKey);
  // Deliberate addition beyond the PHP — see this file's header.
  if (result.needsRehash) await store.updateSecAnswer(cust.id, await hashPassword(given));

  if (newPassword.length < 6) return { ok: false, error: "Password must be at least 6 characters" };
  await store.updatePasswordHash(cust.id, await hashPassword(newPassword));
  return { ok: true };
}

/** Ports api/customers.php's `action=change_password`. `rateLimitKey` is the caller's per-id key. */
export async function changeCustomerPassword(
  store: CustomersStore,
  id: string,
  oldPassword: string,
  newPassword: string,
  rateLimitKey: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<CustomersResult> {
  if (!id || !oldPassword || !newPassword) return { ok: false, error: "Missing fields" };

  const cpRow = (await store.getAttempt(rateLimitKey)) ?? { attempts: 0, lastAt: 0 };
  if (cpRow.attempts >= 10 && now - cpRow.lastAt < 900) {
    const mins = Math.ceil((900 - (now - cpRow.lastAt)) / 60);
    return { ok: false, error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }
  const baseAttempts = cpRow.attempts >= 10 ? 0 : cpRow.attempts;

  const cust = await store.findById(id);
  const verified = cust?.password_hash ? await verifyPassword(oldPassword, cust.password_hash) : { valid: false, needsRehash: false };
  if (!cust || !verified.valid) {
    await recordAttemptFailure(store, rateLimitKey, baseAttempts, now);
    return { ok: false, error: "Current password incorrect" };
  }
  await clearAttempts(store, rateLimitKey);
  await store.updatePasswordHash(id, await hashPassword(newPassword));
  return { ok: true };
}

/** Ports api/customers.php's `action=inc_orders`. */
export async function incrementOrderCount(
  ordersStore: Pick<OrdersStore, "orderBelongsToEmail">,
  customersStore: CustomersStore,
  email: string,
  orderId: string
): Promise<CustomersResult> {
  if (!email) return { ok: false, error: "Email required" };
  if (!orderId) return { ok: false, error: "order_id required" };
  if (!(await ordersStore.orderBelongsToEmail(orderId, email))) return { ok: false, error: "Order not found for this email" };
  await customersStore.incrementOrderCount(email);
  return { ok: true };
}

export interface AddCustomerInput {
  em: string;
  pw?: string;
  fn?: string;
  ln?: string;
  ph?: string;
}

/** Ports api/customers.php's `action=add_customer`. Caller must have already required admin. */
export async function addCustomer(store: CustomersStore, input: AddCustomerInput): Promise<CustomersResult<{ id: string }>> {
  if (!input.em) return { ok: false, error: "Email required" };
  if (await store.findByEmail(input.em)) return { ok: false, error: "Email already registered" };

  const id = randomCustomerId();
  await store.insertCustomer({
    id,
    first_name: input.fn ?? "",
    last_name: input.ln ?? "",
    email: input.em,
    password_hash: await hashPassword(input.pw ?? "TempPass1!"),
    phone: input.ph ?? "",
    sec_question: null,
    sec_answer: null,
  });
  return { ok: true, data: { id } };
}

/** Ports api/customers.php's `action=update_customer`. Caller must have already required admin.
 *  Faithfully NOT a partial update: the PHP always overwrites all four fields, defaulting any
 *  missing one to an empty string — not just the fields actually sent. */
export async function updateCustomer(
  store: CustomersStore,
  id: string,
  fields: { fn?: string; ln?: string; em?: string; ph?: string }
): Promise<CustomersResult> {
  if (!id) return { ok: false, error: "Missing id" };
  await store.updateCustomerFields(id, {
    first_name: fields.fn ?? "",
    last_name: fields.ln ?? "",
    email: fields.em ?? "",
    phone: fields.ph ?? "",
  });
  return { ok: true };
}

/** Ports api/customers.php's `action=delete_customer`. Caller must have already required admin. */
export async function deleteCustomer(store: CustomersStore, id: string): Promise<CustomersResult> {
  if (!id) return { ok: false, error: "Missing id" };
  await store.deleteCustomer(id);
  return { ok: true };
}

/**
 * Ports api/customers.php's `action=cancel_order` (public — the cancel token IS the auth).
 * Reuses orders.ts's makeCancelToken so the same secret/domain-separation issuing the token at
 * order creation also verifies it here.
 */
export async function cancelOrder(store: OrdersStore, orderId: string, cancelToken: string, orderTokenSecret: string): Promise<CustomersResult> {
  if (!orderId) return { ok: false, error: "Missing order_id" };
  if (!cancelToken) return { ok: false, error: "Missing cancel token", status: 403 };

  const expected = await makeCancelToken(orderId, orderTokenSecret);
  if (!timingSafeEqual(expected, cancelToken)) return { ok: false, error: "Invalid cancel token", status: 403 };

  const status = await store.getOrderStatus(orderId);
  if (status === null) return { ok: false, error: "Order not found" };
  if (status !== "Awaiting Payment") return { ok: false, error: "Cannot cancel this order" };

  const items = await store.getOrderItemsForRestore(orderId);
  for (const item of items) await store.restoreStock(item.product_id, item.quantity);
  await store.updateOrderFields(orderId, { status: "Cancelled" });
  return { ok: true };
}

// ── In-memory test double ──
export class CustomersStoreFake implements CustomersStore {
  customers = new Map<string, CustomerRow>();
  attempts = new Map<string, { attempts: number; lastAt: number }>();

  async listCustomers(): Promise<CustomerRow[]> {
    return [...this.customers.values()].sort((a, b) => (b.joined_at ?? "").localeCompare(a.joined_at ?? ""));
  }
  async findByEmail(email: string): Promise<CustomerRow | null> {
    const target = email.toLowerCase();
    return [...this.customers.values()].find((c) => c.email.toLowerCase() === target) ?? null;
  }
  async findById(id: string): Promise<CustomerRow | null> {
    return this.customers.get(id) ?? null;
  }
  async insertCustomer(row: Omit<CustomerRow, "order_count" | "joined_at">): Promise<void> {
    this.customers.set(row.id, { ...row, order_count: 0, joined_at: new Date().toISOString() });
  }
  async updateCustomerFields(id: string, fields: Partial<Pick<CustomerRow, "first_name" | "last_name" | "email" | "phone">>): Promise<void> {
    const c = this.customers.get(id);
    if (c) Object.assign(c, fields);
  }
  async updatePasswordHash(id: string, hash: string): Promise<void> {
    const c = this.customers.get(id);
    if (c) c.password_hash = hash;
  }
  async updateSecAnswer(id: string, hash: string): Promise<void> {
    const c = this.customers.get(id);
    if (c) c.sec_answer = hash;
  }
  async incrementOrderCount(email: string): Promise<void> {
    const c = await this.findByEmail(email);
    if (c) c.order_count += 1;
  }
  async deleteCustomer(id: string): Promise<void> {
    this.customers.delete(id);
  }

  async getAttempt(key: string): Promise<{ attempts: number; lastAt: number } | null> {
    return this.attempts.get(key) ?? null;
  }
  async setAttempt(key: string, attempts: number, lastAt: number): Promise<void> {
    this.attempts.set(key, { attempts, lastAt });
  }
}

export function makeCustomerRow(overrides: Partial<CustomerRow> & Pick<CustomerRow, "id" | "email">): CustomerRow {
  return {
    first_name: "",
    last_name: "",
    password_hash: null,
    phone: "",
    sec_question: null,
    sec_answer: null,
    order_count: 0,
    joined_at: new Date().toISOString(),
    ...overrides,
  };
}
