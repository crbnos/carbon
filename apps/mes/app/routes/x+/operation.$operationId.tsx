// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { activeJobStatuses } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { JobOperation } from "~/components/JobOperation";
import { getCompanySettings } from "~/services/inventory.service";
import {
  getAbilityShortfall,
  getBatchMaterialTotals,
  getBatchWorkInstructions,
  getJob,
  getJobFiles,
  getJobMakeMethod,
  getJobMaterialsByOperationId,
  getJobMethodBomIdMap,
  getJobOperationBatch,
  getJobOperationById,
  getJobOperationForCompany,
  getJobOperationProcedure,
  getKanbanByJobId,
  getNextIncompleteSerialEntity,
  getNonConformanceActions,
  getProductionEventsForBatch,
  getProductionEventsForJobOperation,
  getProductionQuantitiesForJobOperation,
  getReworkCorrectionName,
  getThumbnailPathByItemId,
  getTrackedEntitiesForOperation,
  getWorkCenter,
  isFirstOpenOperationOfMakeMethod,
  isFirstOperationOfMakeMethod,
  isSerialEntityIncompleteForOperation
} from "~/services/operations.service";
import type { OperationWithDetails } from "~/services/types";
import { recordMeta } from "~/utils/meta";

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

import { redirect } from "@carbon/utils";
import { makeDurations } from "~/utils/durations";
import type { Handle } from "~/utils/handle";
import {
  OUTSIDE_PROCESSING_REFUSAL,
  resolveOperationView
} from "~/utils/operationView";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: [
    // One operation of one job, unless it runs in a batch: a batch shows its
    // members' steps, materials and timers, which belong to other jobs.
    {
      table: "job",
      filter: ({ data }) =>
        data?.batch || !data?.job?.id ? undefined : `id=eq.${data?.job?.id}`
    },
    {
      // Every operation of the job: the one before this one gates it.
      table: "jobOperation",
      filter: ({ data }) =>
        data?.batch || !data?.job?.id ? undefined : `jobId=eq.${data?.job?.id}`
    },
    {
      table: "jobMaterial",
      filter: ({ data }) =>
        data?.batch || !data?.job?.id ? undefined : `jobId=eq.${data?.job?.id}`
    },
    {
      table: "jobOperationStep",
      filter: ({ data, params }) =>
        data?.batch || !data?.job?.id
          ? undefined
          : `operationId=eq.${params.operationId}`
    },
    {
      table: "jobOperationStepRecord",
      filter: ({ data, params }) =>
        data?.batch || !data?.job?.id
          ? undefined
          : `operationId=eq.${params.operationId}`
    },
    {
      table: "pickingListLine",
      filter: ({ data }) =>
        data?.batch || !data?.job?.id ? undefined : `jobId=eq.${data?.job?.id}`
    }
  ]
};

