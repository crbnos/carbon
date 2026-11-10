// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { fetchAllByIds, fetchAllRecords } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
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
  return (
    (client as any)
      .from("inspection")
      .select(
        "*, item(readableId, name, type, itemTrackingType), inspectionSample(*, trackedEntity(id, readableId, attributes, status, sourceDocumentReadableId))"
      )
      .eq("id", id)
      // Samples in the order they were made: an embed has no order of its own,
      // and an UPDATE moves a row, so the grids' positions would shift.
      .order("createdAt", { referencedTable: "inspectionSample" })
      .order("id", { referencedTable: "inspectionSample" })
      .single()
  );
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
      "*, inspectionFeature(id, label, description, pageNumber, type, nominalValue, tolerancePlus, toleranceMinus, unit, materialCondition, gaugeTypeId, pmiItemId, gaugeType(name))"
    )
    .eq("inspectionId", inspectionId)
    .eq("companyId", companyId);
}

// The gauges an inspection lot's view needs: every Active gauge (the
// selectable options — Inactive gauges are retired and never offered, the
// engine refuses them too) plus any gauge already recorded on this lot, even
// if it has since been retired, so the record keeps showing its readable id.
export async function getInspectionGauges(
  client: SupabaseClient<Database>,
  companyId: string,
  inspectionId: string
) {
  const recorded = await client
    .from("inspectionSamplingPlan")
    .select("gaugeId")
    .eq("inspectionId", inspectionId)
    .eq("companyId", companyId)
    .not("gaugeId", "is", null);
  const recordedIds = [
    ...new Set((recorded.data ?? []).map((row) => row.gaugeId as string))
  ];

  const query = client
    .from("gauges")
    .select(
      "id, gaugeId, description, gaugeTypeId, gaugeStatus, gaugeCalibrationStatusWithDueDate"
    )
    .eq("companyId", companyId);

  return (
    recordedIds.length > 0
      ? query.or(
          `gaugeStatus.eq.Active,id.in.(${recordedIds.map((id) => `"${id}"`).join(",")})`
        )
      : query.eq("gaugeStatus", "Active")
  ).order("gaugeId");
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

// The drawing pane needs the document's display name, its PDF preview URL (or
// the model of a plan made from PMI), and the balloon coordinates. This is a simplified read of what the ERP
// quality module assembles via mapInspectionDocument/mapBalloon.
export async function getInspectionDocumentWithBalloons(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string
) {
  const [document, balloons, parameters] = await Promise.all([
    client
      .from("inspectionDocument")
      .select(
        "id, name, fileName, storagePath, modelUploadId, workInstruction, modelUpload(modelPath)"
      )
      .eq("id", inspectionDocumentId)
      .single(),
    client
      .from("balloon")
      .select(
        "id, inspectionFeatureId, pageNumber, xCoordinate, yCoordinate, regionX, regionY, regionWidth, regionHeight"
      )
      .eq("inspectionDocumentId", inspectionDocumentId),
    client
      .from("inspectionDocumentParameter")
      .select("id, key, value")
      .eq("inspectionDocumentId", inspectionDocumentId)
      .order("sortOrder")
      .order("id")
  ]);

  if (document.error) {
    return { data: null, error: document.error };
  }

  const storagePath = document.data?.storagePath ?? null;
  return {
    data: {
      name:
        document.data?.name ?? document.data?.fileName ?? "Untitled Diagram",
      pdfUrl: storagePath
        ? storagePath.startsWith("/file/preview/private/")
          ? storagePath
          : `/file/preview/private/${storagePath}`
        : null,
      balloons: balloons.data ?? [],
      // Fixed key/value pairs the inspector reads before measuring.
      parameters: parameters.data ?? [],
      // Rich text (Tiptap JSON) the inspector reads on every lot of the plan.
      workInstruction: document.data?.workInstruction ?? null,
      // A plan made from a model's PMI holds the model instead of a PDF.
      model: document.data?.modelUploadId
        ? {
            modelUploadId: document.data.modelUploadId,
            modelPath: document.data.modelUpload?.modelPath ?? null
          }
        : null
    },
    error: null
  };
}

// Everything the MES InspectionView needs about a lot that does not depend on
// an operation: its per-feature plans, readings, samples (in the engine's
// column order), the make method's WIP entities and tracking flags, and the
// plan's drawing and the active gauges. Shared by the job-operation and
// first-article routes.
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
    document,
    gauges
  ] = await Promise.all([
    getInspectionSamplingPlans(client, inspection.id, companyId),
    getInspectionMeasurements(client, inspection.id, companyId),
    getIssueTypesList(client, companyId),
    getTrackedEntitiesByMakeMethodId(client, jobMakeMethodId, companyId),
    getJobMakeMethod(client, jobMakeMethodId),
    inspection.inspectionDocumentId
      ? getInspectionDocumentWithBalloons(
          client,
          inspection.inspectionDocumentId
        )
      : Promise.resolve(null),
    getInspectionGauges(client, companyId, inspection.id)
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
    gauges: gauges.data ?? [],
    issueTypes: issueTypes.data ?? [],
    trackedEntities: trackedEntities.data ?? [],
    requiresSerialTracking: jobMakeMethod.data?.requiresSerialTracking ?? false,
    requiresBatchTracking: jobMakeMethod.data?.requiresBatchTracking ?? false,
    balloons: document?.data?.balloons ?? [],
    documentName: document?.data?.name ?? null,
    parameters: document?.data?.parameters ?? [],
    workInstruction: (document?.data?.workInstruction ??
      null) as JSONContent | null,
    pdfUrl: document?.data?.pdfUrl ?? null,
    model: document?.data?.model ?? null
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

// Every open inspection of the company (all sources), newest first, for the
// Inspections queue. Closed lots (Passed / Failed / Partial / Cancelled) are
// left out.
export async function getOpenInspections(
  client: SupabaseClient<Database>,
  companyId: string
) {
  return fetchAllRecords(() =>
    client
      .from("inspection")
      .select(
        "id, inspectionId, sourceDocument, sourceDocumentId, sourceDocumentLineId, sourceDocumentReadableId, itemReadableId, status, lotSize, sampleSize, workCenterId, assignee, createdAt, item(name), inspectionDocument(name, fileName)"
      )
      .eq("companyId", companyId)
      .in("status", ["Pending", "In Progress"])
      .order("createdAt", { ascending: false })
      .order("id")
  );
}

// The job operations Job Operation lots inspect: their work center and
// assignee decide where and for whom the lot is listed.
export async function getInspectionJobOperations(
  client: SupabaseClient<Database>,
  companyId: string,
  jobOperationIds: string[]
) {
  return fetchAllByIds([...new Set(jobOperationIds)], (batch) =>
    client
      .from("jobOperation")
      .select("id, workCenterId, assignee, description")
      .in("id", batch)
      .eq("companyId", companyId)
      .order("id")
  );
}

// The receipt lines Receipt lots inspect, with their receipt: a voided
// receipt's lot leaves the queue, and the line's location (else the
// receipt's) decides which operators see it.
export async function getInspectionReceiptLines(
  client: SupabaseClient<Database>,
  companyId: string,
  receiptLineIds: string[]
) {
  return fetchAllByIds([...new Set(receiptLineIds)], (batch) =>
    client
      .from("receiptLine")
      .select("id, locationId, receipt(status, locationId)")
      .in("id", batch)
      .eq("companyId", companyId)
      .order("id")
  );
}

// The tracked entities a manual inspection covers — the only units its
// samples may be taken from.
export async function getManualInspectionTrackedEntities(
  client: SupabaseClient<Database>,
  inspectionId: string,
  companyId: string
) {
  return client
    .from("inspectionTrackedEntity")
    .select(
      "...trackedEntity!inner(id, readableId, attributes, status, sourceDocumentReadableId)"
    )
    .eq("inspectionId", inspectionId)
    .eq("companyId", companyId);
}

/** The units a receipt lot inspects: the tracked entities of its receipt line. */
export async function getReceiptInspectionTrackedEntities(
  client: SupabaseClient<Database>,
  receiptLineId: string,
  companyId: string
) {
  return client
    .from("trackedEntity")
    .select("id, readableId, attributes, status, sourceDocumentReadableId")
    .eq("attributes ->> Receipt Line", receiptLineId)
    .eq("companyId", companyId)
    .order("createdAt", { ascending: true });
}
