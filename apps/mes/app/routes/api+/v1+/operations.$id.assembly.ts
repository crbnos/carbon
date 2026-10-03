// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError, getApiClaims } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import { getAssemblyScreen } from "~/services/screens.server";
import { toApiError } from "./lib/failure.server";
import { apiRoute } from "./lib/route.server";

const log = getLogger("mes", "assembly");

/**
 * The assembly screen for one job operation — `x+/assembly.$operationId.tsx`
 * on the web, through the same `getAssemblyScreen`.
 *
 * An operation belongs here only because its `operationType` is `Assembly`.
 * Neither a 3D model nor a linked instruction is required: with none, the
 * payload simply carries `assemblyPlayback: null` and no model slides.
 * `GET /operations/:id` answers such an operation with a 409 whose
 * `details.view` is `"assembly"`, which is what sends a client here; the guard
 * below is the mirror image, and says which view an operation of another type
 * belongs on.
 *
 * It is a pure read, addressed by the OPERATION, and it is the only
 * assembly-specific endpoint. Everything the screen then does — the timer, a
 * step record, issuing a part, completing a unit — goes through the same
 * `/operations/:id/...` commands the plain operation screen uses.
 *
 * The web loader gates it with no permission beyond being an employee of the
 * company (`requirePermissions(request, {})`), and this matches it — a tighter
 * gate here would mean an operator could open the screen in a browser and not
 * on their tablet.
 *
 * Reads run with the SERVICE ROLE exactly as the web loader does: RLS on
 * `productionEvent` needs `production_view`, which an operator does not hold,
 * so reading as the operator would show them LESS than the web does.
 *
 * `:id` comes from the URL, so the read re-scopes it to the caller's company
 * before any service-role query runs, and a miss is the 404 the web loader
 * turns into its redirect.
 *
 * `?unit=` and `?trackedEntityId=` are the web's own search params and mean
 * the same thing: which unit of the operation to open. The read resolves them
 * (an explicit entity wins, then the index, else the next unit still to
 * build) and attributes `materials` to that unit, so paging to another unit
 * is another GET.
 */
export const loader = apiRoute(
  { method: "GET" },
  async ({ request, params, user }) => {
    if (!user) {
      throw new Error("unreachable: /operations/:id/assembly is not public");
    }

    const operationId = params.id;
    if (!operationId) {
      throw new ApiError(400, "validation_failed", "No operation was given");
    }

    const url = new URL(request.url);

    const screen = await getAssemblyScreen(await getCarbonServiceRole(), {
      companyId: user.companyId,
      // The PINNED operator, so the open timer the screen shows is the one
      // the operator is actually on rather than the terminal account's.
      userId: user.userId,
      operationId,
      unit: url.searchParams.get("unit"),
      trackedEntityId: url.searchParams.get("trackedEntityId"),
      // The manager override follows the same person. `user.claims` are the
      // SIGNED-IN account's, which on a shared tablet is the terminal's, so a
      // pinned operator's own are read — from this API's per-(user, company)
      // cache, never the web's `getUserClaims` key.
      claims:
        user.userId === user.sessionUserId
          ? user.claims
          : await getApiClaims(user.userId, user.companyId)
    });

    if (!screen.ok) {
      const { failure } = screen;
      // The wrong-view guard: the web redirects to the plain operation view.
      // An API caller has no URL to follow, so say which screen it belongs on.
      const view = (failure.details as { view?: string } | undefined)?.view;
      if (!view && failure.details) {
        // The web logs the cause through its flash helper. Here it is about
        // to be dropped from the response, so it is written down first.
        log.error(failure.message || "Failed to load the assembly screen", {
          companyId: user.companyId,
          operationId,
          error: failure.details
        });
      }
      throw toApiError({
        ...failure,
        message: view
          ? "This operation is not an assembly"
          : failure.message || "Operation not found",
        // Only the view is worth telling the app; a raw PostgREST error is not.
        details: view ? { view } : undefined
      });
    }

    return screen.data;
  }
);
