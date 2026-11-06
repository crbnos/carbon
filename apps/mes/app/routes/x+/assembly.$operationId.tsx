// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getUserClaims } from "@carbon/auth/users.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ComponentProps } from "react";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { AssemblyView } from "~/components/AssemblyView";
import { getCompanySettings } from "~/services/inventory.service";
import {
  getAbilityShortfall,
  getAssemblyPlaybackByOperationId,
  getJob,
  getJobMakeMethod,
  getJobMaterialsByOperationId,
  getJobOperationById,
  getJobOperationForCompany,
  getJobOperationProcedure,
  getKanbanByJobId,
  getModelUploadsByIds,
  getNcrsByJobOperationId,
  getNonConformanceActions,
  getProductionEventsForJobOperation,
  getProductionQuantitiesForJobOperation,
  getThumbnailPathByItemId,
  getToolsByOperationId,
  getTrackedEntitiesByMakeMethodId,
  getWorkCenter,
  isFirstOperationOfMakeMethod
} from "~/services/operations.service";
import type { OperationWithDetails } from "~/services/types";
import { makeDurations } from "~/utils/durations";
import { recordMeta } from "~/utils/meta";
import { resolveOperationView } from "~/utils/operationView";
import { path } from "~/utils/path";

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

const logger = getLogger("mes", "assembly");

