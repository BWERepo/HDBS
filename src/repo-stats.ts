// Ports api/repo_stats.php: the admin "Change History" stat cards (total files, code-file count,
// lines of code).
//
// The PHP walks the LIVE DEPLOYED DIRECTORY on Hostinger (RecursiveDirectoryIterator over
// public_html) — a Worker has no filesystem to walk at all, deployed or otherwise, so this is a
// genuine re-architecture rather than a literal port: file listing comes from GitHub's recursive
// git-tree API (one call, cheap) instead of a local directory scan, and per-file line counts come
// from fetching each code file's raw content over HTTP (raw.githubusercontent.com) instead of a
// local fgets() loop. Capped at MAX_LOC_FILES to bound the number of HTTP subrequests a single
// admin page load can trigger — large enough to cover every real code file in this codebase today,
// small enough to stay well under a Worker's subrequest ceiling even if the repo grows.

import type { GithubGateway } from "./lib/github-gateway";

export interface RepoStatsResult<T = Record<string, never>> {
  ok: boolean;
  error?: string;
  status?: number;
  data?: T;
}

const CODE_EXTENSIONS = new Set(["php", "js", "css", "html"]);
const SKIP_DIRS = [".git/", "node_modules/"];
const MAX_LOC_FILES = 400;

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

function countLines(text: string): number {
  if (text === "") return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

/** Ports api/repo_stats.php's whole GET action, re-architected to source file data from GitHub
 *  instead of a local filesystem walk — see this file's header for why. */
export async function buildRepoStats(gateway: GithubGateway, repoName: string, owner: string, repo: string, ref: string): Promise<RepoStatsResult<{ repo: string; path: string; total_files: number; code_files: number; lines_of_code: number }>> {
  const tree = await gateway.getRecursiveTree(owner, repo, ref);
  if (!tree) return { ok: false, error: `Scan error: could not fetch the ${owner}/${repo}@${ref} file tree from GitHub`, status: 500 };

  const files = tree.filter((e) => e.type === "blob" && !SKIP_DIRS.some((d) => e.path === d.slice(0, -1) || e.path.startsWith(d)));
  const codeFiles = files.filter((f) => CODE_EXTENSIONS.has(extensionOf(f.path)));

  const toScan = codeFiles.slice(0, MAX_LOC_FILES);
  const texts = await Promise.all(toScan.map((f) => gateway.getRawFileText(owner, repo, ref, f.path)));
  const linesOfCode = texts.reduce((sum: number, text) => sum + (text ? countLines(text) : 0), 0);

  return {
    ok: true,
    data: { repo: repoName, path: `${owner}/${repo}@${ref}`, total_files: files.length, code_files: codeFiles.length, lines_of_code: linesOfCode },
  };
}
