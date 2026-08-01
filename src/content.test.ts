import { describe, it, expect, beforeEach } from "vitest";
import {
  listReviews,
  submitReview,
  updateReviewStatus,
  deleteReview,
  listFaqs,
  reorderFaqs,
  addFaq,
  updateFaq,
  deleteFaq,
  ReviewsStoreFake,
  FaqsStoreFake,
} from "./content";

let reviews: ReviewsStoreFake;
let faqs: FaqsStoreFake;

beforeEach(() => {
  reviews = new ReviewsStoreFake();
  faqs = new FaqsStoreFake();
});

describe("submitReview", () => {
  it("requires a customer name and review text", async () => {
    expect((await submitReview(reviews, "k", { customer_name: "", review_text: "long enough text" })).ok).toBe(false);
    expect((await submitReview(reviews, "k", { customer_name: "Jane", review_text: "" })).ok).toBe(false);
  });

  it("rejects a too-short review", async () => {
    const result = await submitReview(reviews, "k", { customer_name: "Jane", review_text: "short" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too short/);
  });

  it("clamps rating to 1-5", async () => {
    await submitReview(reviews, "k", { customer_name: "Jane", review_text: "This is a great product", rating: 99 });
    await submitReview(reviews, "k2", { customer_name: "Jane", review_text: "This is a great product", rating: -5 });
    expect(reviews.reviews[0]!.rating).toBe(5);
    expect(reviews.reviews[1]!.rating).toBe(1);
  });

  it("defaults rating to 5 when omitted", async () => {
    await submitReview(reviews, "k", { customer_name: "Jane", review_text: "This is a great product" });
    expect(reviews.reviews[0]!.rating).toBe(5);
  });

  it("submits as pending, not immediately approved", async () => {
    await submitReview(reviews, "k", { customer_name: "Jane", review_text: "This is a great product" });
    expect(reviews.reviews[0]!.status).toBe("pending");
  });

  it("rate limits at 5 per 15 minutes per key", async () => {
    const now = 1000;
    for (let i = 0; i < 5; i++) {
      const result = await submitReview(reviews, "sameKey", { customer_name: "Jane", review_text: "This is a great product" }, now);
      expect(result.ok).toBe(true);
    }
    const blocked = await submitReview(reviews, "sameKey", { customer_name: "Jane", review_text: "This is a great product" }, now + 5);
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe(429);
  });
});

describe("listReviews", () => {
  it("public (admin=false) only returns approved reviews", async () => {
    await submitReview(reviews, "k1", { customer_name: "A", review_text: "Great product, love it!" });
    await submitReview(reviews, "k2", { customer_name: "B", review_text: "Also great, love it too!" });
    await updateReviewStatus(reviews, 1, "approved");
    const result = await listReviews(reviews, false);
    expect(result.data?.reviews).toHaveLength(1);
    expect(result.data?.reviews[0]!.customer_name).toBe("A");
  });

  it("admin=true returns all reviews regardless of status", async () => {
    await submitReview(reviews, "k1", { customer_name: "A", review_text: "Great product, love it!" });
    const result = await listReviews(reviews, true);
    expect(result.data?.reviews).toHaveLength(1);
  });
});

describe("updateReviewStatus / deleteReview", () => {
  it("updateReviewStatus requires an id", async () => {
    expect((await updateReviewStatus(reviews, 0, "approved")).ok).toBe(false);
  });

  it("defaults status to approved when not provided", async () => {
    await submitReview(reviews, "k", { customer_name: "A", review_text: "Great product, love it!" });
    await updateReviewStatus(reviews, 1, "");
    expect(reviews.reviews[0]!.status).toBe("approved");
  });

  it("deleteReview requires an id and removes the row", async () => {
    await submitReview(reviews, "k", { customer_name: "A", review_text: "Great product, love it!" });
    expect((await deleteReview(reviews, 0)).ok).toBe(false);
    await deleteReview(reviews, 1);
    expect(reviews.reviews).toEqual([]);
  });
});

describe("faqs", () => {
  it("addFaq requires question and answer", async () => {
    expect((await addFaq(faqs, "", "answer")).ok).toBe(false);
    expect((await addFaq(faqs, "question", "")).ok).toBe(false);
  });

  it("adds and lists FAQs sorted by sort_order then id", async () => {
    await addFaq(faqs, "Q2", "A2", 1);
    await addFaq(faqs, "Q1", "A1", 0);
    const result = await listFaqs(faqs);
    expect(result.data?.faqs.map((f) => f.question)).toEqual(["Q1", "Q2"]);
  });

  it("updateFaq requires id, question, and answer", async () => {
    await addFaq(faqs, "Q1", "A1");
    expect((await updateFaq(faqs, 0, "Q", "A")).ok).toBe(false);
    expect((await updateFaq(faqs, 1, "", "A")).ok).toBe(false);
    const result = await updateFaq(faqs, 1, "Q1 updated", "A1 updated");
    expect(result.ok).toBe(true);
    expect(faqs.faqs[0]!.question).toBe("Q1 updated");
  });

  it("reorderFaqs sets sort_order to each id's position in the given order array", async () => {
    await addFaq(faqs, "Q1", "A1", 0);
    await addFaq(faqs, "Q2", "A2", 1);
    await reorderFaqs(faqs, [2, 1]); // FAQ 2 should now sort first
    const result = await listFaqs(faqs);
    expect(result.data?.faqs.map((f) => f.question)).toEqual(["Q2", "Q1"]);
  });

  it("deleteFaq requires an id and removes the row", async () => {
    await addFaq(faqs, "Q1", "A1");
    expect((await deleteFaq(faqs, 0)).ok).toBe(false);
    await deleteFaq(faqs, 1);
    expect((await listFaqs(faqs)).data?.faqs).toEqual([]);
  });
});
