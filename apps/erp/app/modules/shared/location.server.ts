import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "react-router";
import { getLocationsList } from "~/modules/resources";
import { getUserDefaults } from "~/modules/users/users.server";

/**
 * Resolve the location a location-scoped screen should render.
 *
 * Precedence: the `?location=` search param, then the user's default location,
 * then the company's first location. Each of the six planning/scheduling
 * screens carried its own copy of this, differing only in where they redirect
 * on failure.
 *
 * The steps run sequentially on purpose: each one usually resolves the id, so
 * running them concurrently would add queries to the common path to save a
 * round-trip on the rare one.
 *
 * The returned id always belongs to `companyId` — callers rely on that, because
 * several run with `bypassRls: true` and then filter only on the location.
 */
export async function resolveLocationId(
  client: SupabaseClient<Database>,
  request: Request,
  args: {
    searchParams: URLSearchParams;
    userId: string;
    companyId: string;
    /** Where to send the user if their defaults can't be read. */
    onDefaultsError: string;
    /** Where to send the user if the company has no locations. */
    onNoLocations: string;
  }
): Promise<string> {
  const { searchParams, userId, companyId, onDefaultsError, onNoLocations } =
    args;

  let locationId = searchParams.get("location");

  // `?location=` is attacker-controlled and five of the six callers run with
  // `bypassRls: true`, over queries that filter on the location with no company
  // predicate of their own (`get_jobs_by_date_range`, `get_unscheduled_jobs`,
  // `get_active_job_operations_by_location`, the `workCenters` reads) — so a
  // foreign id here would return another tenant's rows. Falls back to the
  // user's default rather than 404ing, which is what a stale bookmark should do.
  if (locationId) {
    const requested = await client
      .from("location")
      .select("id")
      .eq("id", locationId)
      .eq("companyId", companyId)
      .maybeSingle();

    if (requested.error || !requested.data) {
      locationId = null;
    }
  }

  if (!locationId) {
    const userDefaults = await getUserDefaults(client, userId, companyId);
    if (userDefaults.error) {
      throw redirect(
        onDefaultsError,
        await flash(
          request,
          error(userDefaults.error, "Failed to load default location")
        )
      );
    }

    locationId = userDefaults.data?.locationId ?? null;
  }

  if (!locationId) {
    const locations = await getLocationsList(client, companyId);
    if (locations.error || !locations.data?.length) {
      throw redirect(
        onNoLocations,
        await flash(
          request,
          error(locations.error, "Failed to load any locations")
        )
      );
    }
    locationId = locations.data[0].id as string;
  }

  return locationId;
}
