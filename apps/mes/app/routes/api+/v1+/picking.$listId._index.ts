// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { getPickingListScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * One picking list with its lines — `x+/picking.$pickingListId.tsx` on the web,
 * through the same `getPickingListScreen`.
 *
 * One difference from the web: the recommended lots per line are a PROMISE the
 * web streams through `Await`, and are AWAITED here so the app gets one
 * complete payload rather than a promise it cannot resolve.
 *
 * `listId` comes from the URL, so the read re-scopes it to the caller's company
 * and a miss is a 404 — the same 404 the web loader throws.
 */
export const loader = apiRoute({ method: "GET" }, async ({ params, user }) => {
  if (!user) throw new Error("unreachable: /picking/:listId is not public");

  const pickingListId = params.listId;
  if (!pickingListId) {
    throw new ApiError(400, "validation_failed", "No picking list was given");
  }

  const screen = await getPickingListScreen(user.client, {
    companyId: user.companyId,
    pickingListId
  });

  if (!screen.ok) {
    const { failure } = screen;
    throw new ApiError(
      FAILURE_STATUS[failure.kind],
      failure.kind === "not_found" ? "not_found" : "internal",
      failure.message
    );
  }

  const { recommendations, ...rest } = screen.data;

  return { ...rest, recommendations: await recommendations };
});
