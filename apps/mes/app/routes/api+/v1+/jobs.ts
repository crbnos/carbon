// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { HEADERS } from "@carbon/mes-core";
import { getJobsScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * Every open job at a location — web MES's `x+/jobs.tsx`, through the same
 * `getJobsScreen` that route now calls.
 *
 * Service role here as on the web, for the reason at the top of
 * `screens.server.ts`: RLS on `job` requires `production_view`, and the
 * floor rule is wider than a status filter — a job in a Released batch is
 * floor-visible before its own job is released — so an RLS read would show
 * an operator less on the tablet than in the browser.
 *
 * The location comes from the header rather than a session, like every other
 * screen read here: this API has no cookie to keep it in.
 */
export const loader = apiRoute({ method: "GET" }, async ({ request, user }) => {
  if (!user) throw new Error("unreachable: /jobs is not public");

  const locationId = request.headers.get(HEADERS.location)?.trim();
  if (!locationId) {
    throw new ApiError(
      400,
      "location_required",
      "Choose a location before loading jobs"
    );
  }

  // No failure branch: this read logs a database error and returns an empty
  // list rather than failing, exactly as `getActiveScreen` does. An operator
  // gets an empty board and a retry, not a dead screen mid-shift.
  const screen = await getJobsScreen(getCarbonServiceRole(), {
    companyId: user.companyId,
    locationId
  });

  return screen.data;
});
