// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The inspection plan editor's rows and the pure helpers that build them. The
// editor, its hooks and its drawing components share these.

import { BALLOON_H_NORM, BALLOON_W_NORM } from "@carbon/utils";
import type { BalloonRegionAnalysis } from "~/modules/quality/quality.models";
import type { procedureStepType } from "~/modules/shared/shared.models";
import type { SamplingRule } from "./SamplingRuleModal";

export type DragState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
} | null;

export type DragKind =
  | "anchor"
  | "zoom"
  | "annotation"
  | "annotationResize"
  | "balloonMove"
  | "anchorResize"
  | null;

export type SelectorResizeHandle =
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

/** A rectangle in percent of the page (0–100 on each axis). */
export type PctRect = { x: number; y: number; width: number; height: number };

export type AnnotationDraft = PctRect & {
  pageNumber: number;
  text: string;
  fontSize: number;
};

export type AnnotationRecord = AnnotationDraft & { id: string };

export type AnnotationEditDraft = AnnotationRecord;

export type PdfMetrics = {
  pageCount: number;
  defaultPageWidth: number;
  defaultPageHeight: number;
};

export type SelectorRect = PctRect & {
  id: string;
  pageNumber: number;
  isNew: boolean;
  isDirty: boolean;
};

/** One grid row = one inspectionFeature; optional balloon for drawing overlay. */
export type FeatureRow = {
  featureId: string;
  balloonId: string | null;
  balloonAnchorId: string;
  label: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Maps to inspectionFeature.description (editable "Description" column). */
  featureName: string;
  nominalValue: string;
  tolerancePlus: string;
  toleranceMinus: string;
  units: string;
  type: (typeof procedureStepType)[number];
  samplingPlanType: SamplingRule["samplingPlanType"];
  samplingSampleSize: number | null;
  samplingPercentage: number | null;
  samplingAql: number | null;
  samplingInspectionLevel: SamplingRule["samplingInspectionLevel"];
  samplingSeverity: SamplingRule["samplingSeverity"];
  /** Optional gauge type the feature must be measured with. */
  gaugeTypeId: string | null;
  /** The PMI item a model plan's feature was made from (read-only). */
  pmiItemId: string | null;
  featureDirty?: boolean;
  geometryDirty?: boolean;
};

/**
 * What a grid cell's mutation resolves to for an edit kept in the browser:
 * the shape of a PostgREST success. The autosave sends the edit later.
 */
export const LOCAL_EDIT_RESULT = {
  data: null,
  error: null,
  count: null,
  status: 200,
  statusText: "OK",
  success: true
} as const;

const BALLOON_OFFSET_NORM = 0.02;
export const BALLOON_W_PCT = BALLOON_W_NORM * 100;
export const BALLOON_H_PCT = BALLOON_H_NORM * 100;
const BALLOON_OFFSET_PCT = BALLOON_OFFSET_NORM * 100;

/** A characteristic row with no values yet, labelled `label`. */
export function newFeatureRow(
  fields: Pick<
    FeatureRow,
    | "featureId"
    | "balloonId"
    | "balloonAnchorId"
    | "label"
    | "pageNumber"
    | "x"
    | "y"
  >
): FeatureRow {
  return {
    ...fields,
    width: BALLOON_W_PCT,
    height: BALLOON_H_PCT,
    featureName: `Characteristic ${fields.label}`,
    nominalValue: "",
    tolerancePlus: "",
    toleranceMinus: "",
    units: "",
    type: "Measurement",
    samplingPlanType: null,
    samplingSampleSize: null,
    samplingPercentage: null,
    samplingAql: null,
    samplingInspectionLevel: null,
    samplingSeverity: null,
    gaugeTypeId: null,
    pmiItemId: null
  };
}

