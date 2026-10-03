// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { endShift } from "~/services/commands.timecard.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * End the operator's shift — the same `endShift` command `x+/end-shift.tsx`
 * runs: close every open production event, then clock out when the company
 * runs time cards.
 *
 * `endedConsole` is what the web route turns into a `clearConsolePinIn`
 * `Set-Cookie`. There is no cookie on this path, so the app drops its operator
 * token when it sees the flag — the pinned operator is pinned out either way.
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

export const action = apiRoute({ method: "POST" }, async ({ user }) => {
  if (!user) throw new Error("unreachable: timecard is not public");

  const result = await endShift(user.client, getCarbonServiceRole(), {
    companyId: user.companyId,
    userId: user.userId,
    consoleMode: user.consoleMode
  });

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

  return { ok: true, endedConsole: result.data.endedConsole };
});

export const loader = methodNotAllowed();
