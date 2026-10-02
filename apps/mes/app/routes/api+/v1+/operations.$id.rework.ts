// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { reworkBody } from "@carbon/mes-core";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { reportRework } from "~/services/commands.quantities.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Report rework — `reportRework`, the body of `x+/rework.tsx` unchanged: one
 * `insertReworkQuantity` through the caller's own RLS-scoped client, exactly
 * as the web action writes it.
 */
export const action = apiRoute(
  { method: "POST", body: reworkBody },
  async ({ params, body, user }) => {
    if (!user)
      throw new Error("unreachable: /operations/:id/rework is private");

    const result = await reportRework(
      user.client,
      {
        companyId: user.companyId,
        userId: user.userId,
        sessionUserId: user.sessionUserId,
        source: "mes_mobile"
      },
      { ...body, jobOperationId: params.id as string }
    );
    if (!result.ok) throw toApiError(result.failure);

    return { ok: true as const, reworked: true as const };
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