const logger = getLogger("mes", "operation");

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  recordMeta(
    [
      data?.batch?.readableId ?? data?.operation?.jobReadableId,
      data?.operation?.description
    ],
    "Operation"
  );

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
  const trackedEntityId = url.searchParams.get("trackedEntityId");

  const serviceRole = await getCarbonServiceRole();

  // Every read below is service-role, so verify the caller-supplied ids belong
  // to this company first (the tracked entity feeds the genealogy lookup).
  const [ownedOperation, ownedEntity] = await Promise.all([
    getJobOperationForCompany(serviceRole, operationId, companyId),
    trackedEntityId
      ? serviceRole
          .from("trackedEntity")
          .select("id")
          .eq("id", trackedEntityId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null
  ]);
  if (!ownedOperation.data || (ownedEntity && !ownedEntity.data)) {
    logger.warn("Operation or tracked entity not found in company", {
      companyId,
      operationId,
      trackedEntityId,
      error: ownedOperation.error ?? ownedEntity?.error
    });
    throw redirect(
      path.to.operations,
      await flash(
        request,
        error(
          ownedOperation.error ?? ownedEntity?.error ?? null,
          "Operation not found"
        )
      )
    );
  }

  // One wave: everything below needs only ids the ownership check returned, so
  // it is read before the redirect checks rather than one step after another.
  // A redirect discards reads the page then never uses; the ids are the
  // company's, so nothing leaks.
  const {
    jobId,
    jobMakeMethodId,
    jobOperationBatchId: batchId,
    operationType
  } = ownedOperation.data;

  // Redirect guard (ADR-0005): each view has its own route. Guards only
  // redirect kinds they don't serve, so no loop. Checked before the read wave,
  // which the other route runs itself.
  if (resolveOperationView(operationType) === "assembly") {
    throw redirect(path.to.assembly(operationId) + url.search);
  }
  if (resolveOperationView(operationType) === "inspection") {
    throw redirect(path.to.inspection(operationId) + url.search);
  }

  const operationPromise = getJobOperationById(serviceRole, operationId);
  // The batch's events and material totals are used only once it is released.
  const batchPromise = batchId
    ? getJobOperationBatch(serviceRole, batchId, companyId)
    : null;
  const releasedBatchId = batchPromise?.then((result) =>
    result.data?.status === "Active" || result.data?.status === "Completing"
      ? batchId
      : null
  );
  const [
    opEvents,
    quantities,
    job,
    operation,
    batchResult,
    batchEvents,
    batchMaterialTotals,
    thumbnailPath,
    correctionName,
    trackedEntities,
    jobMakeMethod,
    kanban,
    bomIdMap,
    companySettings,
    abilityWarning,
    isFirstOperation,
    isFirstOpenOperation
  ] = await Promise.all([
    getProductionEventsForJobOperation(serviceRole, {
      operationId,
      userId
    }),
    getProductionQuantitiesForJobOperation(serviceRole, operationId),
    getJob(serviceRole, jobId),
    operationPromise,
    batchPromise,
    releasedBatchId?.then((id) =>
      id ? getProductionEventsForBatch(serviceRole, id) : null
    ) ?? null,
    releasedBatchId?.then((id) =>
      id
        ? getBatchMaterialTotals(serviceRole, { batchId: id, companyId })
        : null
    ) ?? null,
    operationPromise.then((result) => {
      const itemId = result.data?.[0]?.itemId;
      return itemId ? getThumbnailPathByItemId(serviceRole, itemId) : null;
    }),
    operationPromise.then((result) =>
      getReworkCorrectionName(
        serviceRole,
        result.data?.[0]?.reworkId,
        companyId
      )
    ),
    jobMakeMethodId
      ? getTrackedEntitiesForOperation(serviceRole, {
          operationId,
          jobMakeMethodId: jobMakeMethodId,
          companyId
        })
      : null,
    jobMakeMethodId ? getJobMakeMethod(serviceRole, jobMakeMethodId) : null,
    getKanbanByJobId(serviceRole, jobId),
    getJobMethodBomIdMap(serviceRole, jobId),
    getCompanySettings(serviceRole, companyId),
    getAbilityShortfall(serviceRole, {
      operationId,
      employeeId: userId,
      companyId
    }),
    jobMakeMethodId
      ? isFirstOperationOfMakeMethod(serviceRole, operationId, jobMakeMethodId)
      : false,
    jobMakeMethodId
      ? isFirstOpenOperationOfMakeMethod(
          serviceRole,
          companyId,
          operationId,
          jobMakeMethodId
        )
      : false
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
  if (!op) {
    logger.warn("Operation not found after the ownership check", {
      companyId,
      operationId
    });
    throw redirect(
      path.to.operations,
      await flash(request, error(null, "Operation not found"))
    );
  }

  // The type the early redirect used came from the ownership read; check the
  // row this page renders too.
  if (resolveOperationView(op.operationType) === "assembly") {
    throw redirect(path.to.assembly(operationId) + url.search);
  }
  if (resolveOperationView(op.operationType) === "inspection") {
    throw redirect(path.to.inspection(operationId) + url.search);
  }

  // Subcontracted work runs at the supplier, never on the shop floor. The
  // boards hide it; this refuses a job-view or direct link too.
  if (op.operationType === "Outside Processing") {
    throw redirect(
      path.to.operations,
      await flash(request, error(null, OUTSIDE_PROCESSING_REFUSAL))
    );
  }

  // Batch membership (from the ownership check: get_job_operation_by_id omits
  // jobOperationBatchId). When the op belongs to a batch that is still
  // Active/Completing, the operation view runs in batch mode: it shows the
  // shared batch timer and completes the whole batch. A Completed batch was
  // already re-sliced per member — it renders as a plain operation view.
  let batch: Awaited<ReturnType<typeof getJobOperationBatch>>["data"] | null =
    null;
  let events = opEvents;
  if (batchResult) {
    // An unread batch cannot prove it was released: refuse rather than skip
    // the floor rule below.
    // A partial read (members or planned lots missing) refuses too: the
    // completion form must not run on lots it could not read.
    if (!batchResult.data || batchResult.error) {
      logger.error("Failed to read the operation's batch", {
        companyId,
        operationId,
        batchId,
        error: batchResult.error
      });
      throw redirect(
        path.to.operations,
        await flash(
          request,
          error(batchResult.error, "Failed to load the operation's batch")
        )
      );
    }
    // Floor rule: a batched operation is only floor-visible once its batch
    // has been released (Active/Completing). A Planned batch stays off the
    // floor regardless of its members' job statuses.
    if (batchResult.data?.status === "Planned") {
      throw redirect(
        path.to.operations,
        await flash(
          request,
          error(
            null,
            "This operation is part of a batch that has not been released to the floor"
          )
        )
      );
    }
    if (
      batchResult.data &&
      (batchResult.data.status === "Active" ||
        batchResult.data.status === "Completing")
    ) {
      batch = batchResult.data;
      // The batch's events (all members' timers) instead of this op's.
      if (batchEvents) events = batchEvents;
    }
  } else if (
    !job.data.status ||
    !(activeJobStatuses as readonly string[]).includes(job.data.status)
  ) {
    // Floor rule: an unbatched operation is only floor-visible while its job
    // is released (Ready/In Progress/Paused).
    throw redirect(
      path.to.operations,
      await flash(
        request,
        error(null, "This operation's job has not been released to the floor")
      )
    );
  }

  const inventoryShelfLife = (companySettings.data?.inventoryShelfLife ??
    null) as { expiredEntityPolicy?: ExpiredEntityPolicy } | null;
  const expiredEntityPolicy: ExpiredEntityPolicy =
    inventoryShelfLife?.expiredEntityPolicy ?? "Block";
  const autoSelectMaterialWithoutPickingList =
    companySettings.data?.autoSelectMaterialWithoutPickingList ?? false;
  const requireTrackedMaterialsIssued =
    companySettings.data?.requireTrackedMaterialsIssued ?? false;

  // Is this the first operation in the routing? A serial unit only earns a
  // printed label when it is completed at its first operation, so:
  //  - first operation: no labels exist yet → the operator flows unit-by-unit
  //    (auto-select here on arrival, and in the client after each completion);
  //  - later operations: every unit already has a label → the operator
  //    scans/selects each unit (no auto-select, here or in the client).
  //    (isFirstOperation is read in the first wave above.)

  // On the first operation only, auto-select the first incomplete unit when none
  // is in the URL. Later operations leave it unset so the client presents the
  // scan/select picker for every unit (including the first one picked up).
  if (
    !trackedEntityId &&
    isFirstOperation &&
    trackedEntities?.data &&
    trackedEntities?.data.length > 0
  ) {
    const nextTrackedEntity = trackedEntities?.data.find((entity) =>
      isSerialEntityIncompleteForOperation(entity, operationId)
    );
    if (nextTrackedEntity) {
      const redirectUrl = new URL(request.url);
      redirectUrl.searchParams.set("trackedEntityId", nextTrackedEntity.id);
      throw redirect(`${redirectUrl.pathname}${redirectUrl.search}`);
    }
  }

  return {
    batch,
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
    jobMakeMethod: jobMakeMethod?.data ?? null,
    kanban: kanban.data,
    files: getJobFiles(serviceRole, companyId, job.data, operation.data),
    // Batch mode: the combined per-item requirement across every member, so
    // the materials panel can show the one shared pick.
    batchMaterialTotals: batch ? batchMaterialTotals : null,
    // Batch mode: steps, parameters and files across every member (deferred).
    batchWorkInstructions: batch
      ? getBatchWorkInstructions(serviceRole, {
          batchId: batch.id as string,
          companyId
        })
      : null,
    materials: getJobMaterialsByOperationId(serviceRole, {
      operation: operation.data?.[0],
      trackedEntityId:
        trackedEntityId ??
        getNextIncompleteSerialEntity(trackedEntities?.data ?? [], operationId)
          ?.id,
      requiresSerialTracking:
        jobMakeMethod?.data?.requiresSerialTracking ?? false
    }),
    trackedEntities: trackedEntities?.data ?? [],
    isFirstOperation,
    isFirstOpenOperation,
    requireTrackedMaterialsIssued,
    nonConformanceActions: getNonConformanceActions(serviceRole, {
      itemId: operation.data?.[0].itemId,
      processId: operation.data?.[0].processId,
      companyId
    }),
    operation: makeDurations(operation.data?.[0]) as OperationWithDetails,
    abilityWarning,
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
    thumbnailPath,
    correctionName
  };
}

export default function OperationRoute() {
  const { operationId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");

  const {
    abilityWarning,
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
    correctionName,
    trackedEntities,
    isFirstOperation,
    isFirstOpenOperation,
    requireTrackedMaterialsIssued,
    workCenter,
    nonConformanceActions
  } = useLoaderData<typeof loader>();

  return (
    <JobOperation
      key={`job-operation-${operationId}`}
      abilityWarning={abilityWarning}
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
      isFirstOpenOperation={isFirstOpenOperation}
      requireTrackedMaterialsIssued={requireTrackedMaterialsIssued}
      nonConformanceActions={nonConformanceActions}
      operation={operation}
      procedure={procedure}
      job={job}
      thumbnailPath={thumbnailPath}
      correctionName={correctionName}
      workCenter={workCenter}
    />
  );
}
