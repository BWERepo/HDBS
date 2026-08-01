import { describe, it, expect, beforeEach } from "vitest";
import { buildGithubCommitLog } from "./github-log";
import type { GithubGateway, GithubCommitsPage } from "./lib/github-gateway";

class FakeGithubGateway implements GithubGateway {
  pages = new Map<number, GithubCommitsPage>();
  fileCounts = new Map<string, number | null>();
  totalCommits: number | null = 42;

  async listCommitsPage(_owner: string, _repo: string, page: number): Promise<GithubCommitsPage> {
    return this.pages.get(page) ?? { ok: true, commits: [], hasMore: false };
  }
  async getCommitFileCount(_owner: string, _repo: string, sha: string): Promise<number | null> {
    return this.fileCounts.get(sha) ?? null;
  }
  async getTotalCommitCount(): Promise<number | null> {
    return this.totalCommits;
  }
  async getRecursiveTree() {
    return null;
  }
  async getRawFileText() {
    return null;
  }
}

let gateway: FakeGithubGateway;

beforeEach(() => {
  gateway = new FakeGithubGateway();
});

describe("buildGithubCommitLog", () => {
  it("fails with a 502 when the very first page fails", async () => {
    gateway.pages.set(1, { ok: false, status: 403 });
    const result = await buildGithubCommitLog(gateway, "BWERepo", "HDBS");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
  });

  it("keeps partial results when a LATER page fails", async () => {
    gateway.pages.set(1, { ok: true, commits: [{ sha: "abc1234567", date: "2026-01-01", message: "first", url: "u1" }], hasMore: true });
    gateway.pages.set(2, { ok: false, status: 500 });
    const result = await buildGithubCommitLog(gateway, "BWERepo", "HDBS");
    expect(result.ok).toBe(true);
    expect(result.data?.commits).toHaveLength(1);
  });

  it("stops paginating once a page reports hasMore=false", async () => {
    gateway.pages.set(1, { ok: true, commits: [{ sha: "aaa1111111", date: "2026-01-01", message: "m1", url: "u1" }], hasMore: false });
    const result = await buildGithubCommitLog(gateway, "BWERepo", "HDBS");
    expect(result.data?.commits).toHaveLength(1);
  });

  it("truncates each sha to 7 characters and attaches its file count and the total commit count", async () => {
    gateway.pages.set(1, { ok: true, commits: [{ sha: "abcdef1234567890", date: "2026-07-05", message: "Fix bug", url: "u1" }], hasMore: false });
    gateway.fileCounts.set("abcdef1234567890", 3);
    const result = await buildGithubCommitLog(gateway, "BWERepo", "HDBS");
    expect(result.data?.commits[0]).toEqual({ sha: "abcdef1", date: "2026-07-05", message: "Fix bug", files: 3, url: "u1" });
    expect(result.data?.total_commits).toBe(42);
  });

  it("reports files:null when the per-commit fetch fails, rather than dropping the commit", async () => {
    gateway.pages.set(1, { ok: true, commits: [{ sha: "sha1", date: "", message: "m", url: "" }], hasMore: false });
    const result = await buildGithubCommitLog(gateway, "BWERepo", "HDBS");
    expect(result.data?.commits[0]?.files).toBeNull();
  });
});
