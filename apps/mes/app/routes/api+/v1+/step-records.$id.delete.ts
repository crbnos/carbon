// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { deleteStepRecord } from "~/services/commands.steps.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Delete one step record — the same `deleteStepRecord` command
 * `x+/record.$id.delete.tsx` calls. `deleteAttributeRecord` scopes the delete by
 * `companyId`, so a caller-supplied id cannot reach another tenant's row.
 *
 * A POST rather than a DELETE, matching the web route it mirrors, so the
 * idempotency window applies: an operator on a dropped connection must not be
 * able to delete a second record by retrying.
 */
export const action = apiRoute({ method: "POST" }, async ({ params, user }) => {
  if (!user) throw new Error("unreachable: this endpoint is not public");

  if (!params.id) {
    throw new ApiError(400, "validation_failed", "Missing step record id");
  }

  const result = await deleteStepRecord(
    getCarbonServiceRole(),
    { companyId: user.companyId, userId: user.userId },
    { id: params.id }
  );

  if (!result.ok) {
    const { failure } = result;
    throw new ApiError(
      FAILURE_STATUS[failure.kind],
      "internal",
      failure.message,
      failure.fields
    );
  }

  return { ok: true as const };
});

export const loader = methodNotAllowed();
