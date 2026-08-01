// Reviews + FAQs: ports api/reviews.php and api/faqs.php. Same store-interface + fake pattern as
// everywhere else. Both are simple content CRUD with no payment/email dependency.

export interface ReviewRow {
  id: number;
  customer_name: string;
  product_name: string | null;
  rating: number;
  review_text: string;
  status: string;
  created_at: string | null;
}

export interface FaqRow {
  id: number;
  question: string;
  answer: string;
  sort_order: number;
}

export interface ContentResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

export interface ReviewsStore {
  listReviews(onlyApproved: boolean): Promise<ReviewRow[]>;
  insertReview(row: Pick<ReviewRow, "customer_name" | "product_name" | "rating" | "review_text">): Promise<void>;
  updateReviewStatus(id: number, status: string): Promise<void>;
  deleteReview(id: number): Promise<void>;
  getRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null>;
  setRateLimit(key: string, attempts: number, lastAt: number): Promise<void>;
}

export interface FaqsStore {
  listFaqs(): Promise<FaqRow[]>;
  insertFaq(row: Pick<FaqRow, "question" | "answer" | "sort_order">): Promise<void>;
  updateFaq(id: number, question: string, answer: string): Promise<void>;
  updateFaqSortOrder(id: number, sortOrder: number): Promise<void>;
  deleteFaq(id: number): Promise<void>;
}

const REVIEW_RATE_LIMIT_MAX = 5;
const REVIEW_RATE_LIMIT_WINDOW_SECONDS = 900;

