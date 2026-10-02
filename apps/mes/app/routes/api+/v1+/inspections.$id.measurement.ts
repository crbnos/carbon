// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { inspectionMeasurementBody } from "@carbon/mes-core";
import { recordInspectionMeasurement } from "~/services/commands.inspection.server";
import { getDatabaseClient } from "~/services/database.server";
import { toApiError } from "./lib/failure.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * One cell of the features x samples grid — the same
 * `recordInspectionMeasurement` command
 * `x+/inspection-lot.$id.measurement.tsx` runs, so a reading taken on a tablet
 * is valuated against the same live tolerances, derives the same sample status
 * and recomputes the same lot status as one typed in a browser.
 *
 * The write runs through the Kysely pool (the transactional quality engine),
 * exactly as the web route does.
 *
 * The response is what the app mirrors locally instead of refetching the
 * screen: a per-cell save must not cost a reload.
 */
export const action = apiRoute(
  {
    method: "POST",
    body: inspectionMeasurementBody,
    permissions: { update: "quality" }
  },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: inspections is not public");

    const inspectionId = params.id;
    if (!inspectionId) {
      throw new ApiError(400, "validation_failed", "No inspection was given");
    }
    // The URL names the lot; a body that names a different one is a
    // cross-resource write, not a measurement, so it is refused.
    if (body.inspectionId !== inspectionId) {
      throw new ApiError(
        400,
        "validation_failed",
        "The inspection in the body does not match the inspection in the path"
      );
    }

    const result = await recordInspectionMeasurement(
      getDatabaseClient(),
      {
        companyId: user.companyId,
        // The reading is the OPERATOR's, not the terminal's.
        userId: user.userId
      },
      { ...body, inspectionId }
    );
    if (!result.ok) throw toApiError(result.failure);

    return result.data;
  }
);

export const loader = methodNotAllowed();
