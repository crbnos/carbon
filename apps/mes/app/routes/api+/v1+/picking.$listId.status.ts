// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { pickingListStatusBody } from "@carbon/mes-core";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { setPickingListStatus } from "~/services/commands.picking.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Move a picking list's status — the same `setPickingListStatus` command
 * `x+/picking.$pickingListId.status.tsx` runs, so the
 * `incompletePickingListPolicy` enforcement, the Completed→Partial decision and
 * the "reopen from the ERP" refusal are identical on both clients.
 *
 * The two policy outcomes are 409s that carry the lines in `details`:
 *
 *   - `blocked` — the company policy is `error`; the finish cannot proceed.
 *   - `needs_acknowledgement` — the policy is `warn`; retry with
 *     `acknowledged: true` (a NEW `Idempotency-Key`, since it is a new request)
 *     after the operator confirms the shortfall.
 *
 * Writes run with the SERVICE ROLE here exactly as the web route does.
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
  { method: "POST", body: pickingListStatusBody },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: picking is not public");

    const result = await setPickingListStatus(
      getCarbonServiceRole(),
      { companyId: user.companyId, userId: user.userId },
      {
        pickingListId: params.listId,
        status: body.status,
        acknowledged: body.acknowledged ?? false
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

    // The terminal status the policy chose, which the app shows on the list —
    // asking to finish can land on `Partial` rather than `Completed`.
    return { success: true, status: result.data.status };
  }
);

export const loader = methodNotAllowed();
