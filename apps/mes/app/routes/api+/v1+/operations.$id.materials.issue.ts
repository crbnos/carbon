// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { issueMaterialBody } from "@carbon/mes-core/models";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { issueMaterial } from "~/services/commands.materials.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Issue (or adjust) an untracked part against one operation — the same
 * `issueMaterial` command `x+/issue.tsx` calls, so the `itemLedger` rows an
 * operator produces on a tablet are the rows they produce in a browser.
 *
 * A `materialIssue` storage-rule refusal answers 409 `blocked` with the
 * violations in `details`; the app re-sends with `acknowledged: true` when
 * every violation is a warning. On the web the same refusal renders inline in
 * the issue dialog instead.
 */
export const action = apiRoute(
  { method: "POST", body: issueMaterialBody },
  async ({ params, body, user }) => {
    if (!user) throw new Error("unreachable: this endpoint is not public");

    const jobOperationId = params.id;
    if (!jobOperationId) {
      throw new ApiError(400, "validation_failed", "Missing operation id");
    }

    const result = await issueMaterial(
      getCarbonServiceRole(),
      { companyId: user.companyId, userId: user.userId },
      // The path owns the operation; the body field exists for parity with the
      // web form, which posts it as a hidden input.
      { ...body, jobOperationId }
    );

    if (!result.ok) {
      const { failure } = result;
      throw new ApiError(
        FAILURE_STATUS[failure.kind],
        failure.kind === "blocked"
          ? "blocked"
          : failure.kind === "not_found"
            ? "not_found"
            : "internal",
        failure.message,
        failure.fields,
        // Only a refusal the app must RENDER carries `details`; an internal
        // failure's details are the raw DB or edge-function error.
        failure.kind === "blocked" ? failure.details : undefined
      );
    }

    return { ok: true as const };
  }
);

export const loader = methodNotAllowed();
