import { describe, it, expect, beforeEach } from "vitest";
import { buildRepoStats } from "./repo-stats";
import type { GithubGateway, GithubTreeEntry } from "./lib/github-gateway";

class FakeGithubGateway implements GithubGateway {
  tree: GithubTreeEntry[] | null = [];
  fileTexts = new Map<string, string>();

  async listCommitsPage() {
    return { ok: true as const, commits: [], hasMore: false };
  }
  async getCommitFileCount() {
    return null;
  }
  async getTotalCommitCount() {
    return null;
  }
  async getRecursiveTree(): Promise<GithubTreeEntry[] | null> {
    return this.tree;
  }
  async getRawFileText(_owner: string, _repo: string, _ref: string, path: string): Promise<string | null> {
    return this.fileTexts.get(path) ?? null;
  }
}

let gateway: FakeGithubGateway;

beforeEach(() => {
  gateway = new FakeGithubGateway();
});

describe("buildRepoStats", () => {
  it("fails with a 500 when the tree can't be fetched", async () => {
    gateway.tree = null;
    const result = await buildRepoStats(gateway, "BWERepo/HDBS", "BWERepo", "HDBS", "main");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("counts total files and code files by extension, excluding .git/node_modules", async () => {
    gateway.tree = [
      { path: "index.php", type: "blob", sha: "s1" },
      { path: "js/api.js", type: "blob", sha: "s2" },
      { path: "README.md", type: "blob", sha: "s3" },
      { path: ".git/config", type: "blob", sha: "s4" },
      { path: "node_modules/foo/index.js", type: "blob", sha: "s5" },
      { path: "js", type: "tree", sha: "s6" },
    ];
    const result = await buildRepoStats(gateway, "BWERepo/HDBS", "BWERepo", "HDBS", "main");
    expect(result.ok).toBe(true);
    expect(result.data?.total_files).toBe(3); // index.php, js/api.js, README.md (dirs + excluded paths don't count)
    expect(result.data?.code_files).toBe(2); // index.php + js/api.js, README.md isn't a code extension
  });

  it("sums line counts across every scanned code file", async () => {
    gateway.tree = [
      { path: "a.js", type: "blob", sha: "s1" },
      { path: "b.js", type: "blob", sha: "s2" },
    ];
    gateway.fileTexts.set("a.js", "line1\nline2\nline3\n"); // 3 lines
    gateway.fileTexts.set("b.js", "line1\nline2"); // 2 lines, no trailing newline
    const result = await buildRepoStats(gateway, "BWERepo/HDBS", "BWERepo", "HDBS", "main");
    expect(result.data?.lines_of_code).toBe(5);
  });

  it("treats a file whose content couldn't be fetched as zero lines rather than failing", async () => {
    gateway.tree = [{ path: "missing.js", type: "blob", sha: "s1" }];
    const result = await buildRepoStats(gateway, "BWERepo/HDBS", "BWERepo", "HDBS", "main");
    expect(result.ok).toBe(true);
    expect(result.data?.lines_of_code).toBe(0);
  });

  it("returns the caller-supplied repoName as-is (the admin-configurable display name)", async () => {
    gateway.tree = [];
    const result = await buildRepoStats(gateway, "SomeOrg/SomeRepo", "SomeOrg", "SomeRepo", "main");
    expect(result.data?.repo).toBe("SomeOrg/SomeRepo");
  });
});
