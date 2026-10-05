// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { getJobScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * One job and the operations it is made of — web MES's `x+/job.$jobId.tsx`,
 * through the same `getJobScreen`.
 *
 * This is the one endpoint here that takes a RECORD ID from the URL, so the
 * company check inside `getJobScreen` is what stands between an operator and
 * another tenant's job: the reads below it are keyed on `jobId` alone with
 * the service role, and `requireApiUser` proves only that the caller may act
 * in their own company. A miss is a 404, not an empty screen.
 */
export const loader = apiRoute({ method: "GET" }, async ({ params, user }) => {
  if (!user) throw new Error("unreachable: /jobs/:id is not public");

  const screen = await getJobScreen(getCarbonServiceRole(), {
    jobId: params.id ?? "",
    companyId: user.companyId
  });

  // `not_found` is the only failure this read produces — the company check is
  // its one refusal — so the code is named rather than mapped off a union that
  // carries kinds this endpoint cannot return. `FAILURE_STATUS` still supplies
  // the status, so the two cannot drift.
  if (!screen.ok) {
    throw new ApiError(
      FAILURE_STATUS[screen.failure.kind],
      "not_found",
      screen.failure.message
    );
  }

  return screen.data;
});