export function nextBalloonLabel(rows: FeatureRow[]): string {
  const nums = rows
    .map((r) => parseInt(r.label, 10))
    .filter((n) => Number.isFinite(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return String(max + 1);
}

/**
 * Where a new selector's balloon goes: to its right, else to its left when
 * the right runs off the page, and always on the page.
 */
export function balloonBesideSelector(rx: number, ry: number, rw: number) {
  let x = rx + rw + BALLOON_OFFSET_PCT;
  if (x + BALLOON_W_PCT > 100) {
    x = rx - BALLOON_OFFSET_PCT - BALLOON_W_PCT;
  }
  x = Math.max(0, Math.min(100 - BALLOON_W_PCT, x));
  const y = Math.max(0, Math.min(100 - BALLOON_H_PCT, ry));
  return { x, y };
}

/**
 * The rows once a balloon is placed: on the characteristic being placed, or
 * on a new characteristic (`createdFeature`) when none is, or it is gone.
 */
export function placeBalloonOnRows(
  prev: FeatureRow[],
  placement: {
    placingFeatureId: string | null;
    featureId: string;
    balloonId: string;
    pageNumber: number;
    x: number;
    y: number;
  }
): { rows: FeatureRow[]; createdFeature: boolean } {
  const { placingFeatureId, featureId, balloonId, pageNumber, x, y } =
    placement;
  const existing = placingFeatureId
    ? prev.find((r) => r.featureId === placingFeatureId)
    : null;
  if (existing) {
    return {
      createdFeature: false,
      rows: prev.map((r) =>
        r.featureId !== placingFeatureId
          ? r
          : {
              ...r,
              balloonId,
              balloonAnchorId: balloonId,
              pageNumber,
              x,
              y,
              featureDirty: true,
              geometryDirty: true
            }
      )
    };
  }
  return {
    createdFeature: true,
    rows: [
      ...prev,
      newFeatureRow({
        featureId,
        balloonId,
        balloonAnchorId: balloonId,
        label: nextBalloonLabel(prev),
        pageNumber,
        x,
        y
      })
    ]
  };
}

/** The values the drawing's region analysis suggests for a characteristic. */
export function applyRegionAnalysis(
  r: FeatureRow,
  a: BalloonRegionAnalysis
): FeatureRow {
  const fmt = (n: number | null, fallback: string) =>
    n != null && Number.isFinite(n) ? String(n) : fallback;
  const nextNominal = fmt(a.nominal, r.nominalValue);
  const nextPlus = fmt(a.tol_plus, r.tolerancePlus);
  const nextMinus = fmt(a.tol_minus, r.toleranceMinus);
  const nextUnits = a.unit != null ? a.unit : r.units;
  let nextFeatureName = r.featureName;
  if (a.type !== "unknown") {
    const tag = ` [${a.type}]`;
    if (!nextFeatureName.includes(tag)) {
      nextFeatureName = `${nextFeatureName}${tag}`;
    }
  }
  return {
    ...r,
    nominalValue: nextNominal,
    tolerancePlus: nextPlus,
    toleranceMinus: nextMinus,
    units: nextUnits,
    type: "Measurement",
    featureName: nextFeatureName,
    featureDirty: true
  };
}

export function stripBalloonGeometryFromFeatureRows(
  rows: FeatureRow[]
): FeatureRow[] {
  return rows.map((r) =>
    r.balloonId == null
      ? r
      : {
          ...r,
          balloonId: null,
          balloonAnchorId: "",
          x: 0,
          y: 0,
          geometryDirty: false
        }
  );
}

export function hasBalloonGeometry(
  rows: FeatureRow[],
  selectors: SelectorRect[]
): boolean {
  return rows.some((r) => r.balloonId != null) || selectors.length > 0;
}

export function sanitizeFilenameBase(name: string) {
  const trimmed = name.trim().replace(/[\\/:*?"<>|]+/g, "_");
  return (trimmed.length > 0 ? trimmed : "diagram").slice(0, 120);
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function getBalloonValueOrNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function blobToBase64Data(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The drawing's bytes: the picked file, else the stored PDF. */
export async function readPdfBytes(
  pdfFile: File | null,
  pdfUrl: string
): Promise<ArrayBuffer> {
  if (pdfFile !== null) return pdfFile.arrayBuffer();
  const res = await fetch(pdfUrl, { credentials: "include" });
  if (!res.ok) {
    throw new Error(String(res.status));
  }
  return res.arrayBuffer();
}

/** Selector regions are always derived from balloon rows (region = anchor rect). */
export function selectorRectsFromBalloonRecords(
  balloons: Array<Record<string, unknown>>
): SelectorRect[] {
  return balloons.map((b) => ({
    id: String(b.id),
    pageNumber: Number(b.pageNumber ?? 1),
    x: Number(b.regionX ?? b.xCoordinate ?? 0) * 100,
    y: Number(b.regionY ?? b.yCoordinate ?? 0) * 100,
    width: Number(b.regionWidth ?? 0.1) * 100,
    height: Number(b.regionHeight ?? 0.1) * 100,
    isNew: false,
    isDirty: false
  }));
}

/** When a balloon exists, its page is authoritative for overlay placement. */
function resolvedFeaturePageNumber(
  feature: Record<string, unknown>,
  balloon?: Record<string, unknown>
): number {
  if (
    balloon != null &&
    balloon.pageNumber != null &&
    balloon.pageNumber !== ""
  ) {
    return Number(balloon.pageNumber);
  }
  return Number(feature.pageNumber ?? 1);
}

function mapFeatureRowFromRecords(
  feature: Record<string, unknown>,
  balloon?: Record<string, unknown>
): FeatureRow {
  const desc =
    feature.description != null && String(feature.description).trim() !== ""
      ? String(feature.description)
      : "";
  const label = String(feature.label ?? "");
  const featureName = desc || `Characteristic ${label}`;
  const balloonId =
    balloon != null
      ? String(balloon.id)
      : feature.balloonId != null
        ? String(feature.balloonId)
        : null;

  return {
    featureId: String(feature.id),
    balloonId,
    balloonAnchorId: balloonId ?? "",
    label,
    pageNumber: resolvedFeaturePageNumber(feature, balloon),
    x: balloon ? Number(balloon.xCoordinate ?? 0) * 100 : 0,
    y: balloon ? Number(balloon.yCoordinate ?? 0) * 100 : 0,
    width: BALLOON_W_PCT,
    height: BALLOON_H_PCT,
    featureName,
    nominalValue: String(feature.nominalValue ?? ""),
    tolerancePlus: String(feature.tolerancePlus ?? ""),
    toleranceMinus: String(feature.toleranceMinus ?? ""),
    units: String(feature.unit ?? ""),
    type: (feature.type as (typeof procedureStepType)[number]) ?? "Measurement",
    samplingPlanType:
      (feature.samplingPlanType as SamplingRule["samplingPlanType"]) ?? null,
    samplingSampleSize: (feature.samplingSampleSize as number | null) ?? null,
    samplingPercentage:
      feature.samplingPercentage == null
        ? null
        : Number(feature.samplingPercentage),
    samplingAql:
      feature.samplingAql == null ? null : Number(feature.samplingAql),
    samplingInspectionLevel:
      (feature.samplingInspectionLevel as SamplingRule["samplingInspectionLevel"]) ??
      null,
    samplingSeverity:
      (feature.samplingSeverity as SamplingRule["samplingSeverity"]) ?? null,
    gaugeTypeId: (feature.gaugeTypeId as string | null) ?? null,
    pmiItemId: (feature.pmiItemId as string | null) ?? null,
    featureDirty: false,
    geometryDirty: false
  };
}

// Features saved together share one createdAt (the save RPC runs in a single
// transaction), so createdAt alone leaves their order to the heap, and an
// UPDATE moves the edited row to the end. Break the tie by balloon label, the
// order the inspection grid shows them in. Rows are sorted on load only; a
// save response keeps the editor's order (mergeSaveResponse), so a row never
// moves under the cursor.
function compareFeatureRecords(
  a: Record<string, unknown>,
  b: Record<string, unknown>
) {
  const aCreated = String(a.createdAt ?? "");
  const bCreated = String(b.createdAt ?? "");
  return (
    (aCreated < bCreated ? -1 : aCreated > bCreated ? 1 : 0) ||
    String(a.label ?? "").localeCompare(String(b.label ?? ""), undefined, {
      numeric: true
    }) ||
    String(a.id).localeCompare(String(b.id))
  );
}

export function buildFeatureRowsFromLoader(
  features: Array<Record<string, unknown>>,
  balloons: Array<Record<string, unknown>>
) {
  const balloonByFeatureId = new Map(
    balloons.map((b) => [String(b.inspectionFeatureId), b])
  );
  return [...features]
    .sort(compareFeatureRecords)
    .map((f) =>
      mapFeatureRowFromRecords(
        f,
        f.balloonId != null
          ? balloons.find((b) => String(b.id) === String(f.balloonId))
          : balloonByFeatureId.get(String(f.id))
      )
    );
}
