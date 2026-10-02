// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { finishBody } from "@carbon/mes-core";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { finishOperation } from "~/services/commands.quantities.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Finish an operation — `finishOperation`, the body of `x+/finish.tsx`
 * unchanged: `finishJobOperation` with the service role, which flips the
 * operation to Done (firing `sync_finish_job_operation`) and runs the
 * `returnPickedRemainders` sweep.
 */
export const action = apiRoute(
  { method: "POST", body: finishBody },
  async ({ params, body, user }) => {
    if (!user)
      throw new Error("unreachable: /operations/:id/finish is private");

    const result = await finishOperation(
      {
        companyId: user.companyId,
        userId: user.userId,
        sessionUserId: user.sessionUserId,
        source: "mes_mobile"
      },
      { ...body, jobOperationId: params.id as string }
    );
    if (!result.ok) throw toApiError(result.failure);

    return { ok: true as const, finished: true as const };
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
