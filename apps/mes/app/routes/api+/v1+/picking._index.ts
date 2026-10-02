// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getPickingScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * The picking lists assigned to this kitter — `x+/picking._index.tsx` on the
 * web, through the same `getPickingScreen`, so a tablet and web MES cannot
 * disagree about what is on someone's list.
 *
 * Read as the signed-in user, like the web loader: the `pickingLists` view is
 * RLS-safe for an employee holding `inventory_view`, which every kitter has.
 *
 * `user.userId` is the EFFECTIVE user — the pinned operator on a shared
 * terminal — so the list follows whoever is working, exactly as the web route's
 * `userContext.effectiveUserId` does.
 */
export const loader = apiRoute({ method: "GET" }, async ({ user }) => {
  if (!user) throw new Error("unreachable: /picking is not public");

  const screen = await getPickingScreen(user.client, {
    companyId: user.companyId,
    effectiveUserId: user.userId
  });

  return screen.data;
});