async function checkAndRecordReviewRateLimit(store: ReviewsStore, key: string, now: number): Promise<ContentResult | null> {
  const row = (await store.getRateLimit(key)) ?? { attempts: 0, lastAt: 0 };
  if (row.attempts >= REVIEW_RATE_LIMIT_MAX && now - row.lastAt < REVIEW_RATE_LIMIT_WINDOW_SECONDS) {
    const mins = Math.ceil((REVIEW_RATE_LIMIT_WINDOW_SECONDS - (now - row.lastAt)) / 60);
    return { ok: false, error: `Too many requests. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, status: 429 };
  }
  const attempts = row.attempts >= REVIEW_RATE_LIMIT_MAX ? 1 : row.attempts + 1;
  await store.setRateLimit(key, attempts, now);
  return null;
}

/** Ports api/reviews.php's GET action. `admin` param mirrors `?admin=1` — caller must have
 *  already required admin when true. */
export async function listReviews(store: ReviewsStore, admin: boolean): Promise<ContentResult<{ reviews: ReviewRow[] }>> {
  return { ok: true, data: { reviews: await store.listReviews(!admin) } };
}

/** Ports api/reviews.php's POST action. `rateLimitKey` is the caller's per-IP key. */
export async function submitReview(
  store: ReviewsStore,
  rateLimitKey: string,
  input: { customer_name?: string; product_name?: string; rating?: number; review_text?: string },
  now: number = Math.floor(Date.now() / 1000)
): Promise<ContentResult> {
  const limited = await checkAndRecordReviewRateLimit(store, rateLimitKey, now);
  if (limited) return limited;

  const name = (input.customer_name ?? "").trim();
  const product = (input.product_name ?? "").trim();
  const rating = Math.max(1, Math.min(5, Number(input.rating ?? 5)));
  const text = (input.review_text ?? "").trim();

  if (!name || !text) return { ok: false, error: "Name and review text are required" };
  if (text.length < 10) return { ok: false, error: "Review is too short" };

  await store.insertReview({ customer_name: name, product_name: product, rating, review_text: text });
  return { ok: true };
}

/** Ports api/reviews.php's PUT action. Caller must have already required admin. */
export async function updateReviewStatus(store: ReviewsStore, id: number, status: string): Promise<ContentResult> {
  if (!id) return { ok: false, error: "Missing review id" };
  await store.updateReviewStatus(id, status || "approved");
  return { ok: true };
}

/** Ports api/reviews.php's DELETE action. Caller must have already required admin. */
export async function deleteReview(store: ReviewsStore, id: number): Promise<ContentResult> {
  if (!id) return { ok: false, error: "Missing review id" };
  await store.deleteReview(id);
  return { ok: true };
}

/** Ports api/faqs.php's GET action. Public. */
export async function listFaqs(store: FaqsStore): Promise<ContentResult<{ faqs: FaqRow[] }>> {
  return { ok: true, data: { faqs: await store.listFaqs() } };
}

/** Ports api/faqs.php's POST `action=reorder`. Caller must have already required admin. */
export async function reorderFaqs(store: FaqsStore, order: (number | string)[]): Promise<ContentResult> {
  for (let i = 0; i < order.length; i++) {
    await store.updateFaqSortOrder(Number(order[i]), i);
  }
  return { ok: true };
}

/** Ports api/faqs.php's POST (add) action. Caller must have already required admin. */
export async function addFaq(store: FaqsStore, question: string, answer: string, sortOrder = 0): Promise<ContentResult> {
  const q = question.trim();
  const a = answer.trim();
  if (!q || !a) return { ok: false, error: "Question and answer are required" };
  await store.insertFaq({ question: q, answer: a, sort_order: sortOrder });
  return { ok: true };
}

/** Ports api/faqs.php's PUT action. Caller must have already required admin. */
export async function updateFaq(store: FaqsStore, id: number, question: string, answer: string): Promise<ContentResult> {
  const q = question.trim();
  const a = answer.trim();
  if (!id || !q || !a) return { ok: false, error: "Missing fields" };
  await store.updateFaq(id, q, a);
  return { ok: true };
}

/** Ports api/faqs.php's DELETE action. Caller must have already required admin. */
export async function deleteFaq(store: FaqsStore, id: number): Promise<ContentResult> {
  if (!id) return { ok: false, error: "Missing id" };
  await store.deleteFaq(id);
  return { ok: true };
}

// ── In-memory test doubles ──
export class ReviewsStoreFake implements ReviewsStore {
  reviews: ReviewRow[] = [];
  rateLimits = new Map<string, { attempts: number; lastAt: number }>();
  private nextId = 1;

  async listReviews(onlyApproved: boolean): Promise<ReviewRow[]> {
    return this.reviews
      .filter((r) => !onlyApproved || r.status === "approved")
      .slice()
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }
  async insertReview(row: Pick<ReviewRow, "customer_name" | "product_name" | "rating" | "review_text">): Promise<void> {
    this.reviews.push({ id: this.nextId++, status: "pending", created_at: new Date().toISOString(), ...row });
  }
  async updateReviewStatus(id: number, status: string): Promise<void> {
    const r = this.reviews.find((r) => r.id === id);
    if (r) r.status = status;
  }
  async deleteReview(id: number): Promise<void> {
    this.reviews = this.reviews.filter((r) => r.id !== id);
  }
  async getRateLimit(key: string): Promise<{ attempts: number; lastAt: number } | null> {
    return this.rateLimits.get(key) ?? null;
  }
  async setRateLimit(key: string, attempts: number, lastAt: number): Promise<void> {
    this.rateLimits.set(key, { attempts, lastAt });
  }
}

export class FaqsStoreFake implements FaqsStore {
  faqs: FaqRow[] = [];
  private nextId = 1;

  async listFaqs(): Promise<FaqRow[]> {
    return this.faqs.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }
  async insertFaq(row: Pick<FaqRow, "question" | "answer" | "sort_order">): Promise<void> {
    this.faqs.push({ id: this.nextId++, ...row });
  }
  async updateFaq(id: number, question: string, answer: string): Promise<void> {
    const f = this.faqs.find((f) => f.id === id);
    if (f) {
      f.question = question;
      f.answer = answer;
    }
  }
  async updateFaqSortOrder(id: number, sortOrder: number): Promise<void> {
    const f = this.faqs.find((f) => f.id === id);
    if (f) f.sort_order = sortOrder;
  }
  async deleteFaq(id: number): Promise<void> {
    this.faqs = this.faqs.filter((f) => f.id !== id);
  }
}
