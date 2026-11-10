// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { round } from "@carbon/utils";
import type { Vec3 } from "./types";

/**
 * `pmi.json` — the PMI (Product Manufacturing Information) the assembler's
 * optimize ingest reads from a STEP AP242 model: dimensions, geometric
 * tolerances, datums and graphic-only notes, plus the model's saved views.
 * Written by `crates/converter/src/pmi.rs`; the two must agree field for
 * field. Every length and coordinate is world mm in the frame of the optimised
 * GLB; angles are degrees.
 */
export type PmiDocument = {
  version: 1;
  unit: "mm";
  /** The STEP file's length unit, when the ingest read the STEP header. */
  sourceUnit: "mm" | "in" | null;
  items: PmiItem[];
  /** Triangles of every face an item references (`PmiItem.faces` indexes this). */
  faces: PmiMesh[];
  /** Flat x,y,z polylines of every edge an item references. */
  edges: number[][];
  views: PmiView[];
};

export type PmiKind = "dimension" | "tolerance" | "datum" | "note";

export type PmiMesh = { positions: number[]; indices: number[] };

export type PmiPlane = { origin: Vec3; normal: Vec3; xDirection: Vec3 };

export type PmiItem = {
  /** `d1`, `t1`, `a1`, `n1`… in document order, per kind. */
  id: string;
  kind: PmiKind;
  /** The CAD author's name for the item (semantic or presentation name). */
  name: string | null;
  dimension: PmiDimension | null;
  tolerance: PmiTolerance | null;
  datum: PmiDatum | null;
  /** Graphical PMI: leader lines, frames and stroked text, flat x,y,z polylines. */
  lines: number[][];
  /** Graphical PMI: filled (tessellated) text and arrowheads. */
  mesh: PmiMesh | null;
  plane: PmiPlane | null;
  textPosition: Vec3 | null;
  /** Indices into `PmiDocument.faces`. */
  faces: number[];
  /** Indices into `PmiDocument.edges`. */
  edges: number[];
};

/**
 * OCCT `XCAFDimTolObjects_DimensionType` in lower camel case, without the
 * `Location_` / `Size_` prefix. `angular` is a location angle and
 * `angularSize` a size angle; both carry degrees.
 */
export type PmiDimensionType =
  | "none"
  | "curvedDistance"
  | "linearDistance"
  | "linearDistanceFromCenterToOuter"
  | "linearDistanceFromCenterToInner"
  | "linearDistanceFromOuterToCenter"
  | "linearDistanceFromOuterToOuter"
  | "linearDistanceFromOuterToInner"
  | "linearDistanceFromInnerToCenter"
  | "linearDistanceFromInnerToOuter"
  | "linearDistanceFromInnerToInner"
  | "angular"
  | "oriented"
  | "withPath"
  | "curveLength"
  | "diameter"
  | "sphericalDiameter"
  | "radius"
  | "sphericalRadius"
  | "toroidalMinorDiameter"
  | "toroidalMajorDiameter"
  | "toroidalMinorRadius"
  | "toroidalMajorRadius"
  | "toroidalHighMajorDiameter"
  | "toroidalLowMajorDiameter"
  | "toroidalHighMajorRadius"
  | "toroidalLowMajorRadius"
  | "thickness"
  | "angularSize"
  | "sizeWithPath"
  | "commonLabel"
  | "presentation";

export type PmiDimension = {
  type: PmiDimensionType;
  /** Nominal (mm, or degrees for an angle). For a range, the midpoint. */
  value: number | null;
  /** Plus/minus tolerance: the upper deviation (`+0.1`). */
  upper: number | null;
  /** Plus/minus tolerance: the lower deviation, negative (`-0.05`). */
  lower: number | null;
  /** Limit dimension: the upper and lower limits. */
  upperBound: number | null;
  lowerBound: number | null;
  /** ISO fit, e.g. hole `H` grade `IT7` reads `H7`. */
  fitClass: { hole: boolean; formVariance: string; grade: string } | null;
  qualifier: "min" | "max" | "avg" | null;
  /** The author's digits left/right of the point, in the source unit. */
  decimals: { left: number; right: number } | null;
  /** OCCT `XCAFDimTolObjects_DimensionModif`, lower camel case. */
  modifiers: string[];
  descriptions: string[];
};

