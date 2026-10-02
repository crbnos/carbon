// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { pickQuantityBody } from "@carbon/mes-core";
import type { CommandFailure } from "~/services/api-result.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { pickQuantity } from "~/services/commands.picking.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Set the picked quantity on an untracked picking line — the same
 * `pickQuantity` command `x+/picking.$pickingListId.line.quantity.tsx` runs, so
 * a pick made on a tablet produces the same `post-picking` call, the same
 * `itemLedger` rows and the same line status as one made in a browser.
 *
 * Writes run with the SERVICE ROLE here exactly as the web route does.
 *
 * `:listId` is decorative, as it is in the web route's URL: the line resolves
 * its own picking list, so nothing reads the list id.
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
  { method: "POST", body: pickQuantityBody },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: picking is not public");

    // The URL names the line; a body that names a different one is a
    // cross-resource write, not a pick, so it is refused rather than applied.
    if (params.lineId && body.pickingListLineId !== params.lineId) {
      throw new ApiError(
        400,
        "validation_failed",
        "The line in the body does not match the line in the path"
      );
    }

    const result = await pickQuantity(
      getCarbonServiceRole(),
      { companyId: user.companyId, userId: user.userId },
      {
        pickingListLineId: params.lineId,
        quantity: body.quantity,
        markShort: body.markShort ?? false
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
