// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { noteBody } from "@carbon/mes-core/models";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { addOperationNote } from "~/services/commands.steps.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Post a note on an operation's chat.
 *
 * This endpoint has no web counterpart: `Chat.tsx` inserts the row straight from
 * the browser as the signed-in user. It exists because that is wrong for a
 * shared tablet — the note must be attributed to the PINNED operator, which is
 * what `user.userId` is once an operator token is present, not to the terminal
 * account the browser session belongs to.
 *
 * `jobOperationNote` has no foreign key to `jobOperation`, so the command's
 * company-scoped read of the operation is the tenant check.
 */
export const action = apiRoute(
  { method: "POST", body: noteBody },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: this endpoint is not public");

    if (!params.id) {
      throw new ApiError(400, "validation_failed", "Missing operation id");
    }

    const result = await addOperationNote(
      getCarbonServiceRole(),
      { companyId: user.companyId, userId: user.userId },
      { jobOperationId: params.id },
      body
    );

    if (!result.ok) {
      const { failure } = result;
      throw new ApiError(
        FAILURE_STATUS[failure.kind],
        failure.kind === "not_found" ? "not_found" : "internal",
        failure.message,
        failure.fields
      );
    }

    return { ok: true as const, ...result.data };
  }
);

export const loader = methodNotAllowed();
