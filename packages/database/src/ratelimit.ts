import type { SupabaseClient } from "@supabase/supabase-js";

/** Postgres foreign-key violation. */
const FK_VIOLATION = "23503";

/**
 * The API key no longer exists. `apiKeyRateLimit.apiKeyId` is
 * `REFERENCES "apiKey"(id) ON DELETE CASCADE`, so recording a request against a
 * key deleted moments ago (while its auth record is still cached) violates that
 * FK. Callers turn this into a 401 — the key is gone, which is an auth outcome,
 * not a server fault.
 */
export class ApiKeyNotFoundError extends Error {
  constructor() {
    super("API key no longer exists");
    this.name = "ApiKeyNotFoundError";
  }
}

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
  client: SupabaseClient,
  apiKeyId: string,
  limit: number,
  window: string
): Promise<RateLimitResult> {
  const { data, error } = await client.rpc("check_api_key_rate_limit", {
    p_api_key_id: apiKeyId,
    p_limit: limit,
    p_window: window
  });

  if (error) {
    if (error.code === FK_VIOLATION) throw new ApiKeyNotFoundError();
    // Supabase hands back a plain object, not an Error. Throwing it raw reached
    // React Router's resource-route fallback, which stringified it to the
    // literal "[object Object]" — wrap it so the failure is legible.
    throw new Error(
      `check_api_key_rate_limit failed: ${error.message ?? JSON.stringify(error)}`,
      { cause: error }
    );
  }
  return data as RateLimitResult;
}
