// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

/**
 * The drawing as a client with no PDF engine can use it: the document's name
 * and its balloon geometry, with no PDF and no url to one.
 *
 * A sibling of `getInspectionDocumentWithBalloons` rather than a replacement —
 * that one still serves the web pane, which needs the `pdfUrl` this
 * deliberately omits. Both read the same two tables, so the two panes cannot
 * disagree about where a balloon sits.
 *
 * Scoped by `companyId`, which the web read is not. The id arrives from the
 * lot row rather than from a caller, but a drawing is the one record here that
 * several lots share, so scoping it is the difference between "this lot's
 * drawing" and "any drawing whose id I can name".
 */
export async function getInspectionDrawing(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string,
  companyId: string
) {
  const document = await client
    .from("inspectionDocument")
    .select("id, drawingNumber, fileName")
    .eq("id", inspectionDocumentId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (document.error || !document.data) return null;

  const balloons = await client
    .from("balloon")
    .select(
      "id, inspectionFeatureId, pageNumber, xCoordinate, yCoordinate, regionX, regionY, regionWidth, regionHeight"
    )
    .eq("inspectionDocumentId", inspectionDocumentId);

  return {
    documentName:
      document.data.drawingNumber ??
      document.data.fileName ??
      "Untitled Diagram",
    balloons: balloons.data ?? []
  };
}

/**
 * Where the drawing's PDF lives, for the endpoint that rasterises a page.
 *
 * Returns the storage key only. The caller still has to guard it
 * (`isUnsafeStoragePath`, and that `companyId` is a real path segment) before
 * handing it to storage: this row is the caller's own company's, but a
 * malformed `storagePath` in it must not be able to read another tenant's
 * bucket.
 */
export async function getInspectionDrawingStoragePath(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string,
  companyId: string
) {
  return client
    .from("inspectionDocument")
    .select("id, storagePath")
    .eq("id", inspectionDocumentId)
    .eq("companyId", companyId)
    .maybeSingle();
}
