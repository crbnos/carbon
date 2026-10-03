// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { qualityIssueBody } from "@carbon/mes-core/models";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { raiseQualityIssue } from "~/services/commands.steps.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * Raise a quality issue (non-conformance) against an operation.
 *
 * The one endpoint in this API that needs a permission beyond "employee of the
 * company": `x+/quality-issue.new.tsx` gates on `requirePermissions(request,
 * { create: "quality" })`, and parity with the web route is the rule (spec Q4).
 * An operator without it gets 403 and the app disables the control in place
 * rather than hiding it.
 */
export const action = apiRoute(
  {
    method: "POST",
    permissions: { create: "quality" },
    body: qualityIssueBody
  },
  async ({ body, user }) => {
    if (!user) throw new Error("unreachable: this endpoint is not public");

    const result = await raiseQualityIssue(
      getCarbonServiceRole(),
      { companyId: user.companyId, userId: user.userId },
      body
    );

    if (!result.ok) {
      const { failure } = result;
      throw new ApiError(
        FAILURE_STATUS[failure.kind],
        "internal",
        failure.message,
        failure.fields
      );
    }

    return { ok: true as const, ...result.data };
  }
);

export const loader = methodNotAllowed();
