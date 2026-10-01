/**
 * ERP bindings for the shared inspection execution engine
 * (@carbon/database/quality). The engine moved there so the MES inspection
 * routes can run the same transactional core; these wrappers keep the ERP
 * call sites unchanged by currying in the ERP Kysely singleton.
 */
import { openai } from "@ai-sdk/openai";
import type { Database } from "@carbon/database";
import * as engine from "@carbon/database/quality";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateText, Output } from "ai";
import type { z } from "zod";

import { getDatabaseClient } from "~/services/database.server";
import type {
  BalloonRegionAnalysis,
  inspectionDispositionValidator,
  inspectionMeasurementValidator,
  inspectionSampleValidator,
  inspectionSaveAnchorsPayloadValidator,
  inspectionSaveBalloonsGeometryPayloadValidator,
  inspectionSaveBalloonsPayloadValidator,
  inspectionSaveFeaturesPayloadValidator
} from "./quality.models";
import { balloonRegionAnalysisResultSchema } from "./quality.models";

export type { Result } from "@carbon/database/quality";
export { errResult, valuateMeasurement } from "@carbon/database/quality";

export async function upsertInspectionSample(
  sample: z.infer<typeof inspectionSampleValidator> & {
    companyId: string;
    inspectedBy: string;
  }
) {
  return engine.upsertInspectionSample(getDatabaseClient(), sample);
}

export async function dispositionInspection(
  args: z.infer<typeof inspectionDispositionValidator> & {
    companyId: string;
    dispositionedBy: string;
  } & Pick<engine.InspectionDispositionInput, "requireOpen" | "requireSource">
) {
  return engine.dispositionInspection(getDatabaseClient(), args);
}

export async function upsertInspectionMeasurement(
  args: z.infer<typeof inspectionMeasurementValidator> & {
    companyId: string;
    userId: string;
  }
) {
  return engine.upsertInspectionMeasurement(getDatabaseClient(), args);
}

export async function reconcileInspectionSamplingPlans(
  inspectionId: string,
  companyId: string
) {
  return engine.reconcileInspectionSamplingPlans(
    getDatabaseClient(),
    inspectionId,
    companyId
  );
}

export async function changeInspectionDocument(args: {
  inspectionId: string;
  inspectionDocumentId: string | null;
  companyId: string;
  userId: string;
}) {
  return engine.changeInspectionDocument(getDatabaseClient(), args);
}

export async function recordInspectionGauge(
  args: Parameters<typeof engine.recordInspectionGauge>[1]
) {
  return engine.recordInspectionGauge(getDatabaseClient(), args);
}

export async function getRecentInspectionGauges(
  args: Parameters<typeof engine.getRecentInspectionGauges>[1]
) {
  return engine.getRecentInspectionGauges(getDatabaseClient(), args);
}

// ─── Inspection plan save ────────────────────────────────────────────────────

/** Maps persisted balloon ids to inspectionFeature ids for legacy save payloads. */
async function mapBalloonIdsToFeatureIdsForDocument(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string,
  companyId: string,
  ids: string[]
) {
  const unique = [...new Set(ids.filter((id) => id.length > 0))];
  const mapped = new Map<string, string>();
  for (const id of unique) {
    mapped.set(id, id);
  }

  const [balloons, features] = await Promise.all([
    client
      .from("balloon")
      .select("id, inspectionFeatureId")
      .eq("inspectionDocumentId", inspectionDocumentId)
      .eq("companyId", companyId),
    client
      .from("inspectionFeature")
      .select("id")
      .eq("inspectionDocumentId", inspectionDocumentId)
      .eq("companyId", companyId)
  ]);

  for (const balloon of balloons.data ?? []) {
    if (mapped.has(balloon.id)) {
      mapped.set(balloon.id, balloon.inspectionFeatureId);
    }
  }
  for (const row of features.data ?? []) {
    if (mapped.has(row.id)) {
      mapped.set(row.id, row.id);
    }
  }

  return mapped;
}

export type InspectionSaveFeaturesPayload = ReturnType<
  typeof inspectionSaveFeaturesPayloadValidator.parse
>;
export type InspectionSaveBalloonsGeometryPayload = ReturnType<
  typeof inspectionSaveBalloonsGeometryPayloadValidator.parse
>;
type LegacyAnchors = ReturnType<
  typeof inspectionSaveAnchorsPayloadValidator.parse
>;
type LegacyBalloons = ReturnType<
  typeof inspectionSaveBalloonsPayloadValidator.parse
>;

export function isTempInspectionId(id: string) {
  return id.startsWith("temp-");
}

