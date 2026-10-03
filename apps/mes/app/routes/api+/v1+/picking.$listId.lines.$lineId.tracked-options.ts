// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { getPickingTrackedOptionsScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * The tracked lots available for one picking line, smart-ordered — the GET half
 * of `x+/picking.$pickingListId.tracked.$lineId.tsx`, through the same
 * `getPickingTrackedOptionsScreen`.
 *
 * It is a sibling of `POST .../tracked` rather than its loader: `tracked.ts`
 * answers a GET with 405 (`methodNotAllowed`), and the two must stay separable
 * so a read is never mistaken for a pick.
 *
 * Both ids come from the URL, so the line is re-read under the caller's company
 * and checked against the list in the path; either miss is a 404.
 */
export const loader = apiRoute({ method: "GET" }, async ({ params, user }) => {
  if (!user) throw new Error("unreachable: tracked-options is not public");

  const lineId = params.lineId;
  if (!lineId) {
    throw new ApiError(400, "validation_failed", "No picking line was given");
  }

  const screen = await getPickingTrackedOptionsScreen(user.client, {
    companyId: user.companyId,
    pickingListId: params.listId,
    lineId
  });

  if (!screen.ok) {
    const { failure } = screen;
    throw new ApiError(
      FAILURE_STATUS[failure.kind],
      failure.kind === "not_found" ? "not_found" : "internal",
      failure.message
    );
  }

  return screen.data;
});
