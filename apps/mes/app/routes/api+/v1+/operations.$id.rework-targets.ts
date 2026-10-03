// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getReworkTargetsScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * The operations a rework can be sent back to — `x+/rework-targets.$operationId`
 * on the web. Read as the signed-in user, like the web loader, because the
 * upstream-operations read is RLS-safe for an employee of the company.
 */
export const loader = apiRoute({ method: "GET" }, async ({ params, user }) => {
  if (!user) throw new Error("unreachable: rework-targets is not public");

  const operationId = params.id;
  if (!operationId) {
    throw new ApiError(400, "validation_failed", "No operation was given");
  }

  // Mirrors the web loader, which passes the service's `{ data, error }`
  // straight through — there is no failure branch to map.
  const screen = await getReworkTargetsScreen(user.client, operationId);
  return screen.data;
});
