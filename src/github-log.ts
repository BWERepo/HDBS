// Ports api/github_log.php: the admin "Change History" commit log, with a per-commit file count.
// curl_multi's parallel per-commit fetches become Promise.all here — a cleaner match for
// "concurrent, independent HTTP calls" than the PHP's manual multi-handle bookkeeping.
//
// The PHP's 10-minute file-cache (sys_get_temp_dir()) has no direct equivalent in a stateless
// Worker; the route layer wraps this function with the Cache API instead (per-colo, same
// "avoid hammering GitHub's API on every admin page load" intent, just backed by Cloudflare's
// edge cache rather than a local temp file).

import type { GithubGateway } from "./lib/github-gateway";

export interface GithubCommitDto {
  sha: string;
  date: string;
  message: string;
  files: number | null;
  url: string;
}

export interface GithubLogResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

const PER_PAGE = 100;
const MAX_PAGES = 50; // safety cap: 5000 commits, matches the PHP's own cap

/** Ports api/github_log.php's whole GET action (minus the file cache — see this file's header). */
export async function buildGithubCommitLog(gateway: GithubGateway, owner: string, repo: string): Promise<GithubLogResult<{ commits: GithubCommitDto[]; total_commits: number | null }>> {
  const commits: { sha: string; date: string; message: string; url: string }[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await gateway.listCommitsPage(owner, repo, page, PER_PAGE);
    if (!result.ok) {
      if (page === 1) return { ok: false, error: "GitHub API error", status: 502 };
      break; // partial failure on a later page — keep what we have, matching the PHP
    }
    commits.push(...result.commits);
    if (!result.hasMore) break;
  }

  const fileCounts = await Promise.all(commits.map((c) => gateway.getCommitFileCount(owner, repo, c.sha)));
  const total = await gateway.getTotalCommitCount(owner, repo);

  return {
    ok: true,
    data: {
      commits: commits.map((c, i) => ({ sha: c.sha.slice(0, 7), date: c.date, message: c.message, files: fileCounts[i] ?? null, url: c.url })),
      total_commits: total,
    },
  };
}
