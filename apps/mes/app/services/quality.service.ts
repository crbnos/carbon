import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

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
      "*, inspectionFeature(id, label, description, pageNumber, type, nominalValue, tolerancePlus, toleranceMinus, unit, gaugeTypeId, gaugeType(name))"
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

// The drawing pane needs the document's display name, its PDF preview URL, and
// the balloon coordinates. This is a simplified read of what the ERP
// quality module assembles via mapInspectionDocument/mapBalloon.
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
      .select(
        "id, inspectionFeatureId, pageNumber, xCoordinate, yCoordinate, regionX, regionY, regionWidth, regionHeight"
      )
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
