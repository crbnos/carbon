// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getActiveScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * The operations this operator has an open production event on —
 * `x+/active.tsx` on the web, through the same `getActiveScreen`. It is the
 * number web MES badges in its sidebar, and the app badges on its Active
 * segment.
 *
 * Read as the SIGNED-IN USER, not the service role, because that is what the
 * web loader does: `get_active_job_operations_by_employee` is reachable with
 * the `production_view` an operator running a timer necessarily holds, so
 * matching the web here neither widens nor narrows what they see.
 *
 * `user.userId` is the EFFECTIVE user — the pinned operator on a shared
 * terminal — so the timers listed are the ones `POST /operations/:id/events`
 * opened in their name.
 */
export const loader = apiRoute({ method: "GET" }, async ({ user }) => {
  if (!user) throw new Error("unreachable: /operations/active is not public");

  const screen = await getActiveScreen(user.client, {
    companyId: user.companyId,
    userId: user.userId
  });

  return screen.data;
});
