// Hono route for GET /api/github_log.php — admin-only. Wraps buildGithubCommitLog with
// Cloudflare's Cache API as the Worker-native replacement for the PHP's 10-minute file cache
// (see src/github-log.ts's header for why a literal file cache has no equivalent here).

import { Hono } from "hono";
import type { Env } from "../types";
import { ok, fail } from "../lib/http";
import { createDb, SupabaseAdminAuthStore, SupabaseSettingsStore } from "../db";
import { isValidAdminToken } from "../auth";
import { createGithubGateway, resolveGithubRepo } from "../lib/github-gateway";
import { buildGithubCommitLog } from "../github-log";

export const githubLogRoute = new Hono<{ Bindings: Env }>();

const CACHE_TTL_SECONDS = 600;

githubLogRoute.get("/api/github_log.php", async (c) => {
  if (!(await isValidAdminToken(new SupabaseAdminAuthStore(createDb(c.env)), c.req.header("X-Admin-Token")))) {
    return fail(c, "Unauthorized", 401);
  }
  const db = createDb(c.env);
  const settings = new SupabaseSettingsStore(db, c.env.R2_PUBLIC);
  const { owner, repo } = resolveGithubRepo(await settings.getSetting("dev_env"));
  const noCache = c.req.query("refresh") === "1";

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/github-log/${owner}/${repo}`);
  if (!noCache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const token = (await settings.getSetting("github_token")) ?? "";
  const result = await buildGithubCommitLog(createGithubGateway(token), owner, repo);
  if (!result.ok) return fail(c, result.error!, result.status);

  const response = ok(c, result.data);
  const cacheable = new Response(response.body, response);
  cacheable.headers.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
  c.executionCtx.waitUntil(cache.put(cacheKey, cacheable.clone()));
  return cacheable;
});
