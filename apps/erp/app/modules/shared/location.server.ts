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
 * `?location=` is present (the common case once a screen has loaded) neither
 * query runs, and when it is absent the user's default almost always resolves
 * it in one. Issuing both concurrently would add a query to the common path to
 * save a round-trip on the rare one.
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
