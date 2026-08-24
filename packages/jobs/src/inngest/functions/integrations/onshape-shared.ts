import type { Database } from "@carbon/database";
import { getOnshapeClient, OnshapeApiError } from "@carbon/ee/onshape";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RetryAfterError } from "inngest";

// Helpers shared by every Onshape job. They used to live in onshape-backfill.ts,
// which was the legacy asset-sync backfill; that job is gone, these are not.

type CarbonClient = SupabaseClient<Database>;

const RATE_LIMIT_DEFAULT_WAIT_SECONDS = 60;
const RATE_LIMIT_MAX_WAIT_SECONDS = 300;

/**
 * On a 429, surface it to Inngest as a RetryAfterError rather than blocking the
 * step with an in-process sleep. Inngest SUSPENDS the function — releasing its
 * compute window and its concurrency slot — and reschedules it after the delay;
 * memoized steps mean it resumes at the first unfinished item, and every
 * export/attach is idempotent so a re-run is safe. The wait honors Onshape's
 * Retry-After (default 60s), clamped to a sane maximum. Anything else rethrows.
 */
export async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof OnshapeApiError && error.status === 429) {
      const waitSeconds = Math.min(
        error.retryAfterSeconds ?? RATE_LIMIT_DEFAULT_WAIT_SECONDS,
        RATE_LIMIT_MAX_WAIT_SECONDS
      );
      throw new RetryAfterError(
        `onshape: rate limited on ${label}; retrying after ${waitSeconds}s`,
        waitSeconds * 1000,
        { cause: error }
      );
    }
    throw error;
  }
}

/**
 * The Onshape tenant this company's connection acts against.
 *
 * Prefers the id captured at connect (explicit and stable) over guessing
 * `getCompanies()[0]`, which is ambiguous for a multi-company Onshape account.
 */
export async function resolveOnshapeCompanyId(
  carbon: CarbonClient,
  input: { companyId: string; userId: string }
): Promise<string> {
  const stored = await carbon
    .from("companyIntegration")
    .select("metadata")
    .eq("id", "onshape")
    .eq("companyId", input.companyId)
    .maybeSingle();
  const storedCompanyId = (
    stored.data?.metadata as Record<string, unknown> | undefined
  )?.onshapeCompanyId;
  if (typeof storedCompanyId === "string" && storedCompanyId) {
    return storedCompanyId;
  }

  const onshape = await getOnshapeClient(carbon, input.companyId, input.userId);
  if (onshape.error || !onshape.client) {
    throw new Error(
      `resolveOnshapeCompanyId: getOnshapeClient failed: ${
        onshape.error ?? "no client"
      }`
    );
  }
  const companies = await onshape.client.getCompanies();
  const onshapeCompanyId = companies[0]?.id;
  if (!onshapeCompanyId) {
    throw new Error(
      "resolveOnshapeCompanyId: could not resolve an Onshape company id — pass onshapeCompanyId explicitly"
    );
  }
  return onshapeCompanyId;
}
