// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { clockOutBody } from "@carbon/mes-core";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { clockOutCommand } from "~/services/commands.timecard.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Clock out — the same `clockOutCommand` `api+/timecard.ts` runs, including the
 * optional shift `note` that route added.
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
  { method: "POST", body: clockOutBody },
  async ({ body, user }) => {
    if (!user) throw new Error("unreachable: timecard is not public");

    const result = await clockOutCommand(
      user.client,
      { companyId: user.companyId, userId: user.userId },
      { note: body.note }
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

    return { success: true };
  }
);

export const loader = methodNotAllowed();
