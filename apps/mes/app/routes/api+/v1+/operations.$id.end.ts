// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { completeFromScanBody } from "@carbon/mes-core";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { completeOperationFromScan } from "~/services/commands.time.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * The kanban scan completion — `completeOperationFromScan`, which is the body
 * of the `x+/end/:operationId` loader unchanged.
 *
 * Deliberately UNGATED, like that loader: no floor gate and no
 * blocked-work-center check. Closing out work that was physically done is
 * never refused; only the `operationFinish` rules apply, and only when this
 * scan finishes the operation.
 *
 * `outcome` is what the web loader turns into one of its three redirects:
 * `advance` carries the next serial unit, `finished` means the operation went
 * Done, `completed` means a part was booked and the operation stays open.
 */
export const action = apiRoute(
  { method: "POST", body: completeFromScanBody },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: /operations/:id/end is private");

    const result = await completeOperationFromScan(getCarbonServiceRole(), {
      companyId: user.companyId,
      userId: user.userId,
      sessionUserId: user.sessionUserId,
      operationId: params.id as string,
      trackedEntityId: body.trackedEntityId,
      acknowledged: body.acknowledged,
      source: "mes_mobile"
    });
    if (!result.ok) throw toApiError(result.failure);

    return {
      ok: true as const,
      outcome: result.data.outcome,
      trackedEntityId:
        result.data.outcome === "advance" ? result.data.trackedEntityId : null
    };
  }
);

export const loader = methodNotAllowed();

/** `FAILURE_STATUS` owns the status; only two kinds need a different code. */
function toApiError(failure: CommandFailure) {
  const code: ApiErrorCode =
    failure.kind === "redirect"
      ? "conflict"
      : failure.kind === "error"
        ? "internal"
        : failure.kind === "validation"
          ? "validation_failed"
          : failure.kind;
  return new ApiError(
    FAILURE_STATUS[failure.kind],
    code,
    failure.message,
    failure.fields
  );
}
