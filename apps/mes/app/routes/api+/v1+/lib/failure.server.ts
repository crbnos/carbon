// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";

/**
 * One `CommandFailure` → one `ApiError`.
 *
 * `FAILURE_STATUS` already owns the status; this owns the error CODE, which is
 * the same mapping every endpoint in this directory writes by hand. The
 * existing routes each keep their own copy — this is the shared one, used by
 * the inspection endpoints rather than a sixth and seventh transcription of
 * the same ten lines.
 */
export const FAILURE_CODE: Record<CommandFailure["kind"], ApiErrorCode> = {
  validation: "validation_failed",
  forbidden: "forbidden",
  not_found: "not_found",
  conflict: "conflict",
  blocked: "blocked",
  needs_acknowledgement: "needs_acknowledgement",
  // The operator's permissions are fine; the work simply is not where they
  // are. A 409 with the message they would have read on the web.
  redirect: "conflict",
  error: "internal"
};

export function toApiError(failure: CommandFailure) {
  return new ApiError(
    FAILURE_STATUS[failure.kind],
    FAILURE_CODE[failure.kind],
    failure.message,
    failure.fields,
    failure.details
  );
}
