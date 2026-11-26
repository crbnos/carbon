// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getMaterialDescription, getMaterialId } from "@carbon/utils";

// The material properties panel's rules as pure decisions, shared by the
// panel's route, updateMaterial and updateMaterialProperties (MCP). The
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
export function sentFields<T extends object, K extends keyof T & string>(
  source: T,
  fields: readonly K[]
): SentFields<T, K> {
  const sent: SentFields<T, K> = {};
  for (const field of fields) {
    if (field in source) {
      sent[field] = (source[field] ?? null) as SentFields<T, K>[K];
    }
  }
  return sent;
}

/** A sent field that may be undefined arrives as null, which clears it. */
export type SentFields<T, K extends keyof T> = {
  [P in K]?: undefined extends T[P] ? Exclude<T[P], undefined> | null : T[P];
};

/**
 * The item columns a material update copies from its payload. A call that
 * derives the name (generated IDs, a property changed) writes it to every
 * revision instead, so the name is not copied.
 */
export function materialItemUpdateFields(nameDerived: boolean) {
  return [
    ...(nameDerived ? [] : (["name"] as const)),
    "description",
    "mpn",
    "replenishmentSystem",
    "defaultMethodType",
    "itemTrackingType",
    "unitOfMeasureCode"
  ] as const;
}

/**
 * The itemCost columns a material create or update writes: the item group
 * (posting group) and the unit cost it was sent. A create writes a group only
 * when one is named; an update (`clearsEmptyGroup`) also clears it when the
 * key is present but empty, as a cleared form field is.
 */
export function materialCostFields(
  material: { postingGroupId?: string | null; unitCost?: number | null },
  { clearsEmptyGroup }: { clearsEmptyGroup: boolean }
): { itemPostingGroupId?: string | null; unitCost?: number } {
  const writesGroup = clearsEmptyGroup
    ? "postingGroupId" in material
    : !!material.postingGroupId;
  return {
    ...(writesGroup
      ? { itemPostingGroupId: material.postingGroupId || null }
      : {}),
    ...(typeof material.unitCost === "number"
      ? { unitCost: material.unitCost }
      : {})
  };
}

/** sentFields for the property ids, where an empty string clears like null. */
export function sentMaterialProperties(
  source: Partial<Record<MaterialPropertyField, string | null>>
): Partial<MaterialPropertyValues> {
  const sent: Partial<MaterialPropertyValues> = sentFields(
    source,
    materialPropertyFields
  );
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

/**
 * The revisions a new material is created with: one per distinct size, a blank
 * size left out, as an update adds sizes; with no size, the initial revision.
 * A size listed twice would otherwise fail its second insert.
 */
export function newMaterialRevisions(
  sizes: readonly string[] | undefined
): string[] {
  const distinct = [...new Set(sizes ?? [])].filter(Boolean);
  return distinct.length > 0 ? distinct : ["0"];
}

export type NewMaterialIdentity =
  | { readableId: string; name: string }
  | { refusal: "validation" | "rule"; message: string };

/**
 * The ID and name an API caller's new material is created under, as the New
 * Material form decides them. With generated IDs (`generated`) the form has
 * no ID or name field, so a sent one that differs is refused rather than
 * replaced; with typed IDs both are required.
 */
export function newMaterialIdentity(
  generated: { readableId: string; name: string } | null,
  sent: { id?: string; name?: string }
): NewMaterialIdentity {
  if (generated) {
    const otherId = sent.id !== undefined && sent.id !== generated.readableId;
    const otherName = sent.name !== undefined && sent.name !== generated.name;
    if (otherId || otherName) {
      return {
        refusal: "rule",
        message: `Material IDs are generated from the properties: this material is ${generated.readableId}, named ${generated.name}. Leave out id and name, or send these`
      };
    }
    return generated;
  }
  if (!sent.id) {
    return { refusal: "validation", message: "Material ID is required" };
  }
  if (!sent.name) {
    return { refusal: "validation", message: "Short description is required" };
  }
  return { readableId: sent.id, name: sent.name };
}

/**
 * Why an API caller's update of a material with generated IDs is refused, as
 * the properties panel decides it; null when it is not. The panel has no ID
 * field, so a sent ID other than the one the material ends up with is refused.
 * Its name field writes the name, but a call that changes a property derives
 * the name (`generated`), so a sent name that differs is refused there.
 */
export function generatedMaterialUpdateRefusal(
  readableId: string,
  generated: { readableId: string; name: string } | null,
  sent: { readableId?: string | null; name?: string | null }
): string | null {
  const nextId = generated?.readableId ?? readableId;
  const otherId = !!sent.readableId && sent.readableId !== nextId;
  const otherName =
    generated !== null && sent.name != null && sent.name !== generated.name;
  if (!otherId && !otherName) return null;
  return generated
    ? `Material IDs are generated from the properties: this change makes the material ${generated.readableId}, named ${generated.name}. Leave out readableId and name, or send these; change the name in a call that changes no property`
    : `Material IDs are generated from the properties: this material is ${readableId}. Leave out readableId, or send it`;
}
