// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { clockInCommand } from "~/services/commands.timecard.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Clock in — the same `clockInCommand` the `TimeCardButton` runs through
 * `api+/timecard.ts`, so one `timeCardEntry` row looks the same whether it was
 * opened from a tablet or a browser.
 *
 * No body: who is clocking in is the authenticated (or pinned) user, never a
 * field. The read runs as that user, like the web route's `client`.
 *
 * It still needs an `Idempotency-Key`: a retried clock-in would otherwise be
 * refused as "Already clocked in" and read to the operator as a failure.
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

  const result = await clockInCommand(user.client, {
    companyId: user.companyId,
    userId: user.userId
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

  return { success: true };
});

export const loader = methodNotAllowed();
