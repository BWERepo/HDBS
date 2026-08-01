// GitHub REST API client: ports the shared curl helpers in api/github_log.php and
// api/repo_stats.php. Same injection pattern as the other *-gateway.ts files.

export interface GithubCommitSummary {
  sha: string;
  date: string;
  message: string;
  url: string;
}

export type GithubCommitsPage = { ok: true; commits: GithubCommitSummary[]; hasMore: boolean } | { ok: false; status: number };

export interface GithubTreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
}

export interface GithubGateway {
  listCommitsPage(owner: string, repo: string, page: number, perPage: number): Promise<GithubCommitsPage>;
  getCommitFileCount(owner: string, repo: string, sha: string): Promise<number | null>;
  getTotalCommitCount(owner: string, repo: string): Promise<number | null>;
  getRecursiveTree(owner: string, repo: string, ref: string): Promise<GithubTreeEntry[] | null>;
  getRawFileText(owner: string, repo: string, ref: string, path: string): Promise<string | null>;
}

function headers(token: string): HeadersInit {
  const h: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "HandmadeDesignsBySuzi" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export class LiveGithubGateway implements GithubGateway {
  constructor(private token: string) {}

  async listCommitsPage(owner: string, repo: string, page: number, perPage: number): Promise<GithubCommitsPage> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=${perPage}&page=${page}`, { headers: headers(this.token) });
      if (res.status !== 200) return { ok: false, status: res.status };
      const batch = (await res.json().catch(() => null)) as { sha: string; commit: { message: string; author: { date: string } }; html_url: string }[] | null;
      if (!Array.isArray(batch)) return { ok: false, status: res.status };
      const commits = batch.map((c) => ({ sha: c.sha, date: c.commit.author?.date ?? "", message: (c.commit.message ?? "").trim(), url: c.html_url ?? "" }));
      return { ok: true, commits, hasMore: batch.length >= perPage };
    } catch {
      return { ok: false, status: 0 };
    }
  }

  async getCommitFileCount(owner: string, repo: string, sha: string): Promise<number | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${sha}`, { headers: headers(this.token) });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as { files?: unknown[] } | null;
      return json?.files ? json.files.length : null;
    } catch {
      return null;
    }
  }

  async getTotalCommitCount(owner: string, repo: string): Promise<number | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, { headers: headers(this.token) });
      const link = res.headers.get("link") ?? "";
      const m = /[?&]page=(\d+)>;\s*rel="last"/.exec(link);
      return m ? Number(m[1]) : null;
    } catch {
      return null;
    }
  }

  async getRecursiveTree(owner: string, repo: string, ref: string): Promise<GithubTreeEntry[] | null> {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { headers: headers(this.token) });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as { tree?: GithubTreeEntry[]; truncated?: boolean } | null;
      return json?.tree ?? null;
    } catch {
      return null;
    }
  }

  async getRawFileText(owner: string, repo: string, ref: string, path: string): Promise<string | null> {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }
}

export function createGithubGateway(token: string): GithubGateway {
  return new LiveGithubGateway(token);
}

/** Ports the `dev_env` setting parse shared by github_log.php and repo_stats.php: the GitHub repo
 *  is admin-editable (Developer > Settings > Environment card), stored as "owner/repo", falling
 *  back to the hardcoded default when unset or malformed. */
export function resolveGithubRepo(devEnvRaw: string | null): { owner: string; repo: string; repoName: string } {
  let repoName = "BWERepo/HDBS";
  if (devEnvRaw) {
    try {
      const devEnv = JSON.parse(devEnvRaw) as { github_repo?: string };
      if (devEnv.github_repo?.includes("/")) repoName = devEnv.github_repo;
    } catch {
      // keep default
    }
  }
  const slash = repoName.indexOf("/");
  return { owner: repoName.slice(0, slash), repo: repoName.slice(slash + 1), repoName };
}
