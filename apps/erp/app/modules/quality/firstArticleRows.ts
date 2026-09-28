/**
 * Pure AS9102 row derivation for First Article reports: Form 3 (design
 * characteristics) from a lot's plan features and readings, and the Form 1
 * index part types. No I/O — shared by the FAI detail page and the FAIR PDF so
 * the screen and the stored record can never disagree.
 */

export type FirstArticleFeature = {
  id: string;
  label: string;
  description: string | null;
  type: string;
  nominalValue: string | null;
  tolerancePlus: string | null;
  toleranceMinus: string | null;
  unit: string | null;
  designator: string | null;
  referenceLocation: string | null;
  materialCondition: "RFS" | "MMC" | "LMC" | null;
  sizeFeatureId: string | null;
};

export type FirstArticleMeasurement = {
  value: number | null;
  status: string;
  bonus: number | null;
  allowable: number | null;
  notes: string | null;
};

export type FirstArticleCharacteristicStatus = "Pending" | "Passed" | "Failed";

export type Form3Row = {
  featureId: string;
  characteristicNumber: string;
  referenceLocation: string | null;
  designator: string | null;
  requirement: string;
  results: string | null;
  status: FirstArticleCharacteristicStatus;
  /** The lot's NCR number, only on a Failed row. */
  nonconformanceNumber: string | null;
  notes: string | null;
};

export type FirstArticleIndexPartType = "Sub-assembly" | "COTS";

// Mirrors the engine's `parseSpecNumber` (functions/shared/inspection-verdict):
// a spec is numeric when it parses after an optional leading "+".
function parseSpecNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed.replace(/^\+/, ""));
  return Number.isNaN(parsed) ? null : parsed;
}

/** A tolerance as written on the plan, unsigned ("+0.005" → "0.005"). */
function toleranceText(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim().replace(/^[+-]/, "");
  return trimmed === "" ? null : trimmed;
}

function isNumericMeasurement(feature: FirstArticleFeature): boolean {
  return (
    feature.type === "Measurement" &&
    parseSpecNumber(feature.nominalValue) !== null
  );
}

function conditionSymbol(
  condition: FirstArticleFeature["materialCondition"]
): string {
  if (condition === "MMC") return " Ⓜ";
  if (condition === "LMC") return " Ⓛ";
  return "";
}

/**
 * Form 3 field 8. A numeric Measurement reads "nominal ±tol unit" when both
 * tolerances are equal, else "nominal +plus/-minus unit", with Ⓜ/Ⓛ for a
 * geometric tolerance at a material condition. Anything else is described by
 * its text (description, then a non-numeric nominal such as a GD&T callout,
 * then the label).
 */
export function formatRequirement(feature: FirstArticleFeature): string {
  if (!isNumericMeasurement(feature)) {
    return (
      feature.description?.trim() ||
      feature.nominalValue?.trim() ||
      feature.label
    );
  }

  const nominal = (feature.nominalValue ?? "").trim();
  const plus = toleranceText(feature.tolerancePlus);
  const minus = toleranceText(feature.toleranceMinus);
  const unit = feature.unit?.trim() ? ` ${feature.unit.trim()}` : "";

  let tolerance = "";
  if (plus !== null || minus !== null) {
    const plusValue = parseSpecNumber(plus) ?? 0;
    const minusValue = parseSpecNumber(minus) ?? 0;
    tolerance =
      plusValue === minusValue
        ? ` ±${plus ?? minus}`
        : ` +${plus ?? "0"}/-${minus ?? "0"}`;
  }

  return `${nominal}${tolerance}${unit}${conditionSymbol(feature.materialCondition)}`;
}

/**
 * Form 3 field 9. Null while the characteristic has no reading (or a Pending
 * one). A numeric reading prints its value, an attribute reading "Accept" or
 * "Reject". A geometric reading that only passed because of its bonus
 * tolerance says so, and the reading's note is appended.
 */
export function formatResults(
  feature: FirstArticleFeature,
  measurement: FirstArticleMeasurement | null | undefined,
  sizeLabel: string | null
): string | null {
  if (!measurement || measurement.status === "Pending") return null;

  const numeric = isNumericMeasurement(feature) && measurement.value != null;
  let result = numeric
    ? String(measurement.value)
    : measurement.status === "Passed"
      ? "Accept"
      : "Reject";

  const condition = feature.materialCondition;
  if (
    numeric &&
    (condition === "MMC" || condition === "LMC") &&
    measurement.status === "Passed" &&
    (measurement.bonus ?? 0) > 0
  ) {
    const stated =
      (parseSpecNumber(feature.nominalValue) ?? 0) +
      Math.abs(parseSpecNumber(feature.tolerancePlus) ?? 0);
    if ((measurement.value as number) > stated) {
      const size = sizeLabel ? `; size #${sizeLabel}` : "";
      result += ` — Accept with ${condition} (bonus ${measurement.bonus}, allowable ${measurement.allowable ?? ""}${size})`;
    }
  }

  const note = measurement.notes?.trim();
  if (note) result += ` — ${note}`;

  return result;
}

function toStatus(
  status: string | undefined
): FirstArticleCharacteristicStatus {
  return status === "Passed" || status === "Failed" ? status : "Pending";
}

/**
 * One Form 3 row per plan feature, sorted numeric-aware by characteristic
 * number ("2" before "10"). The NCR number is only printed on failed rows.
 */
export function buildForm3Rows(
  features: FirstArticleFeature[],
  measurementByFeatureId: Map<string, FirstArticleMeasurement>,
  ncrNumber: string | null
): Form3Row[] {
  const labelById = new Map(features.map((f) => [f.id, f.label]));

  return features
    .map((feature) => {
      const measurement = measurementByFeatureId.get(feature.id);
      const status = toStatus(measurement?.status);
      const sizeLabel = feature.sizeFeatureId
        ? (labelById.get(feature.sizeFeatureId) ?? null)
        : null;
      return {
        featureId: feature.id,
        characteristicNumber: feature.label,
        referenceLocation: feature.referenceLocation,
        designator: feature.designator,
        requirement: formatRequirement(feature),
        results: formatResults(feature, measurement, sizeLabel),
        status,
        nonconformanceNumber: status === "Failed" ? ncrNumber : null,
        notes: measurement?.notes?.trim() || null
      };
    })
    .sort((a, b) =>
      a.characteristicNumber.localeCompare(b.characteristicNumber, undefined, {
        numeric: true
      })
    );
}

/** Characteristic numbers used by more than one row, sorted numeric-aware. */
export function duplicateNumbers(
  rows: Pick<Form3Row, "characteristicNumber">[]
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(
      row.characteristicNumber,
      (counts.get(row.characteristicNumber) ?? 0) + 1
    );
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([number]) => number)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Form 1 field 17 for a make method's material. Raw materials (and the other
 * non-part item types) are not indexed — materials are reported on Form 2. A
 * made child is a sub-assembly with its own FAI; anything bought is COTS.
 */
export function indexPartType(material: {
  itemType: string | null;
  methodType: string | null;
}): FirstArticleIndexPartType | null {
  if (
    !material.itemType ||
    ["Material", "Consumable", "Service", "Tool"].includes(material.itemType)
  ) {
    return null;
  }
  return material.methodType === "Make to Order" ? "Sub-assembly" : "COTS";
}
