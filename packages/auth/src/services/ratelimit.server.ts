import { redis } from "@carbon/kv";
import { Ratelimit } from "@upstash/ratelimit";

type RateLimitWindow = "1m" | "1h" | "1d";

/**
 * Check rate limit for an API key at the application layer.
 * Provides proper 429 responses with X-RateLimit-* headers.
 *
 * This is the application-level counterpart to the DB-level
 * check_api_key_rate_limit() function. Both exist because:
 * - DB rate limiting catches direct PostgREST requests
 * - App rate limiting provides better error responses with headers
 */
export async function checkApiKeyRateLimit(
  apiKeyId: string,
  limit: number,
  window: RateLimitWindow
): Promise<void> {
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(limit, window),
    prefix: "api-key-rl"
  });

  const {
    success,
    limit: l,
    remaining,
    reset
  } = await ratelimit.limit(apiKeyId);

  if (!success) {
    throw new Response("Rate limit exceeded", {
      status: 429,
      headers: {
        "X-RateLimit-Limit": l.toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": reset.toString(),
        "Retry-After": Math.ceil((reset - Date.now()) / 1000).toString()
      }
    });
  }
}
