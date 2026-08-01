// Hono route for GET /api/repo_stats.php — admin-only.

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseSettingsStore } from "../db";
import { isValidAdminToken } from "../auth";
import { createGithubGateway, resolveGithubRepo } from "../lib/github-gateway";
import { buildRepoStats } from "../repo-stats";

export const repoStatsRoute = new Hono<{ Bindings: Env }>();

repoStatsRoute.get("/api/repo_stats.php", async (c) => {
  if (!(await isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token")))) {
    return fail(c, "Unauthorized", 401);
  }
  const db = createDb(c.env);
  const settings = new SupabaseSettingsStore(db, c.env.R2_PUBLIC);
  const { owner, repo, repoName } = resolveGithubRepo(await settings.getSetting("dev_env"));
  const token = (await settings.getSetting("github_token")) ?? "";
  const ref = c.req.query("ref") ?? "main";

  const result = await buildRepoStats(createGithubGateway(token), repoName, owner, repo, ref);
  return result.ok ? ok(c, result.data) : fail(c, result.error!, result.status);
});
