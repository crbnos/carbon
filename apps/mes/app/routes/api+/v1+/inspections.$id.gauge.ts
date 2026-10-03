// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { inspectionGaugeBody } from "@carbon/mes-core";
import { setInspectionGauge } from "~/services/commands.inspection.server";
import { getDatabaseClient } from "~/services/database.server";
import { toApiError } from "./lib/failure.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Record which gauge measured one characteristic of this lot — the same
 * `setInspectionGauge` command `x+/inspection-lot.$id.gauge.tsx` runs, so the
 * closed-lot guard, the company-scoped gauge check, the Inactive refusal and
 * the gauge-type match are identical on both clients.
 *
 * The record is per lot x characteristic, not per measurement — one gauge per
 * characteristic per lot, as FAI forms work. An empty `gaugeId` clears it.
 */
export const action = apiRoute(
  {
    method: "POST",
    body: inspectionGaugeBody,
    permissions: { update: "quality" }
  },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: inspections is not public");

    const inspectionId = params.id;
    if (!inspectionId) {
      throw new ApiError(400, "validation_failed", "No inspection was given");
    }
    if (body.inspectionId !== inspectionId) {
      throw new ApiError(
        400,
        "validation_failed",
        "The inspection in the body does not match the inspection in the path"
      );
    }

    const result = await setInspectionGauge(
      getDatabaseClient(),
      { companyId: user.companyId, userId: user.userId },
      {
        inspectionId,
        inspectionFeatureId: body.inspectionFeatureId,
        gaugeId: body.gaugeId
      }
    );
    if (!result.ok) throw toApiError(result.failure);

    return result.data;
  }
);

export const loader = methodNotAllowed();
