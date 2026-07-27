import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getUserClaims } from "@carbon/auth/users.server";
import type { ComponentProps } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { AssemblyView } from "~/components/AssemblyView";
import { getCompanySettings } from "~/services/inventory.service";
import {
  getAssemblyPlaybackByOperationId,
  getJobByOperationId,
  getJobMakeMethod,
  getJobMaterialsByOperationId,
  getJobOperationById,
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
  getWorkCenter
} from "~/services/operations.service";
import type { OperationWithDetails } from "~/services/types";
import { makeDurations } from "~/utils/durations";
import { resolveOperationView } from "~/utils/operationView";
import { path } from "~/utils/path";

type ExpiredEntityPolicy = "Warn" | "Block" | "BlockWithOverride";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  // Manager-only "complete all steps" override is gated on the Production DELETE permission:
  // operators hold view/create/update (they record steps) but not delete, so delete cleanly
  // separates managers from operators regardless of how a company names its employee types.
  const claims = await getUserClaims(userId, companyId);
  const canOverrideComplete =
    claims?.permissions?.production?.delete?.some(
      (c) => c === "0" || c === companyId
    ) ?? false;

  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
  const trackedEntityId = url.searchParams.get("trackedEntityId");

  const serviceRole = await getCarbonServiceRole();

  const [job, operation] = await Promise.all([
    getJobByOperationId(serviceRole, operationId),
    getJobOperationById(serviceRole, operationId)
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

  // Redirect guard (ADR-0005): only Assembly operations render here. Anything else goes
  // back to the operation route (which renders its own view, or redirects again). Guards
  // only redirect kinds they don't serve, so no loop.
  if (resolveOperationView(op.operationType) !== "assembly") {
    throw redirect(path.to.operation(operationId) + url.search);
  }

  const [
    thumbnailPath,
    trackedEntities,
    jobMakeMethod,
    procedure,
    tools,
    ncrs,
    events,
    nonConformanceActions,
    assemblyPlayback
  ] = await Promise.all([
    getThumbnailPathByItemId(serviceRole, op.itemId),
    getTrackedEntitiesByMakeMethodId(serviceRole, op.jobMakeMethodId),
    getJobMakeMethod(serviceRole, op.jobMakeMethodId),
    getJobOperationProcedure(serviceRole, operationId),
    getToolsByOperationId(serviceRole, operationId),
    getNcrsByJobOperationId(serviceRole, operationId),
    getProductionEventsForJobOperation(serviceRole, { operationId, userId }),
    getNonConformanceActions(serviceRole, {
      itemId: op.itemId,
      processId: op.processId,
      companyId
    }),
    getAssemblyPlaybackByOperationId(serviceRole, operationId)
  ]);

  // 3D model slides reference modelUpload rows; resolve their render metadata
  // (glbPath / modelPath / thumbnail) in one query.
  const slideModelIds = Array.from(
    new Set(
      procedure.attributes.flatMap((step) =>
        (step.jobOperationStepSlide ?? []).map((slide) => slide.modelUploadId)
      )
    )
  ).filter((id): id is string => !!id);

  const [quantities, workCenter, kanban, slideModelUploads] = await Promise.all(
    [
      getProductionQuantitiesForJobOperation(serviceRole, operationId),
      getWorkCenter(serviceRole, op.workCenterId),
      job.data.id ? getKanbanByJobId(serviceRole, job.data.id) : null,
      slideModelIds.length > 0
        ? getModelUploadsByIds(serviceRole, slideModelIds)
        : null
    ]
  );

  const productionQuantities = (quantities.data ?? []).reduce(
    (acc, curr) => {
      if (curr.type === "Scrap") acc.scrap += curr.quantity;
      else if (curr.type === "Production") acc.production += curr.quantity;
      else if (curr.type === "Rework") acc.rework += curr.quantity;
      return acc;
    },
    { scrap: 0, production: 0, rework: 0 }
  );

  // Expiry policy for the issue-material modal — same source as the operation view.
  const companySettings = await getCompanySettings(serviceRole, companyId);
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
  const allEntities = trackedEntities.data ?? [];
  const opQty = Math.max(
    1,
    Math.round((op.operationQuantity as number) ?? allEntities.length)
  );
  const isParentTracked =
    (jobMakeMethod.data?.requiresSerialTracking ?? false) ||
    (jobMakeMethod.data?.requiresBatchTracking ?? false);
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
    (jobMakeMethod.data?.requiresBatchTracking ?? false)
      ? navEntities[0]?.id
      : navEntities[unitIndex]?.id;

  const [materials, openEvent] = await Promise.all([
    getJobMaterialsByOperationId(serviceRole, {
      operation: op,
      trackedEntityId: effectiveEntityId,
      requiresSerialTracking:
        jobMakeMethod.data?.requiresSerialTracking ?? false,
      requiresBatchTracking: jobMakeMethod.data?.requiresBatchTracking ?? false,
      unitIndex
    }),
    // Open Labor production event for this operator+operation drives the timer.
    serviceRole
      .from("productionEvent")
      .select("id, startTime")
      .eq("jobOperationId", op.id)
      .eq("employeeId", userId)
      .eq("type", "Labor")
      .is("endTime", null)
      .order("startTime", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  return {
    job: job.data,
    operation: makeDurations(op) as OperationWithDetails,
    thumbnailPath,
    trackedEntities: trackedEntities.data ?? [],
    // The resolved entity for the current unit, or null for untracked units, so the
    // component falls back to the ?unit index instead of snapping back to unit 0.
    trackedEntityId: effectiveEntityId ?? null,
    materials,
    procedure,
    tools: tools.data ?? [],
    ncrs: ncrs.data ?? [],
    requiresSerialTracking: jobMakeMethod.data?.requiresSerialTracking ?? false,
    requiresBatchTracking: jobMakeMethod.data?.requiresBatchTracking ?? false,
    openEvent: openEvent.data ?? null,
    events: events.data ?? [],
    nonConformanceActions,
    expiredEntityPolicy,
    autoStartOperationTimer,
    productionQuantities,
    workCenter:
      (workCenter.data as {
        id: string;
        name: string;
        isBlocked: boolean | null;
        blockingDispatchId: string | null;
        blockingDispatchReadableId: string | null;
      } | null) ?? null,
    kanban: kanban?.data ?? null,
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
