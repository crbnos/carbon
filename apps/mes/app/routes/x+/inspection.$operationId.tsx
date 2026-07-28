import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import {
  getOrCreateJobOperationInspection,
  reconcileInspectionSamplingPlans
} from "@carbon/database/quality";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { InspectionView } from "~/components/Inspection/InspectionView";
import { getDatabaseClient } from "~/services/database.server";
import {
  getJobByOperationId,
  getJobMakeMethod,
  getJobOperationById,
  getProductionEventsForJobOperation,
  getProductionQuantitiesForJobOperation,
  getTrackedEntitiesByMakeMethodId
} from "~/services/operations.service";
import {
  getInspection,
  getInspectionDocumentWithBalloons,
  getInspectionMeasurements,
  getInspectionSamplingPlans,
  getIssueTypesList
} from "~/services/quality.service";
import type { InspectionSample, OperationWithDetails } from "~/services/types";
import { makeDurations } from "~/utils/durations";
import { resolveOperationView } from "~/utils/operationView";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const { operationId } = params;
  if (!operationId) throw new Error("Operation ID is required");

  const url = new URL(request.url);
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

  // Redirect guard (ADR-0005): only Inspection operations render here.
  // Guards only redirect kinds they don't serve, so no loop.
  if (resolveOperationView(op.operationType) !== "inspection") {
    throw redirect(path.to.operation(operationId) + url.search);
  }

  // Lazy find-or-create of the inspection lot for this operation — mirrors
  // post-receipt lot creation (plan snapshot + per-feature plans from the
  // operation's inspectionDocumentId FK). Idempotent per (sourceDocument,
  // sourceDocumentLineId).
  const lot = await getOrCreateJobOperationInspection(getDatabaseClient(), {
    jobOperationId: operationId,
    companyId,
    userId
  });
  if (lot.error || !lot.data) {
    throw redirect(
      path.to.operations,
      await flash(request, error(lot.error, "Failed to create inspection"))
    );
  }

  const inspectionResult = await getInspection(serviceRole, lot.data.id);
  if (inspectionResult.error || !inspectionResult.data) {
    throw redirect(
      path.to.operations,
      await flash(
        request,
        error(inspectionResult.error, "Failed to fetch inspection")
      )
    );
  }
  const inspection = inspectionResult.data as any;

  // The lot references its document live: features added to the document
  // after lot creation get their per-lot plan rows resolved lazily.
  if (inspection.inspectionDocumentId) {
    await reconcileInspectionSamplingPlans(
      getDatabaseClient(),
      lot.data.id,
      companyId
    );
  }

  const [
    features,
    measurements,
    issueTypes,
    trackedEntities,
    jobMakeMethod,
    events,
    quantities,
    linkedQuantities,
    document
  ] = await Promise.all([
    getInspectionSamplingPlans(serviceRole, lot.data.id, companyId),
    getInspectionMeasurements(serviceRole, lot.data.id, companyId),
    getIssueTypesList(serviceRole, companyId),
    getTrackedEntitiesByMakeMethodId(serviceRole, op.jobMakeMethodId),
    getJobMakeMethod(serviceRole, op.jobMakeMethodId),
    getProductionEventsForJobOperation(serviceRole, { operationId, userId }),
    getProductionQuantitiesForJobOperation(serviceRole, operationId),
    // Verdict-driven postings link back to their sample — the UI derives
    // "Complete passed (n)" from what is passed but not yet posted.
    serviceRole
      .from("productionQuantity")
      .select("id, type, quantity, inspectionSampleId")
      .eq("inspectionId", lot.data.id),
    inspection.inspectionDocumentId
      ? getInspectionDocumentWithBalloons(
          serviceRole,
          inspection.inspectionDocumentId
        )
      : Promise.resolve(null)
  ]);

  const linkedProductionRows = (linkedQuantities.data ?? []).filter(
    (row) => row.type === "Production"
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

  // Sample column order must match the engine's required-feature derivation
  // (createdAt asc, id asc).
  const samples = (
    [...(inspection.inspectionSample ?? [])] as InspectionSample[]
  ).sort(
    (a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
      a.id.localeCompare(b.id)
  );

  return {
    job: job.data,
    operation: makeDurations(op) as OperationWithDetails,
    inspection,
    samples,
    features: features.data ?? [],
    measurements: measurements.data ?? [],
    issueTypes: issueTypes.data ?? [],
    trackedEntities: trackedEntities.data ?? [],
    requiresSerialTracking: jobMakeMethod.data?.requiresSerialTracking ?? false,
    requiresBatchTracking: jobMakeMethod.data?.requiresBatchTracking ?? false,
    events: events.data ?? [],
    productionQuantities,
    linkedSampleIds: linkedProductionRows
      .map((row) => row.inspectionSampleId)
      .filter((sampleId): sampleId is string => Boolean(sampleId)),
    linkedProductionQuantity: linkedProductionRows.reduce(
      (sum, row) => sum + (row.quantity ?? 0),
      0
    ),
    jobId: job.data.id ?? null,
    balloons: document?.data?.balloons ?? [],
    documentName: document?.data?.name ?? null,
    pdfUrl: document?.data?.pdfUrl ?? null
  };
}

export default function InspectionRoute() {
  const { operationId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");

  const data = useLoaderData<typeof loader>();
  return <InspectionView {...data} operationId={operationId} />;
}
