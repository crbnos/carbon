// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { issueTrackedBody } from "@carbon/mes-core/models";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { issueTrackedEntities } from "~/services/commands.materials.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Issue scanned serials or lots to one operation, or — with `batchId` — to
 * every member of an operation batch. The same `issueTrackedEntities` command
 * `x+/issue-tracked-entity.tsx` calls, so genealogy and costing are identical.
 *
 * `splitEntities` comes back so the app can update the lineside quantities it
 * is showing without a refetch, exactly as the web dialog does.
 */
export const action = apiRoute(
  { method: "POST", body: issueTrackedBody },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: this endpoint is not public");

    const jobOperationId = params.id;
    if (!jobOperationId) {
      throw new ApiError(400, "validation_failed", "Missing operation id");
    }

    const result = await issueTrackedEntities(
      getCarbonServiceRole(),
      { companyId: user.companyId, userId: user.userId },
      { ...body, jobOperationId }
    );

    if (!result.ok) {
      const { failure } = result;
      throw new ApiError(
        FAILURE_STATUS[failure.kind],
        failure.kind === "validation" ? "validation_failed" : "internal",
        failure.message,
        failure.fields
        // No `details`: this command's only failure details are the raw DB or
        // edge-function error, which an API caller has no business reading.
      );
    }

    return {
      ok: true as const,
      splitEntities: result.data.splitEntities,
      warning: result.data.warning ?? null
    };
  }
);

export const loader = methodNotAllowed();
