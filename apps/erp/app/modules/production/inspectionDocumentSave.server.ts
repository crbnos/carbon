import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapBalloonIdsToFeatureIdsForDocument } from "./inspectionDocumentDb";
import type {
  inspectionSaveAnchorsPayloadValidator,
  inspectionSaveBalloonsGeometryPayloadValidator,
  inspectionSaveBalloonsPayloadValidator,
  inspectionSaveFeaturesPayloadValidator
} from "./quality.models";

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
