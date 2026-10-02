// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { inspectionSampleBody } from "@carbon/mes-core";
import { recordInspectionSample } from "~/services/commands.inspection.server";
import { getDatabaseClient } from "~/services/database.server";
import { toApiError } from "./lib/failure.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Record a sample — the same `recordInspectionSample` command
 * `x+/inspection-lot.$id.sample.tsx` runs.
 *
 * Three shapes, all one endpoint, as on the web: a serial scan upserts by its
 * `trackedEntityId` (`status: "Pending"` is an identify-only scan, which
 * registers a column with no verdict), the no-document "Overall result" cell
 * re-toggles an anonymous column in place by `sampleId`, and anything else
 * inserts a fresh anonymous sample.
 *
 * `trackedEntityId` is a caller-supplied id, so the command re-reads it under
 * the caller's company before the superuser engine links it — a 404 with
 * `fields.trackedEntityId` set.
 */
export const action = apiRoute(
  {
    method: "POST",
    body: inspectionSampleBody,
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

    const result = await recordInspectionSample(
      getDatabaseClient(),
      {
        companyId: user.companyId,
        // `inspectedBy` is the OPERATOR — the inspection record is a signature.
        userId: user.userId
      },
      { ...body, inspectionId }
    );
    if (!result.ok) throw toApiError(result.failure);

    return result.data;
  }
);

export const loader = methodNotAllowed();
