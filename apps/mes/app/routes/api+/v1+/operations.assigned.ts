// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getAssignedScreen } from "~/services/screens.server";
import { apiRoute } from "./lib/route.server";

/**
 * The operations a planner put on this operator's name — `x+/assigned.tsx` on
 * the web, through the same `getAssignedScreen`, so a tablet and web MES cannot
 * disagree about whose work it is.
 *
 * SERVICE ROLE, exactly as the web loader reads it. `get_assigned_job_operations`
 * reaches `productionEvent`, whose RLS requires `production_view`; an operator
 * without it would see LESS here than in the browser (see the note at the top of
 * `screens.server.ts`).
 *
 * Nothing the caller sends reaches the query: the company comes from the
 * verified claims and the employee is `user.userId` — the pinned operator on a
 * shared terminal, never the terminal account that is signed in, so the queue
 * belongs to whoever is standing at the tablet.
 */
export const loader = apiRoute({ method: "GET" }, async ({ user }) => {
  if (!user) throw new Error("unreachable: /operations/assigned is not public");

  const screen = await getAssignedScreen(getCarbonServiceRole(), {
    companyId: user.companyId,
    userId: user.userId,
    // The web carries a location so its board can show work centers with
    // nothing queued. It filters nothing, and the app renders a flat list.
    locationId: null
  });

  // `workCenters` and `locationId` exist for those empty board columns; they
  // are every work center in the company, and no card here reads them.
  return { operations: screen.data.operations };
});
