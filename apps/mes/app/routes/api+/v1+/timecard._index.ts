// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getTimecardScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * The time card — `x+/timecard.tsx` on the web, through the same
 * `getTimecardScreen`, so the week boundary (Monday → Sunday on the COMPANY
 * calendar) is one definition rather than two.
 *
 * `weekOffset` is optional and defaults to 0 (this week); the web spells the
 * same parameter `?week=`. A value that is not an integer is a 400 rather than
 * a silent `NaN` week, which `weekBounds` would resolve to an empty window.
 *
 * The hours are read for `user.userId` — the pinned operator on a shared
 * terminal, never the signed-in terminal — so the card shows exactly the
 * entries `POST /timecard/clock-in` and `/clock-out` wrote.
 */
export const loader = apiRoute({ method: "GET" }, async ({ request, user }) => {
  if (!user) throw new Error("unreachable: /timecard is not public");

  const raw = new URL(request.url).searchParams.get("weekOffset")?.trim();
  const weekOffset = raw ? Number(raw) : 0;
  if (!Number.isInteger(weekOffset)) {
    throw new ApiError(
      400,
      "validation_failed",
      "Check the highlighted fields",
      { weekOffset: ["weekOffset must be a whole number of weeks"] }
    );
  }

  const screen = await getTimecardScreen(user.client, {
    companyId: user.companyId,
    userId: user.userId,
    weekOffset
  });

  return screen.data;
});
