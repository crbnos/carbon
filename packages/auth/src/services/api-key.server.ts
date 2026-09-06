import { createHash } from "node:crypto";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import { oncePerRequest } from "@carbon/logger/middleware.server";
import { getCarbonServiceRole } from "../lib/supabase/client.server";

const log = getLogger("auth");

const API_KEY_CACHE_PREFIX = "apikey:auth:";
// Short on purpose: the record carries scopes/expiry/rate-limit config, so a
// revoked or re-scoped key can act for at most this long (the api-keys routes
// additionally bust the entry on edit/revoke). Negative results are cached too —
// a bad key hammering the endpoint must not hammer Postgres.
const API_KEY_CACHE_TTL_SECONDS = 30;

/** Hash an API key using SHA-256 for secure storage/lookup */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export type ApiKeyRecord = {
  id: string;
  companyId: string;
  companyGroupId: string;
  createdBy: string;
  scopes: Record<string, string[]>;
  rateLimit: number;
  rateLimitWindow: "1m" | "1h" | "1d";
  expiresAt: string | null;
};

export function apiKeyCacheKey(keyHash: string): string {
  return `${API_KEY_CACHE_PREFIX}${keyHash}`;
}

/**
 * The apiKey row for a raw key, through a ~30s Redis cache. One HTTP API call
 * resolves the key twice (requirePermissions and the v1 scope read), so the
 * lookup is also memoized per request — safe for a credential row because the
 * request is authenticated BY that credential; nothing inside the request can
 * revoke it and then expect the same request to see the revocation.
 */
export function getApiKeyRecord(rawKey: string): Promise<ApiKeyRecord | null> {
  const keyHash = hashApiKey(rawKey);
  return oncePerRequest(`apikey:${keyHash}`, () => loadApiKeyRecord(keyHash));
}

async function loadApiKeyRecord(keyHash: string): Promise<ApiKeyRecord | null> {
  try {
    const cached = await redis.get(apiKeyCacheKey(keyHash));
    // The literal string "null" is a cached negative — an unknown key we already
    // looked up. A Redis miss (null) falls through to the database.
    if (cached) return JSON.parse(cached) as ApiKeyRecord | null;
  } catch (e) {
    log.error("Failed to read api key cache", { error: e });
  }

  const { data } = await getCarbonServiceRole()
    .from("apiKey")
    .select(
      "id, companyId, ...company(companyGroupId), createdBy, scopes, rateLimit, rateLimitWindow, expiresAt"
    )
    .eq("keyHash", keyHash)
    .single();

  const record = (data as unknown as ApiKeyRecord | null) ?? null;

  // Best-effort: a failed write (Redis down, fail-soft via @carbon/kv
  // withResilience) must never abort the request — we have the row from the DB.
  try {
    await redis.set(
      apiKeyCacheKey(keyHash),
      JSON.stringify(record),
      "EX",
      API_KEY_CACHE_TTL_SECONDS
    );
  } catch (e) {
    log.error("Failed to cache api key record", { error: e });
  }

  return record;
}

/** Drop the cached record for a key hash — call when the key is edited or revoked. */
export async function bustApiKeyCache(keyHash: string): Promise<void> {
  try {
    await redis.del(apiKeyCacheKey(keyHash));
  } catch (e) {
    log.error("Failed to bust api key cache", { error: e });
  }
}
