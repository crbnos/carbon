// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { inspectionCompletePassedBody } from "@carbon/mes-core";
import { completePassedInspectionUnits } from "~/services/commands.inspection.server";
import { getDatabaseClient } from "~/services/database.server";
import { toApiError } from "./lib/failure.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Complete the units that already passed, while the lot stays open — the same
 * `completePassedInspectionUnits` command
 * `x+/inspection-lot.$id.complete-passed.tsx` runs.
 *
 * Explicit, not auto-on-pass, so a verdict typo needs no compensating
 * transaction: an un-posted verdict stays editable. Double-posting is
 * structurally impossible — a sampled serial unit is guarded by the partial
 * UNIQUE index on `productionQuantity.inspectionSampleId`, and the non-serial
 * count nets what this lot already posted.
 */
export const action = apiRoute(
  {
    method: "POST",
    body: inspectionCompletePassedBody,
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

    const result = await completePassedInspectionUnits(
      {
        serviceRole: await getCarbonServiceRole(),
        client: user.client,
        db: getDatabaseClient()
      },
      { companyId: user.companyId, userId: user.userId },
      {
        inspectionId,
        operationId: body.operationId,
        // Named one by one: `eventIds` is spread into the posting payloads.
        eventIds: {
          setupProductionEventId: body.setupProductionEventId,
          laborProductionEventId: body.laborProductionEventId,
          machineProductionEventId: body.machineProductionEventId
        }
      }
    );
    if (!result.ok) throw toApiError(result.failure);

    return result.data;
  }
);

export const loader = methodNotAllowed();
