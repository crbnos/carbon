// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { quantityBody } from "@carbon/mes-core";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { reportQuantity } from "~/services/commands.quantities.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Report good parts — `reportQuantity`, the body of `x+/complete.tsx`
 * unchanged: the serial / batch / untracked branches, the production-event
 * tenant check, `finishJobOperation` when the target is reached, and the
 * auto-print that is wrapped in a try/catch so it can never block the
 * completion.
 *
 * `tracking` and `finished` are what the web action turns into its four
 * distinct responses, so the app can make the same four decisions.
 */
export const action = apiRoute(
  { method: "POST", body: quantityBody },
  async ({ params, body, user }) => {
    if (!user) {
      throw new Error("unreachable: /operations/:id/quantities is private");
    }

    const result = await reportQuantity(
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

    return {
      ok: true as const,
      tracking: result.data.tracking,
      finished: result.data.finished
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
