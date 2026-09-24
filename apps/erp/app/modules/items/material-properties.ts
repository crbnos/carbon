import { getMaterialDescription, getMaterialId } from "@carbon/utils";

// The material properties panel's rules as pure decisions, shared by the
// panel's route, upsertMaterial and updateMaterialProperties (MCP). The
// service loads the rows these read and writes what they decide.

export const materialPropertyFields = [
  "materialSubstanceId",
  "materialFormId",
  "materialTypeId",
  "finishId",
  "gradeId",
  "dimensionId"
] as const;

export type MaterialPropertyField = (typeof materialPropertyFields)[number];
export type MaterialPropertyValues = Record<
  MaterialPropertyField,
  string | null
>;

export const noMaterialProperties: MaterialPropertyValues = {
  materialSubstanceId: null,
  materialFormId: null,
  materialTypeId: null,
  finishId: null,
  gradeId: null,
  dimensionId: null
};

/** The name, code and parent of each property a material points at. */
export type MaterialPropertyLookups = {
  substance: { name: string; code: string } | null;
  form: { name: string; code: string } | null;
  type: {
    name: string;
    code: string;
    materialSubstanceId: string;
    materialFormId: string;
  } | null;
  finish: { name: string; materialSubstanceId: string } | null;
  grade: { name: string; materialSubstanceId: string } | null;
  dimension: { name: string; materialFormId: string } | null;
};

export const generatedIdsNeedSubstanceAndShape =
  "Generated material IDs need a substance and a shape; set both";

/**
 * The `fields` present on `source`. A present key holding undefined (a
 * cleared form field) counts as sent and clears; an absent key (an API caller
 * editing some fields) is left alone.
 */
export function sentFields<K extends string>(
  source: object,
  fields: readonly K[]
): Partial<Record<K, any>> {
  const sent: Partial<Record<K, any>> = {};
  for (const field of fields) {
    if (field in source) {
      sent[field] = (source as Record<string, unknown>)[field] ?? null;
    }
  }
  return sent;
}

/** sentFields for the property ids, where an empty string clears like null. */
export function sentMaterialProperties(
  source: object
): Partial<MaterialPropertyValues> {
  const sent = sentFields(source, materialPropertyFields);
  for (const field of materialPropertyFields) {
    if (sent[field] === "") sent[field] = null;
  }
  return sent;
}

/**
 * Applies `changes` the way the panel's cascading pickers do: a new substance
 * clears finish, grade and type, and a new shape clears dimension and type,
 * unless `changes` sets them too. `changed` holds only the values that differ.
 */
export function resolveMaterialProperties(
  current: MaterialPropertyValues,
  changes: Partial<MaterialPropertyValues>
): {
  next: MaterialPropertyValues;
  changed: Partial<MaterialPropertyValues>;
} {
  const next: MaterialPropertyValues = { ...current, ...changes };

  if (next.materialSubstanceId !== current.materialSubstanceId) {
    for (const field of ["finishId", "gradeId", "materialTypeId"] as const) {
      if (!(field in changes)) next[field] = null;
    }
  }
  if (next.materialFormId !== current.materialFormId) {
    for (const field of ["dimensionId", "materialTypeId"] as const) {
      if (!(field in changes)) next[field] = null;
    }
  }

  const changed: Partial<MaterialPropertyValues> = {};
  for (const field of materialPropertyFields) {
    if (next[field] !== current[field]) changed[field] = next[field];
  }
  return { next, changed };
}

/**
 * With generated material IDs, a substance or shape once set cannot be
 * cleared: the readable id is built from both.
 */
export function clearsSubstanceOrShape(
  current: MaterialPropertyValues,
  next: MaterialPropertyValues
): boolean {
  return (
    (!!current.materialSubstanceId && !next.materialSubstanceId) ||
    (!!current.materialFormId && !next.materialFormId)
  );
}

/**
 * The property panel's pickers as rules: grade and finish come from the
 * substance's list, dimension from the shape's, and type from the pair's.
 * Only checks a value that is new or whose parent changed, so an unrelated
 * edit never trips over an older inconsistency.
 */
export function checkMaterialProperties(
  current: MaterialPropertyValues,
  next: MaterialPropertyValues,
  lookups: MaterialPropertyLookups
): string | null {
  const substanceChanged =
    next.materialSubstanceId !== current.materialSubstanceId;
  const formChanged = next.materialFormId !== current.materialFormId;
  const touched = (field: MaterialPropertyField, parentChanged: boolean) =>
    next[field] !== null && (next[field] !== current[field] || parentChanged);
  const substance = lookups.substance
    ? `substance ${lookups.substance.name} (${next.materialSubstanceId})`
    : "no substance";
  const shape = lookups.form
    ? `shape ${lookups.form.name} (${next.materialFormId})`
    : "no shape";

  if (touched("materialSubstanceId", false) && !lookups.substance) {
    return `Substance ${next.materialSubstanceId} not found`;
  }
  if (touched("materialFormId", false) && !lookups.form) {
    return `Shape ${next.materialFormId} not found`;
  }
  if (touched("gradeId", substanceChanged)) {
    if (!lookups.grade) return `Grade ${next.gradeId} not found`;
    if (lookups.grade.materialSubstanceId !== next.materialSubstanceId) {
      return `Grade ${lookups.grade.name} (${next.gradeId}) is not a grade of ${substance}`;
    }
  }
  if (touched("finishId", substanceChanged)) {
    if (!lookups.finish) return `Finish ${next.finishId} not found`;
    if (lookups.finish.materialSubstanceId !== next.materialSubstanceId) {
      return `Finish ${lookups.finish.name} (${next.finishId}) is not a finish of ${substance}`;
    }
  }
  if (touched("dimensionId", formChanged)) {
    if (!lookups.dimension) return `Dimension ${next.dimensionId} not found`;
    if (lookups.dimension.materialFormId !== next.materialFormId) {
      return `Dimension ${lookups.dimension.name} (${next.dimensionId}) is not a dimension of ${shape}`;
    }
  }
  if (touched("materialTypeId", substanceChanged || formChanged)) {
    if (!lookups.type) return `Type ${next.materialTypeId} not found`;
    if (
      lookups.type.materialSubstanceId !== next.materialSubstanceId ||
      lookups.type.materialFormId !== next.materialFormId
    ) {
      return `Type ${lookups.type.name} (${next.materialTypeId}) is not a type of ${substance} and ${shape}`;
    }
  }
  return null;
}

/**
 * The generated readable id and name, once the material has a substance and a
 * shape; until then it keeps its id, so the panel can set them one at a time.
 */
export function generateMaterialIdentity(
  next: MaterialPropertyValues,
  lookups: MaterialPropertyLookups
): { readableId: string; name: string } | null {
  if (!next.materialSubstanceId || !next.materialFormId) return null;
  const { substance, form, type, finish, grade, dimension } = lookups;
  const naming = {
    substance: substance?.name,
    substanceCode: substance?.code,
    shape: form?.name,
    shapeCode: form?.code,
    materialType: type?.name,
    materialTypeCode: type?.code,
    finish: finish?.name,
    grade: grade?.name,
    dimensions: dimension?.name
  };
  return {
    readableId: getMaterialId(naming),
    name: getMaterialDescription(naming)
  };
}