/** OCCT `XCAFDimTolObjects_GeomToleranceType`, lower camel case. */
export type PmiToleranceType =
  | "none"
  | "angularity"
  | "circularRunout"
  | "circularityOrRoundness"
  | "coaxiality"
  | "concentricity"
  | "cylindricity"
  | "flatness"
  | "parallelism"
  | "perpendicularity"
  | "position"
  | "profileOfLine"
  | "profileOfSurface"
  | "straightness"
  | "symmetry"
  | "totalRunout";

export type PmiTolerance = {
  type: PmiToleranceType;
  /** Zone size, mm. */
  value: number | null;
  zoneShape: "diameter" | "sphericalDiameter" | null;
  /** Material condition: Ⓜ maximum, Ⓛ least. */
  material: "M" | "L" | null;
  zoneModifier: "projected" | "runout" | "nonUniform" | null;
  zoneModifierValue: number | null;
  /** OCCT `XCAFDimTolObjects_GeomToleranceModif`, lower camel case. */
  modifiers: string[];
  maxValue: number | null;
  /** Datum references in precedence order (primary first). */
  datums: { name: string; modifiers: string[] }[];
};

export type PmiDatum = {
  /** The datum letter. */
  name: string;
  modifiers: string[];
  /** Datum target type (`point`, `line`, `rectangle`, `circle`, `area`), or null. */
  target: string | null;
};

export type PmiView = {
  id: string;
  name: string;
  /** From the camera towards the model. */
  direction: Vec3;
  up: Vec3;
  projection: "parallel" | "central" | null;
  itemIds: string[];
};

export const PMI_VERSION = 1;

const PMI_KINDS: ReadonlySet<string> = new Set<PmiKind>([
  "dimension",
  "tolerance",
  "datum",
  "note"
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => typeof n === "number" && Number.isFinite(n));

const isMesh = (value: unknown): value is PmiMesh =>
  isRecord(value) &&
  Array.isArray(value.positions) &&
  Array.isArray(value.indices);

const isPolylineList = (value: unknown): value is number[][] =>
  Array.isArray(value) && value.every(Array.isArray);

function isItem(value: unknown): value is PmiItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    PMI_KINDS.has(value.kind) &&
    isPolylineList(value.lines) &&
    (value.mesh === null || isMesh(value.mesh)) &&
    (value.textPosition === null || isVec3(value.textPosition)) &&
    (value.plane === null ||
      (isRecord(value.plane) &&
        isVec3(value.plane.origin) &&
        isVec3(value.plane.normal))) &&
    (value.dimension === null || isRecord(value.dimension)) &&
    (value.tolerance === null || isRecord(value.tolerance)) &&
    (value.datum === null || isRecord(value.datum)) &&
    Array.isArray(value.faces) &&
    Array.isArray(value.edges)
  );
}

function isView(value: unknown): value is PmiView {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isVec3(value.direction) &&
    isVec3(value.up) &&
    Array.isArray(value.itemIds)
  );
}

/**
 * Reads a fetched `pmi.json`. Null when the version is not
 * {@link PMI_VERSION} or the shape is wrong — the viewer then shows no PMI.
 * Extra fields are kept and ignored, so a later additive change on the
 * converter side does not break an older viewer.
 */
export function parsePmiDocument(json: unknown): PmiDocument | null {
  if (!isRecord(json) || json.version !== PMI_VERSION) return null;
  if (json.unit !== "mm") return null;
  const sourceUnit = json.sourceUnit ?? null;
  if (sourceUnit !== null && sourceUnit !== "mm" && sourceUnit !== "in") {
    return null;
  }
  if (
    !Array.isArray(json.items) ||
    !json.items.every(isItem) ||
    !Array.isArray(json.faces) ||
    !json.faces.every(isMesh) ||
    !isPolylineList(json.edges) ||
    !Array.isArray(json.views) ||
    !json.views.every(isView)
  ) {
    return null;
  }
  return { ...(json as PmiDocument), sourceUnit };
}

// ---------------------------------------------------------------------------
// Label formatting
// ---------------------------------------------------------------------------

export type PmiDisplayUnit = "mm" | "in";

