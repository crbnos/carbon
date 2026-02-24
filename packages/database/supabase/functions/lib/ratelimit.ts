import { createHash } from "node:crypto";
import { Kysely, sql } from "kysely";
import type { KyselyDatabase } from "./postgres/index.ts";

type RateLimitResult = {
  success: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: number;
};

/**
 * Check rate limit for API key requests in edge functions.
 *
 * Returns a 429 Response if rate limited, or null to continue.
 * No-ops if the request doesn't have a carbon-key header.
 *
 * Call this right after the OPTIONS/CORS check in each handler:
 *
 *   const rlResponse = await checkApiKeyRateLimit(db, req, corsHeaders);
 *   if (rlResponse) return rlResponse;
 */
export async function checkApiKeyRateLimit(
  db: Kysely<KyselyDatabase>,
  req: Request,
  corsHeaders: Record<string, string>
): Promise<Response | null> {
  const apiKey = req.headers.get("carbon-key");
  if (!apiKey) return null;

  const keyHash = createHash("sha256").update(apiKey).digest("hex");

  // Look up rate limit config by key hash
  const keyRow = await sql<{
    id: string;
    rateLimit: number;
    rateLimitWindow: string;
  }>`
    SELECT "id", "rateLimit", "rateLimitWindow"
    FROM "apiKey"
    WHERE "keyHash" = ${keyHash}
    LIMIT 1
  `.execute(db);

  if (!keyRow.rows.length) return null;

  const { id, rateLimit, rateLimitWindow } = keyRow.rows[0];

  // Check rate limit via Postgres function on unlogged table
  const result = await sql<RateLimitResult>`
    SELECT * FROM check_api_key_rate_limit(${id}, ${rateLimit}, ${rateLimitWindow})
  `.execute(db);

  const rl = result.rows[0];
  if (rl && !rl.success) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "X-RateLimit-Limit": rl.limit.toString(),
        "X-RateLimit-Remaining": rl.remaining.toString(),
        "X-RateLimit-Reset": rl.resetAt.toString(),
        "Retry-After": Math.ceil((rl.resetAt - Date.now()) / 1000).toString(),
      },
    });
  }

  return null;
}
