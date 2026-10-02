// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ApiError } from "@carbon/auth/api-user.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getDatabaseClient } from "~/services/database.server";
import { getInspectionScreen } from "~/services/screens.server";
import { toApiError } from "./lib/failure.server";
import { apiRoute } from "./lib/route.server";

/**
 * The inspection screen for one job operation — `x+/inspection.$operationId.tsx`
 * on the web, through the same `getInspectionScreen`.
 *
 * It is addressed by the OPERATION, not the lot, because opening the screen is
 * what creates the lot: `getOrCreateJobOperationInspection` is a lazy
 * find-or-create, idempotent per `(sourceDocument, sourceDocumentLineId)`. The
 * five write endpoints are addressed by the lot id this read returns.
 *
 * A GET that writes is unusual enough to say out loud, and it is why this
 * endpoint is a `loader` rather than an action: it is the web flow, unchanged,
 * and the create is idempotent, so a retried GET makes no second lot. The web
 * loader gates it with no permission beyond being an employee of the company
 * (`requirePermissions(request, {})`), and this matches it — a tighter gate
 * here would mean an operator could open the screen in a browser and not on
 * their tablet.
 *
 * Reads run with the SERVICE ROLE exactly as the web loader does: RLS on
 * `productionEvent` needs `production_view`, which an operator does not hold,
 * so reading as the operator would show them LESS than the web does.
 *
 * `:id` comes from the URL, so the read re-scopes it to the caller's company
 * before any service-role query runs, and a miss is the 404 the web loader
 * turns into its redirect.
 *
 * **No drawing.** The web screen renders the assigned PDF and its balloons on a
 * `react-konva` canvas; neither that nor `react-pdf` runs on React Native, so
 * `getInspectionDocumentWithBalloons` stays in the web loader and this payload
 * carries no `pdfUrl`, no document name and no balloon coordinates. The app
 * gets `inspection.inspectionDocumentId`, which is all it needs to know whether
 * the grid is characteristics or the single overall-result row.
 */
export const loader = apiRoute({ method: "GET" }, async ({ params, user }) => {
  if (!user) {
    throw new Error("unreachable: /operations/:id/inspection is not public");
  }

  const operationId = params.id;
  if (!operationId) {
    throw new ApiError(400, "validation_failed", "No operation was given");
  }

  const screen = await getInspectionScreen(
    await getCarbonServiceRole(),
    getDatabaseClient(),
    {
      companyId: user.companyId,
      // The PINNED operator, so the events read returns the timer the
      // operator is actually on rather than the terminal account's.
      userId: user.userId,
      operationId
    }
  );

  if (!screen.ok) {
    const { failure } = screen;
    // The wrong-view guard: the web redirects to the plain operation view. An
    // API caller has no URL to follow, so say which screen it belongs on.
    const view = (failure.details as { view?: string } | undefined)?.view;
    throw toApiError({
      ...failure,
      message: view
        ? "This operation is not an inspection"
        : failure.message || "Inspection not found",
      // Only the view is worth telling the app; a raw PostgREST error is not.
      details: view ? { view } : undefined
    });
  }

  return screen.data;
});
