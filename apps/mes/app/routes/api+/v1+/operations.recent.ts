// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getRecentScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * What this operator last touched — `x+/recent.tsx` on the web, through the
 * same `getRecentScreen`. It exists so picking a job back up after a break is
 * one tap rather than a search through the board.
 *
 * Read as the SIGNED-IN USER, like the web loader, and for `user.userId` — the
 * pinned operator on a shared terminal, so a tablet never offers one operator
 * the history of the person before them.
 */
export const loader = apiRoute({ method: "GET" }, async ({ user }) => {
  if (!user) throw new Error("unreachable: /operations/recent is not public");

  const screen = await getRecentScreen(user.client, {
    companyId: user.companyId,
    userId: user.userId
  });

  return screen.data;
});
