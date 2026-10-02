// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLocationTimeZone } from "@carbon/database";
import { HEADERS } from "@carbon/mes-core";
import { datetime } from "@carbon/utils";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { getOperationsScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * The operations list, from the same `getOperationsScreen` the web route calls —
 * so what an operator sees on a tablet is what they see on web MES for the same
 * location and work centers.
 *
 * Reads run with the SERVICE ROLE here exactly as the web loader does. See the
 * note at the top of `screens.server.ts` for why a direct RLS read would show
 * an operator LESS than the web does.
 */
export const loader = apiRoute({ method: "GET" }, async ({ request, user }) => {
  if (!user) throw new Error("unreachable: /operations is not public");

  const locationId = request.headers.get(HEADERS.location)?.trim();
  if (!locationId) {
    throw new ApiError(
      400,
      "location_required",
      "Choose a location before loading operations"
    );
  }

  const url = new URL(request.url);
  const workCenterIds = (url.searchParams.get("workCenterIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  // The app sends the SAME `key:op:value` strings the web keeps in its filter
  // cookie, plus work centers as their own parameter because that is the one
  // filter the app's chips own.
  const filters = url.searchParams.getAll("filter").filter(Boolean);
  if (workCenterIds.length) {
    filters.push(`workCenterId:in:${workCenterIds.join(",")}`);
  }

  const screen = await getOperationsScreen(getCarbonServiceRole(), {
    companyId: user.companyId,
    locationId,
    effectiveUserId: user.userId,
    filters,
    search: url.searchParams.get("search"),
    // The web reads a cookie to remember that the operator dismissed their
    // manning-board station for today; the app has no cookie, so it says so in
    // the query instead. Without this an operator WITH a manning-board
    // assignment saw one column and had no way to reach the rest of the board.
    // The date must be the location's today, because that is what
    // `getOperationsScreen` compares it against.
    peopleOverrideDate: url.searchParams.get("allWorkCenters")
      ? datetime
          .today(
            await getLocationTimeZone(
              getCarbonServiceRole(),
              locationId,
              user.companyId
            )
          )
          .toString()
      : null
  });

  if (!screen.ok) {
    throw new ApiError(
      FAILURE_STATUS[screen.failure.kind],
      screen.failure.kind === "redirect" ? "conflict" : "internal",
      screen.failure.message,
      screen.failure.fields,
      screen.failure.details
    );
  }

  return screen.data;
});
