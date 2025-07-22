import type { Database } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitize } from "~/utils/supabase";

export function getMetricSettingsKey(companyId: string) {
  return `metric:${companyId}`;
}

export async function getMetricSettings(
  client: SupabaseClient<Database>,
  companyId: string
) {
  const key = getMetricSettingsKey(companyId);

  // Try to get from cache first
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return cached === "true" || cached === true;
    }
  } catch (error) {
    // If cache fails, continue to database
  }

  // Fetch from database if not in cache
  const { data } = await client
    .from("companySettings")
    .select("useMetric")
    .eq("id", companyId)
    .single();

  const useMetric = data?.useMetric ?? false;

  // Store in cache for future use
  try {
    await redis.set(key, useMetric.toString());
  } catch (error) {
    // Log cache write error but don't fail the request
  }

  return useMetric;
}

export async function setMetricSettings(
  client: SupabaseClient<Database>,
  companyId: string,
  useMetric: boolean
) {
  const result = await client
    .from("companySettings")
    .update(sanitize({ useMetric }))
    .eq("id", companyId);

  // Update cache if database update was successful
  if (!result.error) {
    const key = getMetricSettingsKey(companyId);
    try {
      await redis.set(key, useMetric.toString());
    } catch (error) {
      // Log cache write error but don't fail the request
    }
  }

  return result;
}
