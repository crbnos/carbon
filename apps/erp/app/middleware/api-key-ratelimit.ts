import { getCarbonServiceRole } from "@carbon/auth";
import { hashApiKey } from "@carbon/auth/auth.server";
import { checkApiKeyRateLimit } from "@carbon/auth/ratelimit.server";
import type { MiddlewareFunction } from "react-router";

/**
 * Middleware that rate limits API key requests.
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

  await checkApiKeyRateLimit(row.id, row.rateLimit, row.rateLimitWindow);

  // Update lastUsedAt (fire-and-forget, don't block the request)
  serviceRole
    .from("apiKey")
    .update({ lastUsedAt: new Date().toISOString() } as any)
    .eq("id" as any, row.id)
    .then();
};
