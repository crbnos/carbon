import { Redis } from "https://esm.sh/@upstash/redis@1.34.3";
import { Ratelimit } from "https://esm.sh/@upstash/ratelimit@2.0.5";

type RateLimitWindow = "1m" | "1h" | "1d";

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    const url = Deno.env.get("UPSTASH_REDIS_REST_URL");
    const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN");
    if (!url || !token) {
      throw new Error(
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for rate limiting"
      );
    }
    redis = new Redis({ url, token });
  }
  return redis;
}

/**
 * Check rate limit for an API key in Supabase edge functions.
 *
 * Returns rate limit headers and success status.
 * Callers should return a 429 response when success is false.
 */
export async function checkRateLimit(
  apiKeyId: string,
  limit: number,
  window: RateLimitWindow
): Promise<{
  success: boolean;
  headers: Record<string, string>;
}> {
  const ratelimit = new Ratelimit({
    redis: getRedis(),
    limiter: Ratelimit.fixedWindow(limit, window),
    prefix: "api-key-rl",
  });

  const result = await ratelimit.limit(apiKeyId);

  return {
    success: result.success,
    headers: {
      "X-RateLimit-Limit": result.limit.toString(),
      "X-RateLimit-Remaining": result.remaining.toString(),
      "X-RateLimit-Reset": result.reset.toString(),
      "Retry-After": Math.ceil((result.reset - Date.now()) / 1000).toString(),
    },
  };
}
