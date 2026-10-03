// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { unconsumeBody } from "@carbon/mes-core/models";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { unconsumeTrackedEntities } from "~/services/commands.materials.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Undo a tracked consumption — return the entities to stock. The same
 * `unconsumeTrackedEntities` command `x+/unconsume.tsx` calls.
 *
 * The scope is `materialId` (the job material the entities were consumed
 * against), not the path's operation: a material is the thing an operator undoes.
 *
 * A `materialReceive` storage-rule refusal answers 409 `blocked` with the
 * violations in `details`. The web route answers the same refusal 400 with the
 * violations inline — its Materials dialog reads that status, and changing it
 * was out of scope here.
 */
export const action = apiRoute(
  { method: "POST", body: unconsumeBody },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: this endpoint is not public");

    const jobOperationId = params.id;
    if (!jobOperationId) {
      throw new ApiError(400, "validation_failed", "Missing operation id");
    }

    const result = await unconsumeTrackedEntities(
      getCarbonServiceRole(),
      { companyId: user.companyId, userId: user.userId },
      { ...body, jobOperationId }
    );

    if (!result.ok) {
      const { failure } = result;
      throw new ApiError(
        FAILURE_STATUS[failure.kind],
        failure.kind === "blocked"
          ? "blocked"
          : failure.kind === "not_found"
            ? "not_found"
            : failure.kind === "validation"
              ? "validation_failed"
              : "internal",
        failure.message,
        failure.fields,
        // Only a refusal the app must RENDER carries `details`; an internal
        // failure's details are the raw DB or edge-function error.
        failure.kind === "blocked" ? failure.details : undefined
      );
    }

    return { ok: true as const };
  }
);

export const loader = methodNotAllowed();
