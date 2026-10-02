// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createClient } from "@supabase/supabase-js";

export type RateLimitResult = {
  success: boolean;
  count: number;
  limit: number;
  remaining: number;
  resetAt: number;
};

/**
 * Check rate limit for an API key using the Postgres
 * check_api_key_rate_limit() function via Supabase .rpc().
 *
 * Returns the rate limit result. Callers are responsible for
 * throwing/returning an appropriate 429 response when !success.
 */
export async function checkApiKeyRateLimit(
  client: ReturnType<typeof createClient>,
  apiKeyId: string,
  limit: number,
  window: string
): Promise<RateLimitResult> {
  const { data, error } = await client.rpc("check_api_key_rate_limit", {
    p_api_key_id: apiKeyId,
    p_limit: limit,
    p_window: window,
  });

  if (error) throw error;
  return data as RateLimitResult;
}
