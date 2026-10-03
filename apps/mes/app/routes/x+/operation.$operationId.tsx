// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { JobOperation } from "~/components/JobOperation";
import { getOperationScreen } from "~/services/screens.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});
  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
  const trackedEntityId = url.searchParams.get("trackedEntityId");

  // The read itself lives in `~/services/screens.server` so this screen and
  // `GET /api/v1/operations/:id` cannot drift.
  const screen = await getOperationScreen(await getCarbonServiceRole(), {
    companyId,
    userId,
    operationId,
    trackedEntityId
  });

  if (!screen.ok) {
    const { failure } = screen;
    // The assembly / inspection guards carry the selected unit across the hop.
    if ((failure.details as { view?: string } | undefined)?.view) {
      throw redirect(`${failure.redirectTo}${url.search}`);
    }
    throw redirect(
      failure.redirectTo ?? path.to.operations,
      await flash(
        request,
        error(failure.details ?? null, failure.message || "Operation not found")
      )
    );
  }

  const { autoSelectTrackedEntityId, ...data } = screen.data;

  // On the first operation only, put the auto-selected unit in the URL — the
  // client reads it from there for every subsequent completion.
  if (autoSelectTrackedEntityId) {
    const redirectUrl = new URL(request.url);
    redirectUrl.searchParams.set("trackedEntityId", autoSelectTrackedEntityId);
    throw redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
  }

  return data;
}

export default function OperationRoute() {
  const { operationId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");

  const {
    batch,
    batchMaterialTotals,
    batchWorkInstructions,
    events,
    expiredEntityPolicy,
    autoSelectMaterialWithoutPickingList,
    files,
    job,
    jobMakeMethod,
    kanban,
    materials,
    operation,
    procedure,
    thumbnailPath,
    trackedEntities,
    isFirstOperation,
    workCenter,
    nonConformanceActions
  } = useLoaderData<typeof loader>();

  return (
    <JobOperation
      key={`job-operation-${operationId}`}
      batch={batch}
      batchMaterialTotals={batchMaterialTotals}
      batchWorkInstructions={batchWorkInstructions}
      events={events}
      expiredEntityPolicy={expiredEntityPolicy}
      autoSelectMaterialWithoutPickingList={
        autoSelectMaterialWithoutPickingList
      }
      files={files}
      kanban={kanban}
      materials={materials}
      method={jobMakeMethod}
      trackedEntities={trackedEntities}
      isFirstOperation={isFirstOperation}
      nonConformanceActions={nonConformanceActions}
      operation={operation}
      procedure={procedure}
      job={job}
      thumbnailPath={thumbnailPath}
      workCenter={workCenter}
    />
  );
}