export const meta: MetaFunction<typeof loader> = ({ data }) =>
  recordMeta(
    [data?.operation?.jobReadableId, data?.operation?.description],
    "Assembly"
  );

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  // Manager-only "complete all steps" override is gated on the Production DELETE permission:
  // operators hold view/create/update (they record steps) but not delete, so delete cleanly
  // separates managers from operators regardless of how a company names its employee types.
  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
  const trackedEntityId = url.searchParams.get("trackedEntityId");

  const serviceRole = await getCarbonServiceRole();

  // Every read below is service-role: verify the operation is this company's.
  const [claims, ownedOperation] = await Promise.all([
    getUserClaims(userId, companyId),
    getJobOperationForCompany(serviceRole, operationId, companyId)
  ]);
  const canOverrideComplete =
    claims?.permissions?.production?.delete?.some(
      (c) => c === "0" || c === companyId
    ) ?? false;
  if (!ownedOperation.data) {
    logger.warn("Operation not found in company", {
      companyId,
      operationId,
      error: ownedOperation.error
    });
    throw redirect(
      path.to.operations,
      await flash(request, error(ownedOperation.error, "Operation not found"))
    );
  }

  // One wave: everything below needs only ids the ownership check returned (or
  // chains on the operation / procedure read), so it is read before the
  // redirect checks rather than one step after another. A redirect discards
  // reads the page then never uses; the ids are the company's.
  const { jobId, jobMakeMethodId, operationType } = ownedOperation.data;

  // Redirect guard (ADR-0005): only Assembly operations render here. Anything else goes
  // back to the operation route (which renders its own view, or redirects again). Guards
  // only redirect kinds they don't serve, so no loop. Checked before the read wave.
  if (resolveOperationView(operationType) !== "assembly") {
    throw redirect(path.to.operation(operationId) + url.search);
  }

  const operationPromise = getJobOperationById(serviceRole, operationId);
  const procedurePromise = getJobOperationProcedure(serviceRole, operationId);
  const [
    job,
    operation,
    thumbnailPath,
    trackedEntities,
    jobMakeMethod,
    procedure,
    tools,
    ncrs,
    events,
    nonConformanceActions,
    assemblyPlayback,
    quantities,
    workCenter,
    kanban,
    slideModelUploads,
    companySettings,
    abilityWarning,
    openEvent,
    isFirstOperation
  ] = await Promise.all([
    getJob(serviceRole, jobId),
    operationPromise,
    operationPromise.then((result) => {
      const itemId = result.data?.[0]?.itemId;
      return itemId ? getThumbnailPathByItemId(serviceRole, itemId) : null;
    }),
    jobMakeMethodId
      ? getTrackedEntitiesByMakeMethodId(
          serviceRole,
          jobMakeMethodId,
          companyId
        )
      : null,
    jobMakeMethodId ? getJobMakeMethod(serviceRole, jobMakeMethodId) : null,
    procedurePromise,
    getToolsByOperationId(serviceRole, operationId),
    getNcrsByJobOperationId(serviceRole, operationId),
    getProductionEventsForJobOperation(serviceRole, { operationId, userId }),
    // A missing operation row redirects below, so these chains skip it.
    operationPromise.then((result) => {
      const row = result.data?.[0];
      return row
        ? getNonConformanceActions(serviceRole, {
            itemId: row.itemId,
            processId: row.processId,
            companyId
          })
        : [];
    }),
    getAssemblyPlaybackByOperationId(serviceRole, operationId),
    getProductionQuantitiesForJobOperation(serviceRole, operationId),
    operationPromise.then((result) => {
      const row = result.data?.[0];
      return row ? getWorkCenter(serviceRole, row.workCenterId) : null;
    }),
    getKanbanByJobId(serviceRole, jobId),
    // 3D model slides reference modelUpload rows; resolve their render
    // metadata (glbPath / modelPath / thumbnail) in one query.
    procedurePromise.then((procedure) => {
      const slideModelIds = Array.from(
        new Set(
          procedure.attributes.flatMap((step) =>
            (step.jobOperationStepSlide ?? []).map(
              (slide) => slide.modelUploadId
            )
          )
        )
      ).filter((id): id is string => !!id);
      return slideModelIds.length > 0
        ? getModelUploadsByIds(serviceRole, slideModelIds)
        : null;
    }),
    // Expiry policy for the issue-material modal — same source as the operation view.
    getCompanySettings(serviceRole, companyId),
    getAbilityShortfall(serviceRole, {
      operationId,
      employeeId: userId,
      companyId
    }),
    // Open Labor production event for this operator+operation drives the timer.
    serviceRole
      .from("productionEvent")
      .select("id, startTime")
      .eq("jobOperationId", operationId)
      .eq("employeeId", userId)
      .eq("type", "Labor")
      .is("endTime", null)
      .order("startTime", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Is this the first operation in the routing? A serial unit only earns a printed
    // label when completed at its first operation, so the first op flows unit-by-unit
    // (auto-select), and later ops scan/select (labels exist).
    jobMakeMethodId
      ? isFirstOperationOfMakeMethod(serviceRole, operationId, jobMakeMethodId)
      : false
  ]);

  if (job.error)
    throw redirect(
      path.to.operations,
      await flash(request, error(job.error, "Failed to fetch job"))
    );
  if (operation.error)
    throw redirect(
      path.to.operations,
      await flash(request, error(operation.error, "Failed to fetch operation"))
    );

  const op = operation.data?.[0];
  if (!op) throw redirect(path.to.operations);
  // The early redirect used the ownership read's type; check the row this
  // page renders too.
  if (resolveOperationView(op.operationType) !== "assembly") {
    throw redirect(path.to.operation(operationId) + url.search);
  }

  const productionQuantities = (quantities.data ?? []).reduce(
    (acc, curr) => {
      if (curr.type === "Scrap") acc.scrap += curr.quantity;
      else if (curr.type === "Production") acc.production += curr.quantity;
      else if (curr.type === "Rework") acc.rework += curr.quantity;
      return acc;
    },
    { scrap: 0, production: 0, rework: 0 }
  );

  const inventoryShelfLife = (companySettings.data?.inventoryShelfLife ??
    null) as { expiredEntityPolicy?: ExpiredEntityPolicy } | null;
  const expiredEntityPolicy: ExpiredEntityPolicy =
    inventoryShelfLife?.expiredEntityPolicy ?? "Block";

  // Passive operation timer (opt-in). When on, the assembly view auto-starts the operator's
  // timer on open (see AutoTimer in AssemblyView). It never auto-ends a timer.
  const autoStartOperationTimer =
    companySettings.data?.autoStartOperationTimer ?? false;

  // Resolve the unit the materials/consume target key off. Only serial/batch parents
  // bind per-unit tracked entities; inventory/non-inventory parents page purely by index,
  // so their stray inventory entities must NOT seed the unit axis. Navigable units are
  // capped to the operation quantity (a job can pre-generate extra serials). An explicit
  // ?trackedEntityId wins; otherwise honor the ?unit index, so client navigation to an
  // untracked unit isn't snapped back to unit 0.
  const allEntities = trackedEntities?.data ?? [];
  const opQty = Math.max(
    1,
    Math.round((op.operationQuantity as number) ?? allEntities.length)
  );
  const isParentTracked =
    (jobMakeMethod?.data?.requiresSerialTracking ?? false) ||
    (jobMakeMethod?.data?.requiresBatchTracking ?? false);
  const navEntities = isParentTracked ? allEntities.slice(0, opQty) : [];
  const unitParam = Number.parseInt(url.searchParams.get("unit") ?? "", 10);
  const entityIndex = trackedEntityId
    ? navEntities.findIndex((te) => te.id === trackedEntityId)
    : -1;
  // Must match AssemblyView.currentUnitIndex: with no explicit ?unit/?trackedEntityId,
  // land on the NEXT unit still to build (quantityComplete), not unit 0 — for EVERY
  // tracking type. A serial parent seeds trackedEntityId to this unit's entity below,
  // so a fresh load resumes on the in-progress unit instead of a finished unit 1. The
  // component deletes ?unit after completing a unit and rolls forward on quantityComplete;
  // material issue attribution also keys off this unit, so a stale 0 would mis-credit it.
  const quantityComplete = Math.max(
    0,
    Math.round((op.quantityComplete as number) ?? 0)
  );
  const defaultUnitIndex = Math.min(quantityComplete, Math.max(0, opQty - 1));
  const unitIndex =
    entityIndex >= 0
      ? entityIndex
      : Number.isInteger(unitParam) && unitParam >= 0 && unitParam < opQty
        ? unitParam
        : defaultUnitIndex;
  // A batch parent shares ONE lot across every unit, so its lot entity binds to all
  // units regardless of the unit index; a serial parent binds a distinct entity per
  // unit (navEntities[unitIndex]).
  const effectiveEntityId =
    (jobMakeMethod?.data?.requiresBatchTracking ?? false)
      ? navEntities[0]?.id
      : navEntities[unitIndex]?.id;

  const materials = await getJobMaterialsByOperationId(serviceRole, {
    operation: op,
    trackedEntityId: effectiveEntityId,
    requiresSerialTracking:
      jobMakeMethod?.data?.requiresSerialTracking ?? false,
    requiresBatchTracking: jobMakeMethod?.data?.requiresBatchTracking ?? false,
    unitIndex
  });

  return {
    abilityWarning,
    job: job.data,
    operation: makeDurations(op) as OperationWithDetails,
    thumbnailPath,
    trackedEntities: trackedEntities?.data ?? [],
    // The resolved entity for the current unit, or null for untracked units, so the
    // component falls back to the ?unit index instead of snapping back to unit 0.
    trackedEntityId: effectiveEntityId ?? null,
    materials,
    procedure,
    tools: tools.data ?? [],
    ncrs: ncrs.data ?? [],
    requiresSerialTracking:
      jobMakeMethod?.data?.requiresSerialTracking ?? false,
    requiresBatchTracking: jobMakeMethod?.data?.requiresBatchTracking ?? false,
    isFirstOperation,
    openEvent: openEvent.data ?? null,
    events: events.data ?? [],
    nonConformanceActions,
    expiredEntityPolicy,
    autoStartOperationTimer,
    productionQuantities,
    workCenter:
      (workCenter?.data as {
        id: string;
        name: string;
        isBlocked: boolean | null;
        blockingDispatchId: string | null;
        blockingDispatchReadableId: string | null;
      } | null) ?? null,
    kanban: kanban.data ?? null,
    jobId: job.data.id ?? null,
    canOverrideComplete,
    modelPath:
      (op as { itemModelPath?: string | null }).itemModelPath ??
      (job.data as { modelPath?: string | null }).modelPath ??
      null,
    slideModels: Object.fromEntries(
      (slideModelUploads?.data ?? []).map((model) => [model.id, model])
    ),
    assemblyPlayback
  };
}

export default function AssemblyRoute() {
  const { operationId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");

  const data = useLoaderData<typeof loader>();
  // The generated DB types leave JSONB columns as `Json`; the slide annotations
  // are written exclusively by the ERP editors through slideAnnotationValidator,
  // so the view's narrowed pin type is the real runtime shape.
  const procedure = data.procedure as unknown as ComponentProps<
    typeof AssemblyView
  >["procedure"];
  return (
    <AssemblyView {...data} procedure={procedure} operationId={operationId} />
  );
}
