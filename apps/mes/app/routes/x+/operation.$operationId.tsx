import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { JobOperation } from "~/components/JobOperation";
import { getCompanySettings } from "~/services/inventory.service";
import {
  getJobByOperationId,
  getJobFiles,
  getJobMakeMethod,
  getJobMaterialsByOperationId,
  getJobMethodBomIdMap,
  getJobOperationById,
  getJobOperationProcedure,
  getKanbanByJobId,
  getNextIncompleteSerialEntity,
  getNonConformanceActions,
  getProductionEventsForJobOperation,
  getProductionQuantitiesForJobOperation,
  getThumbnailPathByItemId,
  getTrackedEntitiesByMakeMethodId,
  getWorkCenter,
  isSerialEntityIncompleteForOperation
} from "~/services/operations.service";
import type { OperationWithDetails } from "~/services/types";

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

import { makeDurations } from "~/utils/durations";
import { resolveOperationView } from "~/utils/operationView";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
  const trackedEntityId = url.searchParams.get("trackedEntityId");

  const serviceRole = await getCarbonServiceRole();

  const [events, quantities, job, operation] = await Promise.all([
    getProductionEventsForJobOperation(serviceRole, {
      operationId,
      userId
    }),
    getProductionQuantitiesForJobOperation(serviceRole, operationId),
    getJobByOperationId(serviceRole, operationId),
    getJobOperationById(serviceRole, operationId)
  ]);

  if (job.error) {
    throw redirect(
      path.to.operations,
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  }

  if (operation.error) {
    throw redirect(
      path.to.operations,
      await flash(request, error(operation.error, "Failed to fetch operation"))
    );
  }

  if (!job.data.itemId) {
    throw redirect(
      path.to.operations,
      await flash(request, error("Item ID is required", "Failed to fetch item"))
    );
  }

  const op = operation.data?.[0];

  // Redirect guard (ADR-0005): each view has its own route. Guards only
  // redirect kinds they don't serve, so no loop.
  if (resolveOperationView(op?.operationType) === "assembly") {
    throw redirect(path.to.assembly(operationId) + url.search);
  }
  if (resolveOperationView(op?.operationType) === "inspection") {
    throw redirect(path.to.inspection(operationId) + url.search);
  }

  const [
    thumbnailPath,
    trackedEntities,
    jobMakeMethod,
    kanban,
    bomIdMap,
    companySettings
  ] = await Promise.all([
    getThumbnailPathByItemId(serviceRole, operation.data?.[0].itemId),
    getTrackedEntitiesByMakeMethodId(
      serviceRole,
      operation.data?.[0].jobMakeMethodId
    ),
    getJobMakeMethod(serviceRole, operation.data?.[0].jobMakeMethodId),
    getKanbanByJobId(serviceRole, job.data.id),
    getJobMethodBomIdMap(serviceRole, job.data.id!),
    getCompanySettings(serviceRole, companyId)
  ]);

  const inventoryShelfLife = (companySettings.data?.inventoryShelfLife ??
    null) as { expiredEntityPolicy?: ExpiredEntityPolicy } | null;
  const expiredEntityPolicy: ExpiredEntityPolicy =
    inventoryShelfLife?.expiredEntityPolicy ?? "Block";
  const autoSelectMaterialWithoutPickingList =
    companySettings.data?.autoSelectMaterialWithoutPickingList ?? false;

  // Is this the first operation in the routing? A serial unit only earns a
  // printed label when it is completed at its first operation, so:
  //  - first operation: no labels exist yet → the operator flows unit-by-unit
  //    (auto-select here on arrival, and in the client after each completion);
  //  - later operations: every unit already has a label → the operator
  //    scans/selects each unit (no auto-select, here or in the client).
  // An operation is "first" when nothing precedes it in THIS make method's
  // routing — i.e. it has no jobOperationDependency whose predecessor lives in
  // the same jobMakeMethod. Dependencies also model subassembly ordering (a
  // parent-assembly op waits on its child subassembly's ops), and those cross
  // make-method dependencies must NOT count: the parent serial still has no
  // printed label just because a subassembly finished first. `order` is only a
  // display/sort field and isn't a reliable precedence signal, so it's not used.
  const priorDependency = await serviceRole
    .from("jobOperationDependency")
    .select(
      "dependsOn:jobOperation!jobOperationDependency_dependsOnId_fk!inner(jobMakeMethodId)"
    )
    .eq("operationId", operationId)
    .eq("dependsOn.jobMakeMethodId", op.jobMakeMethodId)
    .limit(1)
    .maybeSingle();
  // Fail closed: a query error also returns null data, so treat an errored lookup
  // as "not first" — later ops require scan/select, which is the safe default when
  // we can't confirm the operation has no predecessor.
  const isFirstOperation = !priorDependency.error && !priorDependency.data;

  // On the first operation only, auto-select the first incomplete unit when none
  // is in the URL. Later operations leave it unset so the client presents the
  // scan/select picker for every unit (including the first one picked up).
  if (
    !trackedEntityId &&
    isFirstOperation &&
    trackedEntities.data &&
    trackedEntities.data.length > 0
  ) {
    const nextTrackedEntity = trackedEntities.data.find((entity) =>
      isSerialEntityIncompleteForOperation(entity, operationId)
    );
    if (nextTrackedEntity) {
      const redirectUrl = new URL(request.url);
      redirectUrl.searchParams.set("trackedEntityId", nextTrackedEntity.id);
      throw redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
    }
  }

  return {
    bomIdMap: Object.fromEntries(bomIdMap),
    events: events.data ?? [],
    quantities: (quantities.data ?? []).reduce(
      (acc, curr) => {
        if (curr.type === "Scrap") {
          acc.scrap += curr.quantity;
        } else if (curr.type === "Production") {
          acc.production += curr.quantity;
        } else if (curr.type === "Rework") {
          acc.rework += curr.quantity;
        }
        return acc;
      },
      { scrap: 0, production: 0, rework: 0 }
    ),
    job: job.data,
    jobMakeMethod: jobMakeMethod.data,
    kanban: kanban.data,
    files: getJobFiles(serviceRole, companyId, job.data, operation.data),
    materials: getJobMaterialsByOperationId(serviceRole, {
      operation: operation.data?.[0],
      trackedEntityId:
        trackedEntityId ??
        getNextIncompleteSerialEntity(trackedEntities.data ?? [], operationId)
          ?.id,
      requiresSerialTracking:
        jobMakeMethod.data?.requiresSerialTracking ?? false
    }),
    trackedEntities: trackedEntities.data ?? [],
    isFirstOperation,
    nonConformanceActions: getNonConformanceActions(serviceRole, {
      itemId: operation.data?.[0].itemId,
      processId: operation.data?.[0].processId,
      companyId
    }),
    operation: makeDurations(operation.data?.[0]) as OperationWithDetails,
    expiredEntityPolicy,
    autoSelectMaterialWithoutPickingList,
    procedure: getJobOperationProcedure(serviceRole, operation.data?.[0].id),
    workCenter: getWorkCenter(
      serviceRole,
      operation.data?.[0].workCenterId
    ) as Promise<
      import("@supabase/supabase-js").PostgrestSingleResponse<{
        name: string;
        id: string;
        isBlocked: boolean | null;
        blockingDispatchId: string | null;
        blockingDispatchReadableId: string | null;
      }>
    >,
    thumbnailPath
  };
}

export default function OperationRoute() {
  const { operationId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");

  const {
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
