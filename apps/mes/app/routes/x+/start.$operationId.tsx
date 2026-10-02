// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { rejectCrossSiteNavigation } from "@carbon/auth/middleware/security.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { startOperationFromScan } from "~/services/commands.time.server";
import { path } from "~/utils/path";

/**
 * The QR traveller: a GET that WRITES, which is why `rejectCrossSiteNavigation`
 * guards it. The work is in the `startOperationFromScan` command
 * (`~/services/commands.time.server`), which `/api/v1` calls too — including
 * the floor gate that must run BEFORE the timer re-opens.
 *
 * A failed command carries the redirect it belongs to in `failure.redirectTo`
 * and the exact `Result` to flash in `failure.details`, so this loader throws
 * precisely the redirects it threw before the extraction.
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

  let type = (url.searchParams.get("type") ?? "Labor") as
    | "Setup"
    | "Labor"
    | "Machine";
  if (!["Setup", "Labor", "Machine"].includes(type)) {
    type = "Labor";
  }

  const serviceRole = await getCarbonServiceRole();
  const started = await startOperationFromScan(serviceRole, {
    companyId,
    userId,
    sessionUserId,
    operationId,
    type,
    trackedEntityId: trackedEntityId ?? undefined,
    acknowledged: url.searchParams.get("acknowledged") === "true",
    source: "mes_qr"
  });

  if (!started.ok) {
    throw redirect(
      started.failure.redirectTo ?? path.to.operations,
      await flash(request, started.failure.details as Result)
    );
  }

  throw redirect(path.to.operation(operationId));
}
