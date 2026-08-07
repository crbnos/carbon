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
 * Note the ordering is deliberately sequential, not parallel: when
 * `?location=` is present (the common case once a screen has loaded) only the
 * company-scoping probe runs, and when it is absent the user's default almost
 * always resolves it in one. Issuing them concurrently would add a query to the
 * common path to save a round-trip on the rare one.
 *
 * The returned id is always one that belongs to `companyId` — callers rely on
 * that, because several run with `bypassRls: true` and then filter only on the
 * location.
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

  // `?location=` is attacker-controlled, and five of the six callers run with
  // `bypassRls: true`. Several of the queries they then issue filter on the
  // location alone with no company predicate — `get_jobs_by_date_range` and
  // `get_unscheduled_jobs` (both `WHERE j."locationId" = location_id`),
  // `get_active_job_operations_by_location`, and the `workCenters` reads — so a
  // foreign location id in the URL would return another tenant's rows. An
  // unknown or foreign id falls back to the user's default rather than 404ing,
  // which is what a stale bookmark should do. The probe hits the composite
  // primary key ("id", "companyId"), so it is an index-only lookup.
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