/** Maps legacy anchors + metadata balloons save shape to features + geometry balloons. */
export function translateLegacyInspectionSavePayload(
  anchors: LegacyAnchors,
  balloons: LegacyBalloons
): {
  features: InspectionSaveFeaturesPayload;
  balloons: InspectionSaveBalloonsGeometryPayload;
} {
  const anchorByTempId = new Map(anchors.create.map((a) => [a.tempId, a]));

  const featuresCreate = balloons.create.map((b) => {
    const anchor = anchorByTempId.get(b.tempBalloonAnchorId);
    return {
      tempId: b.tempBalloonAnchorId,
      pageNumber: anchor?.pageNumber ?? 1,
      label: b.label,
      description: b.description ?? null,
      nominalValue: b.nominalValue ?? null,
      tolerancePlus: b.tolerancePlus ?? null,
      toleranceMinus: b.toleranceMinus ?? null,
      unit: b.unit ?? null
    };
  });

  for (const anchor of anchors.create) {
    if (featuresCreate.some((f) => f.tempId === anchor.tempId)) continue;
    featuresCreate.push({
      tempId: anchor.tempId,
      pageNumber: anchor.pageNumber,
      label: "0",
      description: null,
      nominalValue: null,
      tolerancePlus: null,
      toleranceMinus: null,
      unit: null
    });
  }

  const balloonsCreate = balloons.create.map((b) => {
    const anchor = anchorByTempId.get(b.tempBalloonAnchorId);
    return {
      tempInspectionFeatureId: b.tempBalloonAnchorId,
      tempBalloonAnchorId: b.tempBalloonAnchorId,
      pageNumber: anchor?.pageNumber ?? 1,
      regionX: anchor?.xCoordinate ?? 0,
      regionY: anchor?.yCoordinate ?? 0,
      regionWidth: anchor?.width ?? 0.1,
      regionHeight: anchor?.height ?? 0.1,
      xCoordinate: b.xCoordinate,
      yCoordinate: b.yCoordinate
    };
  });

  for (const anchor of anchors.create) {
    if (balloons.create.some((b) => b.tempBalloonAnchorId === anchor.tempId)) {
      continue;
    }
    balloonsCreate.push({
      tempInspectionFeatureId: anchor.tempId,
      tempBalloonAnchorId: anchor.tempId,
      pageNumber: anchor.pageNumber,
      regionX: anchor.xCoordinate,
      regionY: anchor.yCoordinate,
      regionWidth: anchor.width,
      regionHeight: anchor.height,
      xCoordinate: Math.min(
        1 - 0.04,
        Math.max(0, anchor.xCoordinate + anchor.width + 0.02)
      ),
      yCoordinate: Math.min(1 - 0.04, Math.max(0, anchor.yCoordinate))
    });
  }

  const featuresUpdate = balloons.update.map((b) => ({
    id: b.id,
    label: b.label,
    description: b.description ?? null,
    nominalValue: b.nominalValue ?? null,
    tolerancePlus: b.tolerancePlus ?? null,
    toleranceMinus: b.toleranceMinus ?? null,
    unit: b.unit ?? null
  }));

  const balloonsUpdate = [
    ...anchors.update.map((a) => ({
      id: a.id,
      pageNumber: a.pageNumber,
      regionX: a.xCoordinate,
      regionY: a.yCoordinate,
      regionWidth: a.width,
      regionHeight: a.height
    })),
    ...balloons.update.map((b) => ({
      id: b.id,
      xCoordinate: b.xCoordinate,
      yCoordinate: b.yCoordinate
    }))
  ];

  const mergedBalloonUpdates = new Map<
    string,
    (typeof balloonsUpdate)[number]
  >();
  for (const item of balloonsUpdate) {
    const existing = mergedBalloonUpdates.get(item.id);
    mergedBalloonUpdates.set(item.id, { ...existing, ...item });
  }

  return {
    features: {
      create: featuresCreate,
      update: featuresUpdate,
      delete: [...new Set([...balloons.delete, ...anchors.delete])]
    },
    balloons: {
      create: balloonsCreate,
      update: [...mergedBalloonUpdates.values()],
      delete: []
    }
  };
}

export function mergeInspectionFeaturesPayload(
  base: InspectionSaveFeaturesPayload,
  extra: InspectionSaveFeaturesPayload
): InspectionSaveFeaturesPayload {
  return {
    create: [...base.create, ...extra.create],
    update: [...base.update, ...extra.update],
    delete: [...new Set([...base.delete, ...extra.delete])]
  };
}