export type PmiItemLabel = {
  /** What the drawing would print: `⌀10 ±0.1`, `⌖ | ⌀0.1 Ⓜ | A | B`, `A`. */
  label: string;
  /** The geometric characteristic symbol of a tolerance, else null. */
  symbol: string | null;
  /** A human name: "Position", "Diameter", "Datum A". */
  title: string;
};

const MM_PER_IN = 25.4;
const MINUS = "−";
const DIAMETER = "⌀";

/** Digits when the display unit is not the file's own (or the file has none). */
const DEFAULT_DECIMALS: Record<PmiDisplayUnit, number> = { mm: 3, in: 4 };

const TOLERANCE_SYMBOLS: Record<PmiToleranceType, string | null> = {
  none: null,
  straightness: "⏤",
  flatness: "⏥",
  circularityOrRoundness: "○",
  cylindricity: "⌭",
  profileOfLine: "⌒",
  profileOfSurface: "⌓",
  angularity: "∠",
  perpendicularity: "⟂",
  parallelism: "∥",
  position: "⌖",
  concentricity: "◎",
  coaxiality: "◎",
  symmetry: "⌯",
  circularRunout: "↗",
  totalRunout: "⌰"
};

const TOLERANCE_TITLES: Record<PmiToleranceType, string> = {
  none: "Geometric tolerance",
  straightness: "Straightness",
  flatness: "Flatness",
  circularityOrRoundness: "Circularity",
  cylindricity: "Cylindricity",
  profileOfLine: "Profile of a line",
  profileOfSurface: "Profile of a surface",
  angularity: "Angularity",
  perpendicularity: "Perpendicularity",
  parallelism: "Parallelism",
  position: "Position",
  concentricity: "Concentricity",
  coaxiality: "Coaxiality",
  symmetry: "Symmetry",
  circularRunout: "Circular runout",
  totalRunout: "Total runout"
};

const DIMENSION_PREFIXES: Partial<Record<PmiDimensionType, string>> = {
  diameter: DIAMETER,
  toroidalMinorDiameter: DIAMETER,
  toroidalMajorDiameter: DIAMETER,
  toroidalHighMajorDiameter: DIAMETER,
  toroidalLowMajorDiameter: DIAMETER,
  sphericalDiameter: `S${DIAMETER}`,
  radius: "R",
  toroidalMinorRadius: "R",
  toroidalMajorRadius: "R",
  toroidalHighMajorRadius: "R",
  toroidalLowMajorRadius: "R",
  sphericalRadius: "SR"
};

function dimensionTitle(type: PmiDimensionType): string {
  if (type.startsWith("linearDistance")) return "Linear distance";
  if (type.startsWith("toroidal")) {
    return type.endsWith("Diameter") ? "Toroidal diameter" : "Toroidal radius";
  }
  switch (type) {
    case "diameter":
      return "Diameter";
    case "sphericalDiameter":
      return "Spherical diameter";
    case "radius":
      return "Radius";
    case "sphericalRadius":
      return "Spherical radius";
    case "angular":
      return "Angle";
    case "angularSize":
      return "Angular size";
    case "curvedDistance":
      return "Curved distance";
    case "curveLength":
      return "Curve length";
    case "thickness":
      return "Thickness";
    case "oriented":
      return "Oriented distance";
    case "withPath":
      return "Distance along path";
    case "sizeWithPath":
      return "Size along path";
    default:
      return "Dimension";
  }
}

const isAngular = (type: PmiDimensionType) =>
  type === "angular" || type === "angularSize";

const formatters = new Map<string, Intl.NumberFormat>();

