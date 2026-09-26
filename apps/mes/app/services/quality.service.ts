import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getJobMakeMethod,
  getTrackedEntitiesByMakeMethodId
} from "./operations.service";
import type { InspectionSample } from "./types";

// Reads for the MES inspection execution view. Copied from the ERP quality
// module's service reads (apps/erp/app/modules/quality/quality.service.ts) —
// MES cannot import ERP app code, and reads stay supabase-js by convention.

export async function getInspection(
  client: SupabaseClient<Database>,
  id: string
) {
  return (client as any)
    .from("inspection")
    .select(
      "*, item(readableId, name, type, itemTrackingType), inspectionSample(*, trackedEntity(id, readableId, attributes, status, sourceDocumentReadableId))"
    )
    .eq("id", id)
    .single();
}

export async function getInspectionSamplingPlans(
  client: SupabaseClient<Database>,
  inspectionId: string,
  companyId: string
) {
  // Embed by target table name, never alias:fkColumn — composite-FK embeds
  // break with the alias form.
  return client
    .from("inspectionSamplingPlan")
    .select(
      "*, inspectionFeature(id, label, description, pageNumber, type, nominalValue, tolerancePlus, toleranceMinus, unit)"
    )
    .eq("inspectionId", inspectionId)
    .eq("companyId", companyId);
}

export async function getInspectionMeasurements(
  client: SupabaseClient<Database>,
  inspectionId: string,
  companyId: string
) {
  return client
    .from("inspectionMeasurement")
    .select("*")
    .eq("inspectionId", inspectionId)
    .eq("companyId", companyId);
}

export async function getIssueTypesList(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return client
    .from("nonConformanceType")
    .select("id, name")
    .eq("companyId", companyId)
    .order("name");
}

// The drawing pane needs the document's display name, its PDF preview URL, and
// the balloon coordinates. This is a simplified read of what the ERP
// production module assembles via mapInspectionDocument/mapBalloon.
export async function getInspectionDocumentWithBalloons(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string
) {
  const [document, balloons] = await Promise.all([
    client
      .from("inspectionDocument")
      .select("id, drawingNumber, fileName, storagePath")
      .eq("id", inspectionDocumentId)
      .single(),
    client
      .from("balloon")
      .select("id, inspectionFeatureId, pageNumber, xCoordinate, yCoordinate")
      .eq("inspectionDocumentId", inspectionDocumentId)
  ]);

  if (document.error) {
    return { data: null, error: document.error };
  }

  const storagePath = document.data?.storagePath ?? null;
  return {
    data: {
      name:
        document.data?.drawingNumber ??
        document.data?.fileName ??
        "Untitled Diagram",
      pdfUrl: storagePath
        ? storagePath.startsWith("/file/preview/private/")
          ? storagePath
          : `/file/preview/private/${storagePath}`
        : null,
      balloons: balloons.data ?? []
    },
    error: null
  };
}

// Everything the MES InspectionView needs about a lot that does not depend on
// an operation: its per-feature plans, readings, samples (in the engine's
// column order), the make method's WIP entities and tracking flags, and the
// plan's drawing. Shared by the job-operation and first-article routes.
export async function getInspectionViewData(
  client: SupabaseClient<Database>,
  args: {
    inspection: {
      id: string;
      inspectionDocumentId: string | null;
      inspectionSample?: InspectionSample[] | null;
    };
    jobMakeMethodId: string;
    companyId: string;
  }
) {
  const { inspection, jobMakeMethodId, companyId } = args;

  const [
    features,
    measurements,
    issueTypes,
    trackedEntities,
    jobMakeMethod,
    document
  ] = await Promise.all([
    getInspectionSamplingPlans(client, inspection.id, companyId),
    getInspectionMeasurements(client, inspection.id, companyId),
    getIssueTypesList(client, companyId),
    getTrackedEntitiesByMakeMethodId(client, jobMakeMethodId),
    getJobMakeMethod(client, jobMakeMethodId),
    inspection.inspectionDocumentId
      ? getInspectionDocumentWithBalloons(
          client,
          inspection.inspectionDocumentId
        )
      : Promise.resolve(null)
  ]);

  // Sample column order must match the engine's required-feature derivation
  // (createdAt asc, id asc).
  const samples = [...(inspection.inspectionSample ?? [])].sort(
    (a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
      a.id.localeCompare(b.id)
  );

  return {
    samples,
    features: features.data ?? [],
    measurements: measurements.data ?? [],
    issueTypes: issueTypes.data ?? [],
    trackedEntities: trackedEntities.data ?? [],
    requiresSerialTracking: jobMakeMethod.data?.requiresSerialTracking ?? false,
    requiresBatchTracking: jobMakeMethod.data?.requiresBatchTracking ?? false,
    balloons: document?.data?.balloons ?? [],
    documentName: document?.data?.name ?? null,
    pdfUrl: document?.data?.pdfUrl ?? null
  };
}

// The job's First Article lots that are still open (not dispositioned). One
// lot per make method; `sourceDocumentLineId` is the jobMakeMethod id.
export async function getOpenFirstArticleInspectionsForJob(
  client: SupabaseClient<Database>,
  jobId: string,
  companyId: string
) {
  return client
    .from("inspection")
    .select(
      "id, inspectionId, status, sourceDocumentLineId, itemReadableId, item(readableId, name)"
    )
    .eq("sourceDocument", "First Article")
    .eq("sourceDocumentId", jobId)
    .eq("companyId", companyId)
    .not("status", "in", '("Passed","Failed","Partial")')
    .order("createdAt", { ascending: true });
}