export function mergeInspectionBalloonsPayload(
  base: InspectionSaveBalloonsGeometryPayload,
  extra: InspectionSaveBalloonsGeometryPayload
): InspectionSaveBalloonsGeometryPayload {
  return {
    create: [...base.create, ...extra.create],
    update: [...base.update, ...extra.update],
    delete: [...new Set([...base.delete, ...extra.delete])]
  };
}

export async function resolveInspectionFeaturePayloadIds(
  client: SupabaseClient<Database>,
  inspectionDocumentId: string,
  companyId: string,
  features: InspectionSaveFeaturesPayload
): Promise<InspectionSaveFeaturesPayload> {
  const ids = [
    ...features.update.map((row) => row.id),
    ...features.delete
  ].filter((rowId) => !isTempInspectionId(rowId));

  if (ids.length === 0) {
    return features;
  }

  const idMap = await mapBalloonIdsToFeatureIdsForDocument(
    client,
    inspectionDocumentId,
    companyId,
    ids
  );

  return {
    create: features.create,
    update: features.update.map((row) => ({
      ...row,
      id: idMap.get(row.id) ?? row.id
    })),
    delete: [
      ...new Set(features.delete.map((rowId) => idMap.get(rowId) ?? rowId))
    ]
  };
}

// ─── Balloon region vision analysis ──────────────────────────────────────────

/** Decoded image size limit for vision analyze (bytes). */
export const INSPECTION_BALLOON_ANALYZE_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const BALLOON_REGION_ANALYSIS_SYSTEM = `You assist with mechanical inspection ballooning on technical CAD drawings.

You receive one raster image: a crop of a single callout region from a sheet.

Return ONLY the JSON object matching the schema (field names and allowed enum values exactly).

type (required, exactly one of):
- linear — linear length/width/height dimension without ⌀ or R prefix.
- diameter — nominal is the value for a diameter callout (⌀ or equivalent).
- radius — nominal is the value for a radius callout (R or equivalent).
- angle — nominal is the numeric angle; set unit to degree or rad only when °, deg, or rad is visible in the crop; otherwise unit null.
- unknown — not clearly one of the above, or unreadable / ambiguous.

unit (nullable, exactly one of the allowed enum strings or null):
- Default is null. Set unit ONLY when this crop visibly shows a unit indicator (e.g. mm, cm, m, um, µm, in, ", IN, ft, °, DEG, RAD, or equivalent text/symbols next to the dimension).
- Do NOT infer unit from decimal places, title block, drawing "standard," locale, or anything outside visible pixels in this crop. A bare number with tolerances but no unit text/symbol → unit null.
- For type angle: use degree or rad only when that angle notation is visible; otherwise unit null.

nominal / tolerances:
- Prefer numbers from the print; use null (not zero) when not shown or unreadable.
- Bilateral ±T: tol_plus = +T, tol_minus = -T (e.g. ±0.02 → tol_plus 0.02, tol_minus -0.02).
- Unilateral stacked +0.005 / -0.000 (plus above, minus below nominal): tol_plus = 0.005, tol_minus = 0 (minus side is zero additional tolerance below nominal).
- Other asymmetric +a / −b (both non-zero): tol_plus = +a, tol_minus = -b using the signed values as printed relative to nominal.

Do not invent title-block or revision data outside the crop.
`;

const BALLOON_REGION_ANALYSIS_USER_MESSAGE =
  "Extract nominal, tol_plus, tol_minus, unit, and type per the system rules. For unit: use null unless a unit symbol or unit letters are literally visible in this crop; do not guess. Use only allowed enum literals for type and for unit when non-null.";

const BALLOON_REGION_ANALYSIS_SCHEMA_DESCRIPTION =
  "Drawing crop: nominal, tolerances, type enum; unit enum only when a unit symbol/text is visible in the crop, otherwise null";

/**
 * Runs vision extraction on a prepared PNG/JPEG/WebP buffer (caller validates size and auth).
 */
export async function runInspectionBalloonRegionVisionAnalysis(args: {
  imageBytes: Buffer;
  mediaType: string;
}): Promise<BalloonRegionAnalysis> {
  const { imageBytes, mediaType } = args;
  const { output: object } = await generateText({
    model: openai("gpt-4o"),
    output: Output.object({
      schema: balloonRegionAnalysisResultSchema,
      name: "balloon_region_analysis",
      description: BALLOON_REGION_ANALYSIS_SCHEMA_DESCRIPTION
    }),
    instructions: BALLOON_REGION_ANALYSIS_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: BALLOON_REGION_ANALYSIS_USER_MESSAGE },
          {
            type: "image",
            image: imageBytes,
            mediaType
          }
        ]
      }
    ],
    temperature: 0.1
  });
  return object;
}
