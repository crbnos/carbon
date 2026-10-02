// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { pickTrackedBody } from "@carbon/mes-core";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { pickTrackedEntity } from "~/services/commands.picking.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Pick (or unpick) one serial/batch lot for a picking line — the same
 * `pickTrackedEntity` command the action of
 * `x+/picking.$pickingListId.tracked.$lineId.tsx` runs.
 *
 * Writes run with the SERVICE ROLE here exactly as the web route does, and
 * `:listId` is decorative for the same reason it is there.
 */

const FAILURE_CODE: Record<CommandFailure["kind"], ApiErrorCode> = {
  validation: "validation_failed",
  forbidden: "forbidden",
  not_found: "not_found",
  conflict: "conflict",
  blocked: "blocked",
  needs_acknowledgement: "needs_acknowledgement",
  redirect: "conflict",
  error: "internal"
};

export const action = apiRoute(
  { method: "POST", body: pickTrackedBody },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: picking is not public");

    const result = await pickTrackedEntity(
      getCarbonServiceRole(),
      { companyId: user.companyId, userId: user.userId },
      {
        pickingListLineId: params.lineId,
        trackedEntityId: body.trackedEntityId,
        fromStorageUnitId: body.fromStorageUnitId ?? null,
        quantity: body.quantity,
        unpick: body.unpick ?? false
      }
    );

    if (!result.ok) {
      const { failure } = result;
      throw new ApiError(
        FAILURE_STATUS[failure.kind],
        FAILURE_CODE[failure.kind],
        failure.message,
        failure.fields,
        failure.details
      );
    }

    return { success: true, data: result.data };
  }
);

export const loader = methodNotAllowed();
