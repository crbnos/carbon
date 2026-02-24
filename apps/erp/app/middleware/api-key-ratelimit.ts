import { getCarbonServiceRole } from "@carbon/auth";
import { hashApiKey } from "@carbon/auth/auth.server";
import { sql } from "kysely";
import type { MiddlewareFunction } from "react-router";
import { getDatabaseClient } from "~/services/database.server";

type RateLimitResult = {
  success: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: number;
};

/**
 * Middleware that rate limits API key requests using a Postgres unlogged table.
 *
 * Runs once per request before any route loader/action.
 * - If no `carbon-key` header: passes through (normal user auth)
 * - If expired key: throws 401
 * - If rate limited: throws 429 with X-RateLimit-* headers
 * - Otherwise: continues to the next middleware/loader
 */
export const apiKeyRateLimitMiddleware: MiddlewareFunction = async ({
  request
}) => {
  const apiKey = request.headers.get("carbon-key");
  if (!apiKey) return;

  const keyHash = hashApiKey(apiKey);
  const serviceRole = getCarbonServiceRole();

  const { data } = await serviceRole
    .from("apiKey")
    .select("id, rateLimit, rateLimitWindow, expiresAt")
    .eq("keyHash" as any, keyHash)
    .single();

  if (!data) return;

  const row = data as any;

  if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
    throw new Response("API key has expired", { status: 401 });
  }

  // Rate limit check via Postgres function on unlogged table
  const db = getDatabaseClient();
  const result = await sql<RateLimitResult>`
    SELECT * FROM check_api_key_rate_limit(
      ${row.id},
      ${row.rateLimit ?? 1000},
      ${row.rateLimitWindow ?? "1h"}
    )
  `.execute(db);

  const rl = result.rows[0];
  if (rl && !rl.success) {
    throw new Response("Rate limit exceeded", {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "X-RateLimit-Limit": rl.limit.toString(),
        "X-RateLimit-Remaining": rl.remaining.toString(),
        "X-RateLimit-Reset": rl.resetAt.toString(),
        "Retry-After": Math.ceil((rl.resetAt - Date.now()) / 1000).toString()
      }
    });
  }

  // Update lastUsedAt (fire-and-forget, don't block the request)
  serviceRole
    .from("apiKey")
    .update({ lastUsedAt: new Date().toISOString() } as any)
    .eq("id" as any, row.id)
    .then();
};
