// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import { success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { rejectCrossSiteNavigation } from "@carbon/auth/middleware/security.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { completeOperationFromScan } from "~/services/commands.time.server";
import { path } from "~/utils/path";

/**
 * The kanban scan completion: a GET that WRITES, which is why
 * `rejectCrossSiteNavigation` guards it. The work is in the
 * `completeOperationFromScan` command (`~/services/commands.time.server`),
 * which `/api/v1` calls too.
 *
 * Deliberately ungated — closing out work that was physically done is never
 * refused (`.claude/rules/mes-job-operation-ui.md`).
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  // Writes on GET: a link on another site must not trigger it.
  rejectCrossSiteNavigation(request);
  const { userId, sessionUserId, companyId } = await requirePermissions(
    request,
    {}
  );

  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
  const trackedEntityId = url.searchParams.get("trackedEntityId");
  const serviceRole = await getCarbonServiceRole();

  const completed = await completeOperationFromScan(serviceRole, {
    companyId,
    userId,
    sessionUserId,
    operationId,
    trackedEntityId: trackedEntityId ?? undefined,
    acknowledged: url.searchParams.get("acknowledged") === "true",
    source: "mes_qr"
  });

  if (!completed.ok) {
    return redirect(
      completed.failure.redirectTo ?? path.to.operations,
      await flash(request, completed.failure.details as Result)
    );
  }

  if (completed.data.outcome === "advance") {
    return redirect(
      `${path.to.operation(operationId)}?trackedEntityId=${
        completed.data.trackedEntityId
      }`
    );
  }

  if (completed.data.outcome === "finished") {
    return redirect(
      path.to.operations,
      await flash(request, {
        ...success("Operation finished successfully"),
        flash: "success"
      })
    );
  }

  return redirect(
    path.to.operation(operationId),
    await flash(request, {
      ...success("Successfully completed part"),
      flash: "success"
    })
  );
}
