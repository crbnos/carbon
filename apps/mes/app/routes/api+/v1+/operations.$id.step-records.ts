// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { stepRecordBody } from "@carbon/mes-core/models";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { recordStep } from "~/services/commands.steps.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Record one step attribute on an operation — the same `recordStep` command
 * `x+/record.tsx` calls, so the untracked-material backflush fires here too
 * (and a backflush failure never blocks the record).
 *
 * The scope is the body's `jobOperationStepId`, which `insertAttributeRecord`
 * checks against the company; the path's operation id is what the app is on and
 * is not re-checked, exactly as on the web, where the form posts only the step.
 */
export const action = apiRoute(
  { method: "POST", body: stepRecordBody },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: this endpoint is not public");

    if (!params.id) {
      throw new ApiError(400, "validation_failed", "Missing operation id");
    }

    const result = await recordStep(
      getCarbonServiceRole(),
      { companyId: user.companyId, userId: user.userId },
      body
    );

    if (!result.ok) {
      const { failure } = result;
      throw new ApiError(
        FAILURE_STATUS[failure.kind],
        "internal",
        failure.message,
        failure.fields
        // No `details`: this command's only failure details are the raw DB or
        // edge-function error, which an API caller has no business reading.
      );
    }

    return { ok: true as const };
  }
);

export const loader = methodNotAllowed();