/** Locale-free (`.` decimal, no grouping): labels read like the drawing. */
function formatNumber(
  value: number,
  minimumFractionDigits: number,
  maximumFractionDigits: number
): string {
  const key = `${minimumFractionDigits}:${maximumFractionDigits}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      useGrouping: false,
      minimumFractionDigits,
      maximumFractionDigits
    });
    formatters.set(key, formatter);
  }
  // `-0` would print as "-0".
  const text = formatter.format(value);
  return text === "-0" ? "0" : text;
}

/**
 * How a number is printed: the author's digits (padded, as on the drawing)
 * when the display unit is the file's own unit, else a fixed precision per
 * unit with trailing zeros trimmed. `tolerance` widens the author's digits
 * rather than cutting them, so `±0.05` on a `0` decimal nominal still reads.
 */
type NumberStyle = { min: number; max: number };

function lengthStyle(
  decimals: PmiDimension["decimals"] | null,
  unit: PmiDisplayUnit,
  sourceUnit: PmiDisplayUnit | null,
  tolerance: boolean
): NumberStyle {
  const fallback = DEFAULT_DECIMALS[unit];
  if (decimals && unit === sourceUnit) {
    const right = Math.max(0, Math.min(decimals.right, 10));
    return { min: right, max: tolerance ? Math.max(right, fallback) : right };
  }
  return { min: 0, max: fallback };
}

function angleStyle(
  decimals: PmiDimension["decimals"] | null,
  tolerance: boolean
): NumberStyle {
  // Degrees are the same in either display unit, so the author's digits
  // always apply.
  const fallback = DEFAULT_DECIMALS.mm;
  if (decimals) {
    const right = Math.max(0, Math.min(decimals.right, 10));
    return { min: right, max: tolerance ? Math.max(right, fallback) : right };
  }
  return { min: 0, max: fallback };
}

const EPSILON = 1e-9;

function signed(value: number, style: NumberStyle, suffix: string): string {
  const magnitude = formatNumber(Math.abs(value), style.min, style.max);
  if (Math.abs(value) < EPSILON || /^0(\.0*)?$/.test(magnitude)) {
    return `${magnitude}${suffix}`;
  }
  return `${value < 0 ? MINUS : "+"}${magnitude}${suffix}`;
}

function fitClassLabel(fit: NonNullable<PmiDimension["fitClass"]>): string {
  const letter = fit.hole
    ? fit.formVariance.toUpperCase()
    : fit.formVariance.toLowerCase();
  const grade = fit.grade.replace(/^IT/i, "");
  return `${letter}${grade}`;
}

function formatDimension(
  item: PmiItem,
  dimension: PmiDimension,
  unit: PmiDisplayUnit,
  sourceUnit: PmiDisplayUnit | null
): PmiItemLabel {
  const title = dimensionTitle(dimension.type);
  if (dimension.type === "commonLabel" || dimension.type === "presentation") {
    return { label: noteLabel(item), symbol: null, title };
  }

  const angular = isAngular(dimension.type);
  const suffix = angular ? "°" : "";
  const convert = (mm: number) =>
    angular || unit === "mm" ? mm : mm / MM_PER_IN;
  const nominalStyle = angular
    ? angleStyle(dimension.decimals, false)
    : lengthStyle(dimension.decimals, unit, sourceUnit, false);
  const toleranceStyle = angular
    ? angleStyle(dimension.decimals, true)
    : lengthStyle(dimension.decimals, unit, sourceUnit, true);
  const prefix = DIMENSION_PREFIXES[dimension.type] ?? "";

  const parts: string[] = [];
  const hasDeviation = dimension.upper !== null || dimension.lower !== null;
  const hasLimits =
    dimension.upperBound !== null && dimension.lowerBound !== null;

  if (hasLimits && !hasDeviation) {
    // A limit dimension prints its two limits instead of a nominal.
    const upper = formatNumber(
      convert(dimension.upperBound as number),
      nominalStyle.min,
      nominalStyle.max
    );
    const lower = formatNumber(
      convert(dimension.lowerBound as number),
      nominalStyle.min,
      nominalStyle.max
    );
    parts.push(`${prefix}${upper}${suffix}/${lower}${suffix}`);
  } else if (dimension.value !== null) {
    parts.push(
      `${prefix}${formatNumber(
        convert(dimension.value),
        nominalStyle.min,
        nominalStyle.max
      )}${suffix}`
    );
  } else {
    parts.push(item.name ?? title);
  }

  if (dimension.fitClass) parts.push(fitClassLabel(dimension.fitClass));

  if (hasDeviation) {
    const upper = convert(dimension.upper ?? 0);
    const lower = convert(dimension.lower ?? 0);
    if (Math.abs(upper + lower) < EPSILON) {
      if (Math.abs(upper) >= EPSILON) {
        parts.push(
          `±${formatNumber(
            Math.abs(upper),
            toleranceStyle.min,
            toleranceStyle.max
          )}${suffix}`
        );
      }
    } else {
      parts.push(
        `${signed(upper, toleranceStyle, suffix)} / ${signed(
          lower,
          toleranceStyle,
          suffix
        )}`
      );
    }
  }

  if (dimension.qualifier === "min") parts.push("MIN");
  if (dimension.qualifier === "max") parts.push("MAX");

  return { label: parts.join(" "), symbol: null, title };
}

const MATERIAL_SYMBOLS = { M: "Ⓜ", L: "Ⓛ" } as const;

function datumModifierSymbol(modifiers: string[]): string {
  if (modifiers.includes("maximumMaterialRequirement")) {
    return ` ${MATERIAL_SYMBOLS.M}`;
  }
  if (modifiers.includes("leastMaterialRequirement")) {
    return ` ${MATERIAL_SYMBOLS.L}`;
  }
  return "";
}

function formatTolerance(
  tolerance: PmiTolerance,
  unit: PmiDisplayUnit
): PmiItemLabel {
  const symbol = TOLERANCE_SYMBOLS[tolerance.type] ?? null;
  const title = TOLERANCE_TITLES[tolerance.type] ?? "Geometric tolerance";
  const cells: string[] = [];
  if (symbol) cells.push(symbol);

  if (tolerance.value !== null) {
    const value = unit === "mm" ? tolerance.value : tolerance.value / MM_PER_IN;
    const zone =
      tolerance.zoneShape === "diameter"
        ? DIAMETER
        : tolerance.zoneShape === "sphericalDiameter"
          ? `S${DIAMETER}`
          : "";
    let cell = `${zone}${formatNumber(value, 0, DEFAULT_DECIMALS[unit])}`;
    if (tolerance.material) cell += ` ${MATERIAL_SYMBOLS[tolerance.material]}`;
    if (tolerance.zoneModifier === "projected") cell += " Ⓟ";
    cells.push(cell);
  }

  for (const datum of tolerance.datums) {
    cells.push(`${datum.name}${datumModifierSymbol(datum.modifiers)}`);
  }

  return {
    label: cells.length > 0 ? cells.join(" | ") : title,
    symbol,
    title
  };
}

/**
 * The text a PMI item shows in the panel and as a 3D label, in the display
 * unit. Lengths are stored mm and convert to inches; angles stay degrees.
 */
export function formatPmiItem(
  item: PmiItem,
  unit: PmiDisplayUnit,
  sourceUnit: PmiDisplayUnit | null
): PmiItemLabel {
  if (item.kind === "dimension" && item.dimension) {
    return formatDimension(item, item.dimension, unit, sourceUnit);
  }
  if (item.kind === "tolerance" && item.tolerance) {
    return formatTolerance(item.tolerance, unit);
  }
  if (item.kind === "datum") {
    const letter = item.datum?.name || item.name || "?";
    return { label: letter, symbol: null, title: `Datum ${letter}` };
  }
  if (item.kind === "dimension") {
    return {
      label: item.name ?? "Dimension",
      symbol: null,
      title: "Dimension"
    };
  }
  if (item.kind === "tolerance") {
    return {
      label: item.name ?? "Geometric tolerance",
      symbol: null,
      title: "Geometric tolerance"
    };
  }
  return { label: noteLabel(item), symbol: null, title: "Note" };
}

/**
 * A graphic-only note's label. CAD exporters name these generically (CATIA's
 * "DGT:Dimension"), which tells the reader nothing and repeats on every row,
 * so a generic name gives way to the note's number.
 */
function noteLabel(item: PmiItem): string {
  const name = item.name?.trim();
  if (name && !/^DGT:/i.test(name) && !/^(note|annotation)$/i.test(name)) {
    return name;
  }
  const number = item.id.replace(/^\D+/, "");
  return number ? `Note ${number}` : "Note";
}

// ---------------------------------------------------------------------------
// Grouping and views
// ---------------------------------------------------------------------------

export type PmiGroupTitle = "Dimensions" | "Tolerances" | "Datums" | "Notes";

export type PmiGroup = {
  kind: PmiKind;
  title: PmiGroupTitle;
  items: PmiItem[];
};

const GROUPS: { kind: PmiKind; title: PmiGroupTitle }[] = [
  { kind: "dimension", title: "Dimensions" },
  { kind: "tolerance", title: "Tolerances" },
  { kind: "datum", title: "Datums" },
  { kind: "note", title: "Notes" }
];

/** Items by kind, in panel order, empty groups left out. */
export function groupPmiItems(doc: PmiDocument): PmiGroup[] {
  return GROUPS.map(({ kind, title }) => ({
    kind,
    title,
    items: doc.items.filter((item) => item.kind === kind)
  })).filter((group) => group.items.length > 0);
}

/**
 * The ids a saved view shows. Every item for no view, an unknown view or a
 * view that lists none (a camera-only view still shows the PMI).
 */
export function visibleItemIds(
  doc: PmiDocument,
  viewId: string | null
): Set<string> {
  const view =
    viewId === null ? undefined : doc.views.find((v) => v.id === viewId);
  if (!view || view.itemIds.length === 0) {
    return new Set(doc.items.map((item) => item.id));
  }
  return new Set(view.itemIds);
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export type PmiBounds = { min: Vec3; max: Vec3 };

class BoundsBuilder {
  min: Vec3 = [Infinity, Infinity, Infinity];
  max: Vec3 = [-Infinity, -Infinity, -Infinity];
  empty = true;

  point(x: number, y: number, z: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return;
    }
    this.empty = false;
    if (x < this.min[0]) this.min[0] = x;
    if (y < this.min[1]) this.min[1] = y;
    if (z < this.min[2]) this.min[2] = z;
    if (x > this.max[0]) this.max[0] = x;
    if (y > this.max[1]) this.max[1] = y;
    if (z > this.max[2]) this.max[2] = z;
  }

  flat(values: number[]) {
    for (let i = 0; i + 2 < values.length; i += 3) {
      // In range by the loop bound; NaN is skipped by `point` anyway.
      this.point(
        values[i] ?? Number.NaN,
        values[i + 1] ?? Number.NaN,
        values[i + 2] ?? Number.NaN
      );
    }
  }

  result(): PmiBounds | null {
    return this.empty ? null : { min: this.min, max: this.max };
  }
}

function addItem(
  builder: BoundsBuilder,
  doc: PmiDocument,
  item: PmiItem,
  includeFaces: boolean
) {
  for (const line of item.lines) builder.flat(line);
  if (item.mesh) builder.flat(item.mesh.positions);
  if (item.textPosition) builder.point(...item.textPosition);
  if (!includeFaces) return;
  for (const index of item.faces) {
    const face = doc.faces[index];
    if (face) builder.flat(face.positions);
  }
  for (const index of item.edges) {
    const edge = doc.edges[index];
    if (edge) builder.flat(edge);
  }
}

/**
 * Axis-aligned box over an item's graphical PMI and text anchor, and with
 * `includeFaces` its referenced faces and edges. Null when it has none.
 */
export function pmiItemBounds(
  doc: PmiDocument,
  item: PmiItem,
  includeFaces: boolean
): PmiBounds | null {
  const builder = new BoundsBuilder();
  addItem(builder, doc, item, includeFaces);
  return builder.result();
}

/** The box over every item a view shows (all items for no or an unknown view). */
export function pmiViewBounds(
  doc: PmiDocument,
  viewId: string | null
): PmiBounds | null {
  const ids = visibleItemIds(doc, viewId);
  const builder = new BoundsBuilder();
  for (const item of doc.items) {
    if (ids.has(item.id)) addItem(builder, doc, item, true);
  }
  return builder.result();
}

// ---------------------------------------------------------------------------
// Inspection characteristics
// ---------------------------------------------------------------------------

/**
 * One inspection characteristic made from a PMI item: the shape the
 * `pmi-inspection-plan` job writes into `inspectionFeature`. Values are text,
 * as the feature columns are; a null nominal is a Pass/Fail characteristic.
 */
export type PmiCharacteristic = {
  /** The PMI item it was made from (`d1`, `t3`). */
  pmiItemId: string;
  /** Characteristic number: `1`, `2`, … in `pmi.json` order. */
  label: string;
  /** What the drawing would print, e.g. `Diameter ⌀10 ±0.05`. */
  description: string;
  nominalValue: string | null;
  tolerancePlus: string | null;
  toleranceMinus: string | null;
  /** `mm` or `in` (the file's own unit), or `deg` for an angle. */
  unit: string;
};

/**
 * The characteristics an inspection plan made from this PMI holds: one per
 * dimension and geometric tolerance. Datums and notes have nothing to
 * measure, and a dimension with no value (a label, a presentation-only
 * dimension) has nothing to compare against — all are left out.
 *
 * Lengths are in the file's own unit (mm when unknown), so an inch drawing
 * inspects in inches. A geometric tolerance is a zone: the reading is the
 * measured deviation, nominal 0 and the zone as its upper limit. A dimension
 * whose only tolerance is a fit class, a min/max qualifier or none at all
 * keeps its nominal off, so the grid records Pass or Fail.
 */
export function pmiInspectionCharacteristics(
  doc: PmiDocument
): PmiCharacteristic[] {
  const lengthUnit: PmiDisplayUnit = doc.sourceUnit ?? "mm";
  const toLength = (mm: number) => (lengthUnit === "mm" ? mm : mm / MM_PER_IN);
  const text = (value: number) => String(round(value));

  const characteristics: PmiCharacteristic[] = [];
  for (const item of doc.items) {
    const spec =
      item.kind === "dimension" && item.dimension
        ? dimensionSpec(item.dimension, toLength, text)
        : item.kind === "tolerance" && item.tolerance
          ? toleranceSpec(item.tolerance, toLength, text)
          : null;
    if (!spec) continue;

    // A tolerance's label already opens with its symbol (`⌖ | 0.75 | A`).
    const { title, label } = formatPmiItem(item, lengthUnit, doc.sourceUnit);
    characteristics.push({
      pmiItemId: item.id,
      label: String(characteristics.length + 1),
      description: label === title ? title : `${title} ${label}`,
      nominalValue: spec.nominal,
      tolerancePlus: spec.plus,
      toleranceMinus: spec.minus,
      unit: spec.angular ? "deg" : lengthUnit
    });
  }
  return characteristics;
}

type CharacteristicSpec = {
  nominal: string | null;
  plus: string | null;
  minus: string | null;
  angular: boolean;
};

function dimensionSpec(
  dimension: PmiDimension,
  toLength: (mm: number) => number,
  text: (value: number) => string
): CharacteristicSpec | null {
  if (dimension.type === "commonLabel" || dimension.type === "presentation") {
    return null;
  }
  const angular = isAngular(dimension.type);
  const convert = (value: number) => (angular ? value : toLength(value));

  if (dimension.upper !== null || dimension.lower !== null) {
    if (dimension.value === null) return null;
    const value = convert(dimension.value);
    const upper = convert(dimension.upper ?? 0);
    const lower = convert(dimension.lower ?? 0);
    // A reading passes inside [nominal − Tol−, nominal + Tol+], both taken
    // as magnitudes. That holds the drawing's limits only while the nominal
    // lies between them; a one-sided fit (⌀10 −0.013/−0.028, a press fit
    // +0.05/+0.02) is re-centred on its band instead.
    if (lower <= 0 && upper >= 0) {
      return {
        nominal: text(value),
        plus: text(upper),
        minus: text(-lower),
        angular
      };
    }
    const half = Math.abs(upper - lower) / 2;
    return {
      nominal: text(value + (upper + lower) / 2),
      plus: text(half),
      minus: text(half),
      angular
    };
  }
  if (dimension.upperBound !== null && dimension.lowerBound !== null) {
    const upper = convert(dimension.upperBound);
    const lower = convert(dimension.lowerBound);
    const half = Math.abs(upper - lower) / 2;
    return {
      nominal: text((upper + lower) / 2),
      plus: text(half),
      minus: text(half),
      angular
    };
  }
  if (dimension.value === null) return null;
  // No numeric limits (a fit class, a min/max qualifier, a basic dimension):
  // nothing to compare a reading against, so it is recorded Pass or Fail.
  return { nominal: null, plus: null, minus: null, angular };
}

function toleranceSpec(
  tolerance: PmiTolerance,
  toLength: (mm: number) => number,
  text: (value: number) => string
): CharacteristicSpec {
  if (tolerance.value === null) {
    return { nominal: null, plus: null, minus: null, angular: false };
  }
  return {
    nominal: "0",
    plus: text(toLength(tolerance.value)),
    minus: "0",
    angular: false
  };
}
