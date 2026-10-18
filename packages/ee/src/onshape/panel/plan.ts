// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { OnshapeElementPart } from "../lib/client";
import type { OnshapeBomNode } from "./bom";
import type {
  ItemMethodType,
  ItemReplenishmentSystem,
  ItemSourcingType,
  ItemTrackingType
} from "./item-values";
import {
  ITEM_METHOD_TYPES,
  ITEM_REPLENISHMENT_SYSTEMS,
  ITEM_SOURCING_TYPES,
  ITEM_TRACKING_TYPES,
  VALID_METHOD_TYPES_BY_REPLENISHMENT
} from "./item-values";
import type { OnshapePushDefaults } from "./preferences";
import type {
  DescriptionModes,
  OnshapePropertyValue,
  PlanCustomField,
  PlanCustomFieldDefinition,
  PlanItemField,
  PropertyMapEntry,
  UnmappedProperty
} from "./properties";
import {
  customFieldDisplayValue,
  customFieldKeptDifferences,
  customFieldWrites,
  DEFAULT_DESCRIPTION_MODES,
  resolveMappedFields
} from "./properties";
import type { PanelRelease, PanelReleaseItem } from "./releases";
import { isModelReleaseItem } from "./releases";
import { compareRevisions } from "./revision";
import type { StandardFieldId } from "./standard-fields";
import { standardField } from "./standard-fields";
import {
  externalIdForAssembly,
  externalIdForBomLine,
  externalIdForPart,
  normalizeConfiguration,
  type ReleasedRevision
} from "./status";

/**
 * Plan builders for panel pushes. APPLY runs the stored plan plus the user's
 * edits without reading Onshape again, so these stay pure.
 */

export type {
  ItemMethodType,
  ItemReplenishmentSystem,
  ItemSourcingType,
  ItemTrackingType
} from "./item-values";
export {
  ITEM_METHOD_TYPES,
  ITEM_REPLENISHMENT_SYSTEMS,
  ITEM_SOURCING_TYPES,
  ITEM_TRACKING_TYPES,
  VALID_METHOD_TYPES_BY_REPLENISHMENT
} from "./item-values";

export const ITEM_NAME_MAX_LENGTH = 255;
export const ITEM_DESCRIPTION_MAX_LENGTH = 2000;

export type PlanUnitOfMeasure = { code: string; name: string };
export type PlanOptions = {
  unitsOfMeasure: PlanUnitOfMeasure[];
  defaults: OnshapePushDefaults;
};

export type ProposedItem = {
  readableId: string;
  /** "0" when Onshape has no revision. */
  revision: string;
  name: string;
  description: string | null;
  replenishmentSystem: ItemReplenishmentSystem;
  defaultMethodType: ItemMethodType;
  itemTrackingType: ItemTrackingType;
  unitOfMeasureCode: string;
  /** Mapped only; apply writes both after the insert (`createdItemExtras`). */
  mpn?: string | null;
  sourcingType?: ItemSourcingType | null;
};

export const EDITABLE_ITEM_FIELDS = [
  "name",
  "description",
  "replenishmentSystem",
  "defaultMethodType",
  "itemTrackingType",
  "unitOfMeasureCode"
] as const;

export type ItemEdit = Partial<
  Pick<ProposedItem, (typeof EDITABLE_ITEM_FIELDS)[number]>
>;

export type PlanMappingRow = {
  entityId: string;
  externalId: string | null;
  lastSyncedAt: string | null;
  metadata?: Record<string, unknown> | null;
};

export type OwnedFieldChange = {
  field: "name" | "description";
  from: string | null;
  to: string | null;
};

export type PlanItemRow = {
  id: string;
  readableId: string;
  revision: string;
  name: string;
  description?: string | null;
  type?: string | null;
  /** False for a revision a change notice has not released. */
  active?: boolean | null;
  replenishmentSystem?: string | null;
  defaultMethodType?: string | null;
  itemTrackingType?: string | null;
  unitOfMeasureCode?: string | null;
  sourcingType?: string | null;
  mpn?: string | null;
};

/** methodMaterial.itemType accepts only these (shared.models methodItemType). */
export const BOM_LINE_ITEM_TYPES = ["Part", "Material", "Consumable"] as const;

export function bomLineItemType(
  item: Pick<PlanItemRow, "type">
): (typeof BOM_LINE_ITEM_TYPES)[number] | null {
  const type = item.type ?? "Part";
  return (BOM_LINE_ITEM_TYPES as readonly string[]).includes(type)
    ? (type as (typeof BOM_LINE_ITEM_TYPES)[number])
    : null;
}

/** Latest revision, active rows first, whatever order the rows came in. */
export function pickLatestRow<
  T extends { revision: string | null; active?: boolean | null }
>(rows: T[]): T | undefined {
  const active = rows.filter((row) => row.active !== false);
  let latest: T | undefined;
  for (const row of active.length > 0 ? active : rows) {
    if (!latest || compareRevisions(row.revision, latest.revision) > 0) {
      latest = row;
    }
  }
  return latest;
}

/**
 * The newest revision below the released one, active or not: Rev B builds on
 * a Rev A still in its change notice. With none below, the latest row.
 */
export function pickRevisionBase<
  T extends { revision: string | null; active?: boolean | null }
>(rows: T[], revision: string): T | undefined {
  let base: T | undefined;
  for (const row of rows) {
    if (compareRevisions(row.revision, revision) >= 0) continue;
    if (!base || compareRevisions(row.revision, base.revision) > 0) {
      base = row;
    }
  }
  return base ?? pickLatestRow(rows);
}

/**
 * The revision the released BOM names when Carbon has it, else the latest row
 * with the named revision in `missingRevision`.
 */
export function pickBomChildRow<
  T extends {
    revision: string | null;
    active?: boolean | null;
    type?: string | null;
  }
>(
  rows: T[],
  revision: string | null | undefined
): { row: T | undefined; missingRevision: string | null } {
  const named = revision?.trim() || null;
  if (named) {
    const match = pickReuseRow(
      rows.filter((row) => compareRevisions(row.revision, named) === 0)
    );
    if (match) return { row: match, missingRevision: null };
  }
  const row = pickLatestRow(rows);
  return { row, missingRevision: named && row ? named : null };
}

/**
 * Pairs each Onshape line with a pushed line of its part number, else a manual
 * line of the same item type, in order. Unpaired manual lines are kept.
 */
export function pairManualLines(
  writes: Array<{ partNumber: string; quantity: number; itemType?: string }>,
  owned: PlanLine[],
  manual: PlanLine[]
): {
  takesOver: Array<PlanLine & { onshapeQuantity: number }>;
  keeps: PlanLine[];
} {
  const ownedLeft = new Map<string, number>();
  for (const line of owned) {
    ownedLeft.set(line.readableId, (ownedLeft.get(line.readableId) ?? 0) + 1);
  }
  const manualLeft = [...manual];
  const takesOver: Array<PlanLine & { onshapeQuantity: number }> = [];
  for (const write of writes) {
    const owns = ownedLeft.get(write.partNumber) ?? 0;
    if (owns > 0) {
      ownedLeft.set(write.partNumber, owns - 1);
      continue;
    }
    // Item numbers are unique per type; a Material's line is not a Part's.
    const index = manualLeft.findIndex(
      (line) =>
        line.readableId === write.partNumber &&
        (!write.itemType || !line.itemType || line.itemType === write.itemType)
    );
    if (index === -1) continue;
    const [line] = manualLeft.splice(index, 1);
    if (line) takesOver.push({ ...line, onshapeQuantity: write.quantity });
  }
  return { takesOver, keeps: manualLeft };
}

/** The latest Part, else the latest row that can be a BOM line, else any. */
export function pickReuseRow<
  T extends {
    revision: string | null;
    active?: boolean | null;
    type?: string | null;
  }
>(rows: T[]): T | undefined {
  const parts = rows.filter((row) => (row.type ?? "Part") === "Part");
  if (parts.length > 0) return pickLatestRow(parts);
  const usable = rows.filter((row) => bomLineItemType(row) !== null);
  return pickLatestRow(usable.length > 0 ? usable : rows);
}

/** A Part at the same revision, else the latest Part; never another type. */
export function pickAdoptTarget(
  rows: PlanItemRow[],
  revision: string | null
): PlanItemRow | undefined {
  const parts = rows.filter((row) => (row.type ?? "Part") === "Part");
  const wanted = (revision ?? "").trim() || "0";
  return parts.find((row) => row.revision === wanted) ?? pickLatestRow(parts);
}

export type PlanMethodRow = {
  id: string;
  status: string;
  /** Set when a change notice holds this method (a Draft it staged). */
  changeOrderId?: string | null;
};

export type PlanLine = {
  readableId: string;
  quantity: number;
  /** Manual lines only: a takeover must match it. */
  itemType?: string | null;
};

/** Configured unit, else "EA", else the first; only codes the company has. */
export function defaultUnitOfMeasureCode(options: PlanOptions): string {
  const codes = options.unitsOfMeasure.map((u) => u.code);
  const configured = options.defaults.unitOfMeasureCode;
  if (configured && codes.includes(configured)) return configured;
  if (codes.includes("EA")) return "EA";
  return codes[0] ?? "EA";
}

export type ProposalInput = {
  partNumber: string;
  name: string | null;
  description?: string | null;
  revision?: string | null;
  hasChildren?: boolean;
  standardContent?: boolean;
  mapped?: MappedItemValues;
};

export function proposeItem(
  input: ProposalInput,
  options: PlanOptions
): ProposedItem {
  return proposeMappedItem(input, options).proposed;
}

/**
 * Per field, the first rule with a value wins: the mapped value, a BOM row with
 * children is Make, a Standard content row is Buy, the push defaults. The
 * reviewer's choice overrides all; also returns mapped values it cannot use.
 */
export function proposeMappedItem(
  input: ProposalInput,
  options: PlanOptions
): { proposed: ProposedItem; problems: string[] } {
  const name = (input.name ?? "").trim();
  const description = (input.description ?? "").trim();
  const defaults = options.defaults;
  const defaultMethodFor = (
    replenishment: ItemReplenishmentSystem
  ): ItemMethodType =>
    replenishment === "Make"
      ? VALID_METHOD_TYPES_BY_REPLENISHMENT.Make.includes(
          defaults.methodTypeForMake
        )
        ? defaults.methodTypeForMake
        : "Make to Order"
      : reconcileMethodForReplenishment(
          replenishment,
          defaults.methodTypeForBuy
        );
  const start: ItemFieldSnapshot = input.hasChildren
    ? { ...pushDefaultFields(options), replenishmentSystem: "Make" }
    : input.standardContent
      ? { ...pushDefaultFields(options), replenishmentSystem: "Buy" }
      : pushDefaultFields(options);
  if (input.hasChildren || input.standardContent) {
    start.defaultMethodType = defaultMethodFor(start.replenishmentSystem);
  }
  const { values, problems } = interlockItemFields(
    start,
    input.mapped ?? {},
    defaultMethodFor
  );
  return {
    proposed: {
      readableId: input.partNumber,
      revision: (input.revision ?? "").trim() || "0",
      name: name === "" ? input.partNumber : name,
      description: description === "" ? null : description,
      replenishmentSystem: values.replenishmentSystem,
      defaultMethodType: values.defaultMethodType,
      itemTrackingType: values.itemTrackingType,
      unitOfMeasureCode:
        values.unitOfMeasureCode ?? defaultUnitOfMeasureCode(options),
      ...(values.mpn ? { mpn: values.mpn } : {}),
      ...(values.sourcingType ? { sourcingType: values.sourcingType } : {})
    },
    problems
  };
}

function proposedHolds(proposed: ProposedItem, field: PlanItemField): boolean {
  return (proposed as Record<string, unknown>)[field.field] === field.value;
}

function pushDefaultFields(options: PlanOptions): ItemFieldSnapshot {
  return {
    replenishmentSystem: options.defaults.replenishmentSystem,
    defaultMethodType: options.defaults.methodTypeForMake,
    itemTrackingType: options.defaults.itemTrackingType,
    unitOfMeasureCode: defaultUnitOfMeasureCode(options)
  };
}

export type MergeResult =
  | { ok: true; item: ProposedItem }
  | { ok: false; errors: string[] };

/** Refuses what the Part form would; ignores unknown keys and locked fields. */
export function mergeItemEdits(
  proposed: ProposedItem,
  edit: ItemEdit | null | undefined,
  options: PlanOptions
): MergeResult {
  const errors: string[] = [];
  const item: ProposedItem = { ...proposed };
  if (!edit) return { ok: true, item };

  if (edit.name !== undefined) {
    const name = typeof edit.name === "string" ? edit.name.trim() : "";
    if (name === "") errors.push("Name is required");
    else if (name.length > ITEM_NAME_MAX_LENGTH)
      errors.push(`Name is longer than ${ITEM_NAME_MAX_LENGTH} characters`);
    else item.name = name;
  }

  if (edit.description !== undefined) {
    const description =
      typeof edit.description === "string" ? edit.description.trim() : "";
    if (description.length > ITEM_DESCRIPTION_MAX_LENGTH)
      errors.push(
        `Description is longer than ${ITEM_DESCRIPTION_MAX_LENGTH} characters`
      );
    else item.description = description === "" ? null : description;
  }

  if (edit.replenishmentSystem !== undefined) {
    if (
      (ITEM_REPLENISHMENT_SYSTEMS as readonly string[]).includes(
        edit.replenishmentSystem as string
      )
    ) {
      item.replenishmentSystem = edit.replenishmentSystem;
    } else {
      errors.push("Replenishment system is not valid");
    }
  }

  if (edit.defaultMethodType !== undefined) {
    if (
      (ITEM_METHOD_TYPES as readonly string[]).includes(
        edit.defaultMethodType as string
      )
    ) {
      item.defaultMethodType = edit.defaultMethodType;
    } else {
      errors.push("Default method type is not valid");
    }
  }

  if (edit.itemTrackingType !== undefined) {
    if (
      (ITEM_TRACKING_TYPES as readonly string[]).includes(
        edit.itemTrackingType as string
      )
    ) {
      item.itemTrackingType = edit.itemTrackingType;
    } else {
      errors.push("Tracking type is not valid");
    }
  }

  if (edit.unitOfMeasureCode !== undefined) {
    const code =
      typeof edit.unitOfMeasureCode === "string"
        ? edit.unitOfMeasureCode.trim()
        : "";
    if (options.unitsOfMeasure.some((u) => u.code === code)) {
      item.unitOfMeasureCode = code;
    } else {
      errors.push("Unit of measure is not one of the company's units");
    }
  }

  // Checked on the merged pair, so an edit to one side still meets the rule.
  if (
    !VALID_METHOD_TYPES_BY_REPLENISHMENT[item.replenishmentSystem].includes(
      item.defaultMethodType
    )
  ) {
    errors.push(
      `${item.defaultMethodType} is not a valid method for ${item.replenishmentSystem} items`
    );
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, item };
}

/** A field the plan did not read is absent, and a push never writes it. */
export type ItemFieldSnapshot = {
  replenishmentSystem: ItemReplenishmentSystem;
  defaultMethodType: ItemMethodType;
  itemTrackingType: ItemTrackingType;
  sourcingType?: ItemSourcingType;
  unitOfMeasureCode?: string;
  mpn?: string | null;
};

const SNAPSHOT_FIELDS = [
  "replenishmentSystem",
  "defaultMethodType",
  "sourcingType",
  "itemTrackingType",
  "unitOfMeasureCode",
  "mpn"
] as const satisfies readonly StandardFieldId[];

export type ItemFieldChange = {
  field: StandardFieldId;
  label: string;
  from: string | null;
  to: string | null;
  /** Null when Carbon derived it: the method a Replenishment or Sourcing sets. */
  onshapeName: string | null;
};

/** An Onshape value the push does not write to an existing item. */
export type KeptDifference = {
  label: string;
  onshape: string;
  carbon: string | null;
};

export type MappedRowPlan = {
  customFields?: PlanCustomField[];
  itemFields?: PlanItemField[];
  /** Existing items only, as are `target` and `keptDifferences`. */
  itemFieldChanges?: ItemFieldChange[];
  /** After the mapped writes, before the reviewer's edits; absent if unchanged. */
  target?: ItemFieldSnapshot;
  keptDifferences?: KeptDifference[];
  /** Shown in the review, never written. */
  mappedFieldProblems?: string[];
  unmappedProperties?: UnmappedProperty[];
};

export type PlanMappingContext = {
  map: PropertyMapEntry[];
  definitions: PlanCustomFieldDefinition[];
  descriptionModes: DescriptionModes;
  /** `part.customFields` per part number. */
  heldCustomFields: ReadonlyMap<string, unknown>;
};

function coerceEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function isOneOf<T extends string>(
  value: string,
  allowed: readonly T[]
): value is T {
  return (allowed as readonly string[]).includes(value);
}

/** The Part form's rule: keep the method when allowed, else the first allowed. */
export function reconcileMethodForReplenishment(
  replenishment: ItemReplenishmentSystem,
  method: ItemMethodType
): ItemMethodType {
  const allowed = VALID_METHOD_TYPES_BY_REPLENISHMENT[replenishment];
  return allowed.includes(method) ? method : (allowed[0] ?? method);
}

/**
 * Item page rule (`deriveItemMethodUpdate`): Make pins Make to Order, Buy pins
 * Purchase to Order. Buy and Make keeps the method only when the pair allows
 * it; the item page would keep Make to Order too, which apply refuses
 * (`mergeExistingItemEdits`), so that one takes the Part form's rule.
 */
export function methodForReplenishment(
  replenishment: ItemReplenishmentSystem,
  method: ItemMethodType
): ItemMethodType {
  if (replenishment === "Make") return "Make to Order";
  if (replenishment === "Buy") return "Purchase to Order";
  return reconcileMethodForReplenishment(replenishment, method);
}

/** The method a Sourcing sets (`deriveItemMethodUpdate`); Specified leaves it. */
function methodForSourcing(
  sourcing: ItemSourcingType,
  method: ItemMethodType
): ItemMethodType {
  if (sourcing === "Drop Ship") return "Purchase to Order";
  if (sourcing === "Ship from Inventory") return "Pull from Inventory";
  return method;
}

/** Coerced to legal values so the review always seeds a valid choice. */
export function currentItemFields(row: {
  replenishmentSystem?: string | null;
  defaultMethodType?: string | null;
  itemTrackingType?: string | null;
  sourcingType?: string | null;
  unitOfMeasureCode?: string | null;
  mpn?: string | null;
}): ItemFieldSnapshot {
  const replenishmentSystem = coerceEnum(
    row.replenishmentSystem,
    ITEM_REPLENISHMENT_SYSTEMS,
    "Buy"
  );
  return {
    replenishmentSystem,
    defaultMethodType: reconcileMethodForReplenishment(
      replenishmentSystem,
      coerceEnum(
        row.defaultMethodType,
        ITEM_METHOD_TYPES,
        "Pull from Inventory"
      )
    ),
    itemTrackingType: coerceEnum(
      row.itemTrackingType,
      ITEM_TRACKING_TYPES,
      "Inventory"
    ),
    ...(row.sourcingType !== undefined
      ? {
          sourcingType: coerceEnum(
            row.sourcingType,
            ITEM_SOURCING_TYPES,
            "Specified"
          )
        }
      : {}),
    ...(typeof row.unitOfMeasureCode === "string"
      ? { unitOfMeasureCode: row.unitOfMeasureCode }
      : {}),
    ...(row.mpn !== undefined ? { mpn: row.mpn } : {})
  };
}

export type MappedItemValues = {
  mpn?: string;
  replenishmentSystem?: ItemReplenishmentSystem;
  defaultMethodType?: ItemMethodType;
  sourcingType?: ItemSourcingType;
  itemTrackingType?: ItemTrackingType;
  unitOfMeasureCode?: string;
};

/** A unit the company lacks is a problem: a translation can outlive its unit. */
export function mappedItemValues(
  itemFields: readonly PlanItemField[],
  units: readonly PlanUnitOfMeasure[]
): { values: MappedItemValues; problems: string[] } {
  const values: MappedItemValues = {};
  const problems: string[] = [];
  for (const { field, value, label } of itemFields) {
    if (value === null) continue;
    switch (field) {
      case "mpn":
        values.mpn = value;
        break;
      case "replenishmentSystem":
        if (isOneOf(value, ITEM_REPLENISHMENT_SYSTEMS)) {
          values.replenishmentSystem = value;
        }
        break;
      case "defaultMethodType":
        if (isOneOf(value, ITEM_METHOD_TYPES)) values.defaultMethodType = value;
        break;
      case "sourcingType":
        if (isOneOf(value, ITEM_SOURCING_TYPES)) values.sourcingType = value;
        break;
      case "itemTrackingType":
        if (isOneOf(value, ITEM_TRACKING_TYPES))
          values.itemTrackingType = value;
        break;
      case "unitOfMeasureCode":
        if (units.some((unit) => unit.code === value)) {
          values.unitOfMeasureCode = value;
        } else {
          problems.push(
            `${label}: Carbon has no unit "${value}". ${label} not written.`
          );
        }
        break;
    }
  }
  return { values, problems };
}

/**
 * Lays mapped values over an item's fields in the item page's order:
 * Replenishment with `methodFor`'s method, the method if allowed, Sourcing
 * (Buy and Make only) with its method, then tracking, unit and MPN.
 */
export function interlockItemFields(
  start: ItemFieldSnapshot,
  mapped: MappedItemValues,
  methodFor: (
    replenishment: ItemReplenishmentSystem,
    method: ItemMethodType
  ) => ItemMethodType
): { values: ItemFieldSnapshot; problems: string[] } {
  const values: ItemFieldSnapshot = { ...start };
  const problems: string[] = [];
  if (
    mapped.replenishmentSystem &&
    mapped.replenishmentSystem !== values.replenishmentSystem
  ) {
    values.replenishmentSystem = mapped.replenishmentSystem;
    values.defaultMethodType = methodFor(
      mapped.replenishmentSystem,
      values.defaultMethodType
    );
  }
  if (mapped.defaultMethodType) {
    if (
      VALID_METHOD_TYPES_BY_REPLENISHMENT[values.replenishmentSystem].includes(
        mapped.defaultMethodType
      )
    ) {
      values.defaultMethodType = mapped.defaultMethodType;
    } else {
      problems.push(
        `Default Method Type: ${mapped.defaultMethodType} is not a method for ${values.replenishmentSystem} items. Not written.`
      );
    }
  }
  if (mapped.sourcingType) {
    if (values.replenishmentSystem === "Buy and Make") {
      values.sourcingType = mapped.sourcingType;
      values.defaultMethodType = methodForSourcing(
        mapped.sourcingType,
        values.defaultMethodType
      );
    } else {
      problems.push(
        "Sourcing applies only to Buy and Make items. Not written."
      );
    }
  }
  if (mapped.itemTrackingType)
    values.itemTrackingType = mapped.itemTrackingType;
  if (mapped.unitOfMeasureCode) {
    values.unitOfMeasureCode = mapped.unitOfMeasureCode;
  }
  if (mapped.mpn) values.mpn = mapped.mpn;
  return { values, problems };
}

function fieldLabel(field: StandardFieldId): string {
  return standardField(field)?.label ?? field;
}

export function changedItemFields(
  current: ItemFieldSnapshot,
  next: ItemFieldSnapshot
): Partial<ItemFieldSnapshot> {
  const changed: Partial<ItemFieldSnapshot> = {};
  for (const field of SNAPSHOT_FIELDS) {
    const value = next[field];
    if (value === undefined) continue;
    if ((current[field] ?? null) !== (value ?? null)) {
      (changed as Record<string, unknown>)[field] = value;
    }
  }
  return changed;
}

const DESCRIPTION_LABELS = {
  name: "Short Description",
  description: "Long Description"
} as const;

/**
 * What a push does to an item it links or that is linked to its source:
 * "everyPush" values are written (an empty custom field value clears Carbon's)
 * and "create" values become kept differences.
 */
export function planExistingItem({
  current,
  item,
  onshape,
  resolved,
  heldCustomFields,
  descriptionModes,
  units
}: {
  current: ItemFieldSnapshot;
  item: {
    name?: string | null;
    description?: string | null;
    /** The stored method, which `current` may have reconciled. */
    defaultMethodType?: string | null;
  };
  onshape: { name: string | null; description: string | null };
  resolved: {
    fields: PlanCustomField[];
    itemFields: PlanItemField[];
    problems: string[];
  } | null;
  heldCustomFields: unknown;
  descriptionModes: DescriptionModes;
  units: readonly PlanUnitOfMeasure[];
}): MappedRowPlan & { changes: OwnedFieldChange[] } {
  const changes: OwnedFieldChange[] = [];
  const kept: KeptDifference[] = [];
  for (const change of assemblyTextChanges(
    { name: item.name ?? "", description: item.description ?? null },
    onshape
  )) {
    if (descriptionModes[change.field] === "everyPush") {
      changes.push(change);
    } else if (change.to !== null) {
      kept.push({
        label: DESCRIPTION_LABELS[change.field],
        onshape: change.to,
        carbon: change.from
      });
    }
  }

  const out: MappedRowPlan & { changes: OwnedFieldChange[] } = { changes };
  if (resolved) {
    const everyPush = resolved.itemFields.filter(
      (field) => field.mode === "everyPush"
    );
    const mapped = mappedItemValues(everyPush, units);
    const interlocked = interlockItemFields(
      current,
      mapped.values,
      methodForReplenishment
    );
    const sourceByField = new Map(
      everyPush
        .filter((field) => field.value !== null)
        .map((field) => [field.field, field.onshapeName])
    );
    const itemFieldChanges: ItemFieldChange[] = Object.entries(
      changedItemFields(current, interlocked.values)
    )
      .map(([field, to]) => {
        const id = field as StandardFieldId;
        return {
          field: id,
          label: fieldLabel(id),
          from:
            (id === "defaultMethodType" ? item.defaultMethodType : null) ??
            (current[field as keyof ItemFieldSnapshot] as string | null) ??
            null,
          to: (to as string | null) ?? null,
          // Credited to a mapping only when the value is the mapped one.
          onshapeName:
            mapped.values[id] === to ? (sourceByField.get(id) ?? null) : null
        };
      })
      // Derived changes list after the mapped ones.
      .sort(
        (a, b) =>
          Number(a.onshapeName === null) - Number(b.onshapeName === null)
      );
    if (itemFieldChanges.length > 0) {
      out.itemFieldChanges = itemFieldChanges;
      out.target = interlocked.values;
    }

    for (const field of resolved.itemFields) {
      if (field.mode !== "create" || field.value === null) continue;
      if (!(SNAPSHOT_FIELDS as readonly string[]).includes(field.field)) {
        continue;
      }
      const carbon =
        (interlocked.values[field.field as keyof ItemFieldSnapshot] as
          | string
          | null
          | undefined) ?? null;
      if (carbon !== field.value) {
        kept.push({ label: field.label, onshape: field.value, carbon });
      }
    }

    const definitions = new Map(
      resolved.fields.map((field) => [field.fieldId, field])
    );
    const held = (
      typeof heldCustomFields === "object" && heldCustomFields !== null
        ? heldCustomFields
        : {}
    ) as Record<string, unknown>;
    const heldText = (field: PlanCustomField) => {
      const heldValue = held[field.fieldId];
      return heldValue === undefined || heldValue === null || heldValue === ""
        ? null
        : customFieldDisplayValue({
            value: heldValue as string | number | boolean,
            dataTypeId:
              definitions.get(field.fieldId)?.dataTypeId ?? field.dataTypeId
          });
    };
    for (const field of customFieldKeptDifferences(
      heldCustomFields,
      resolved.fields
    )) {
      kept.push({
        label: field.name,
        onshape: customFieldDisplayValue(field),
        carbon: heldText(field)
      });
    }
    const customFields = customFieldWrites(
      heldCustomFields,
      resolved.fields
    ).map((field) => ({ ...field, replaces: heldText(field) }));
    if (customFields.length > 0) out.customFields = customFields;

    const itemFields = resolved.itemFields.filter(
      (field) => field.value !== null
    );
    if (itemFields.length > 0) out.itemFields = itemFields;
    const problems = [
      ...resolved.problems,
      ...mapped.problems,
      ...interlocked.problems
    ];
    if (problems.length > 0) out.mappedFieldProblems = problems;
  }
  if (kept.length > 0) out.keptDifferences = kept;
  return out;
}

export function planCreatedItem(
  input: Omit<ProposalInput, "mapped">,
  resolved: {
    fields: PlanCustomField[];
    itemFields: PlanItemField[];
    problems: string[];
  } | null,
  options: PlanOptions
): MappedRowPlan & { proposed: ProposedItem } {
  if (!resolved) return { proposed: proposeItem(input, options) };
  const mapped = mappedItemValues(resolved.itemFields, options.unitsOfMeasure);
  const { proposed, problems } = proposeMappedItem(
    { ...input, mapped: mapped.values },
    options
  );
  const out: MappedRowPlan & { proposed: ProposedItem } = { proposed };
  const customFields = resolved.fields.filter((field) => field.value !== null);
  if (customFields.length > 0) out.customFields = customFields;
  // A mapped value the interlock skipped is a problem, not a value.
  const itemFields = resolved.itemFields.filter(
    (field) => field.value !== null && proposedHolds(proposed, field)
  );
  if (itemFields.length > 0) out.itemFields = itemFields;
  const allProblems = [...resolved.problems, ...mapped.problems, ...problems];
  if (allProblems.length > 0) out.mappedFieldProblems = allProblems;
  return out;
}

/**
 * Fields `upsertPart` does not take, written after the insert: MPN, and
 * Sourcing while the item is still Buy and Make after the reviewer's edits.
 */
export function createdItemExtras(
  item: ProposedItem
): Pick<ItemFieldSnapshot, "mpn" | "sourcingType"> {
  return {
    ...(item.mpn ? { mpn: item.mpn } : {}),
    ...(item.sourcingType && item.replenishmentSystem === "Buy and Make"
      ? { sourcingType: item.sourcingType }
      : {})
  };
}

/**
 * `changed` diffs against `current`, so a push that changes nothing writes
 * nothing and stamps no audit fields.
 */
export function mergeExistingItemEdits(
  current: ItemFieldSnapshot,
  edit: ItemEdit | null | undefined,
  base: ItemFieldSnapshot = current
):
  | { ok: true; values: ItemFieldSnapshot; changed: Partial<ItemFieldSnapshot> }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const values: ItemFieldSnapshot = { ...base };
  if (edit?.replenishmentSystem !== undefined) {
    if (
      (ITEM_REPLENISHMENT_SYSTEMS as readonly string[]).includes(
        edit.replenishmentSystem
      )
    ) {
      values.replenishmentSystem =
        edit.replenishmentSystem as ItemReplenishmentSystem;
    } else {
      errors.push("Replenishment system is not valid");
    }
  }
  if (edit?.defaultMethodType !== undefined) {
    if (
      (ITEM_METHOD_TYPES as readonly string[]).includes(edit.defaultMethodType)
    ) {
      values.defaultMethodType = edit.defaultMethodType as ItemMethodType;
    } else {
      errors.push("Default method type is not valid");
    }
  }
  if (edit?.itemTrackingType !== undefined) {
    if (
      (ITEM_TRACKING_TYPES as readonly string[]).includes(edit.itemTrackingType)
    ) {
      values.itemTrackingType = edit.itemTrackingType as ItemTrackingType;
    } else {
      errors.push("Tracking type is not valid");
    }
  }
  if (
    !VALID_METHOD_TYPES_BY_REPLENISHMENT[values.replenishmentSystem].includes(
      values.defaultMethodType
    )
  ) {
    errors.push(
      `${values.defaultMethodType} is not a valid method for ${values.replenishmentSystem} items`
    );
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, values, changed: changedItemFields(current, values) };
}

export type PartPlanAction =
  | "create"
  | "adopt"
  | "update"
  | "unchanged"
  | "skip-no-part-number"
  /** A release made a revision of this part number; the push writes nothing. */
  | "released";

export type PartPlanRow = MappedRowPlan & {
  partId: string;
  partNumber: string | null;
  name: string;
  description: string | null;
  revision: string | null;
  microversionId: string | null;
  action: PartPlanAction;
  itemId: string | null;
  item: { readableId: string; revision: string; name: string } | null;
  /** Create only. */
  proposed: ProposedItem | null;
  /** adopt/update/unchanged only: seeds the review's selects. */
  current?: ItemFieldSnapshot | null;
  /** Descriptions in "everyPush" mode that the push overwrites. */
  changes: OwnedFieldChange[];
  /** An update only for mapped values or descriptions; skips the model export. */
  cadUnchanged?: true;
};

export type PartPlan = {
  kind: "part";
  documentId: string;
  wv: "w" | "v";
  wvId: string;
  elementId: string;
  /** Null for the default; part of every mapping key apply writes. */
  configuration?: string | null;
  rows: PartPlanRow[];
  options: PlanOptions;
};

export function buildPartPlan({
  documentId,
  elementId,
  configuration = null,
  parts,
  requestedPartIds,
  mappings,
  items,
  options,
  mapping,
  propertiesByPartId,
  released = new Map()
}: {
  documentId: string;
  elementId: string;
  configuration?: string | null;
  parts: OnshapeElementPart[];
  requestedPartIds: string[];
  mappings: PlanMappingRow[];
  items: PlanItemRow[];
  options: PlanOptions;
  /** `releasedRevisionsByPartNumber` over `items`. */
  released?: ReadonlyMap<string, ReleasedRevision>;
  /** Absent: only descriptions are planned. */
  mapping?: PlanMappingContext;
  propertiesByPartId?: ReadonlyMap<string, OnshapePropertyValue[]>;
}): PartPlanRow[] {
  const mappingByExternalId = new Map(
    mappings.filter((m) => m.externalId).map((m) => [m.externalId as string, m])
  );
  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemsByReadableId = new Map<string, PlanItemRow[]>();
  for (const item of items) {
    const list = itemsByReadableId.get(item.readableId) ?? [];
    list.push(item);
    itemsByReadableId.set(item.readableId, list);
  }
  const descriptionModes =
    mapping?.descriptionModes ?? DEFAULT_DESCRIPTION_MODES;
  const resolve = (partId: string) =>
    mapping && mapping.map.length > 0
      ? resolveMappedFields({
          properties: propertiesByPartId?.get(partId) ?? [],
          map: mapping.map,
          definitions: mapping.definitions,
          units: options.unitsOfMeasure
        })
      : null;
  const existingPlan = (item: PlanItemRow, part: OnshapeElementPart) => {
    const resolved = resolve(part.partId);
    const planned = planExistingItem({
      current: currentItemFields(item),
      item,
      onshape: { name: part.name, description: part.description ?? null },
      resolved,
      heldCustomFields: mapping?.heldCustomFields.get(item.readableId),
      descriptionModes,
      units: options.unitsOfMeasure
    });
    return {
      ...planned,
      ...nonEmpty("unmappedProperties", resolved?.unmapped ?? [])
    };
  };

  const rows: PartPlanRow[] = [];
  for (const partId of requestedPartIds) {
    const part = parts.find((p) => p.partId === partId);
    if (!part) continue; // not in this element: the route reports it

    const base = {
      partId,
      partNumber: part.partNumber ?? null,
      name: part.name,
      description: part.description ?? null,
      revision: part.revision ?? null,
      microversionId: part.microversionId ?? null,
      itemId: null as string | null,
      item: null as PartPlanRow["item"],
      proposed: null as ProposedItem | null,
      changes: [] as PartPlanRow["changes"]
    };

    const releasedRevision = part.partNumber
      ? released.get(part.partNumber)
      : undefined;
    const releasedItem = releasedRevision
      ? itemById.get(releasedRevision.itemId)
      : undefined;
    if (releasedItem) {
      rows.push({
        ...base,
        action: "released",
        itemId: releasedItem.id,
        item: {
          readableId: releasedItem.readableId,
          revision: releasedItem.revision,
          name: releasedItem.name
        }
      });
      continue;
    }

    const mapped = mappingByExternalId.get(
      externalIdForPart(documentId, elementId, partId, configuration)
    );
    // A mapping whose item is gone is not a link (entityId has no FK).
    const linked = mapped ? itemById.get(mapped.entityId) : undefined;
    if (mapped && linked) {
      const lastMicroversion = mapped.metadata?.microversionId;
      const unchanged =
        !!part.microversionId &&
        typeof lastMicroversion === "string" &&
        part.microversionId === lastMicroversion;
      const planned = existingPlan(linked, part);
      const writes =
        planned.changes.length > 0 ||
        (planned.itemFieldChanges?.length ?? 0) > 0 ||
        (planned.customFields?.length ?? 0) > 0;
      rows.push({
        ...base,
        ...planned,
        action: unchanged && !writes ? "unchanged" : "update",
        ...(unchanged && writes ? { cadUnchanged: true as const } : {}),
        itemId: linked.id,
        item: {
          readableId: linked.readableId,
          revision: linked.revision,
          name: linked.name
        },
        current: currentItemFields(linked)
      });
      continue;
    }

    if (!part.partNumber) {
      rows.push({ ...base, action: "skip-no-part-number" });
      continue;
    }

    const matched = pickAdoptTarget(
      itemsByReadableId.get(part.partNumber) ?? [],
      part.revision ?? null
    );
    if (matched) {
      rows.push({
        ...base,
        ...existingPlan(matched, part),
        action: "adopt",
        itemId: matched.id,
        item: {
          readableId: matched.readableId,
          revision: matched.revision,
          name: matched.name
        },
        current: currentItemFields(matched)
      });
      continue;
    }

    const resolved = resolve(partId);
    rows.push({
      ...base,
      ...planCreatedItem(
        {
          partNumber: part.partNumber,
          name: part.name,
          description: part.description ?? null,
          revision: part.revision ?? null
        },
        resolved,
        options
      ),
      ...nonEmpty("unmappedProperties", resolved?.unmapped ?? []),
      action: "create"
    });
  }
  return rows;
}

function nonEmpty<K extends string, T>(
  key: K,
  list: T[]
): Partial<Record<K, T[]>> {
  return list.length > 0 ? ({ [key]: list } as Record<K, T[]>) : {};
}

/**
 * Only values Onshape gives count: Name and Description are optional BOM
 * columns, so an empty cell must not blank Carbon's text.
 */
export function assemblyTextChanges(
  item: Pick<PlanItemRow, "name" | "description">,
  onshape: { name: string | null; description: string | null }
): OwnedFieldChange[] {
  const changes: OwnedFieldChange[] = [];
  if (onshape.name && onshape.name !== item.name) {
    changes.push({ field: "name", from: item.name ?? null, to: onshape.name });
  }
  if (
    onshape.description &&
    onshape.description !== (item.description ?? null)
  ) {
    changes.push({
      field: "description",
      from: item.description ?? null,
      to: onshape.description
    });
  }
  return changes;
}

export type AssemblyPlanItem = MappedRowPlan & {
  partNumber: string;
  name: string | null;
  revision: string | null;
  action: "create" | "reuse";
  itemId: string | null;
  /** Reuse only: matched by part number with no link to this Onshape part. */
  conflict?: boolean;
  /** Create only. */
  proposed: ProposedItem | null;
  /** Reuse only. */
  current?: ItemFieldSnapshot | null;
  /** Reuse only, when the item is or becomes linked to this BOM row. */
  changes?: OwnedFieldChange[];
  /**
   * Reuse only: a release made a revision of this part number, so a workspace
   * push writes no fields, link or model; BOM changes still go into a Draft.
   */
  released?: { revision: string };
  isAssembly: boolean;
  /** "Show Assembly only" in Onshape: the push writes no BOM for it. */
  shownAsUnit?: true;
};

export type AssemblyPlanMethodStatus =
  | "draft"
  | "active"
  /** The parent item will be created, and its method with it. */
  | "new"
  /** Existing item without a make method: refused. */
  | "missing";

export type AssemblyPlanMethod = {
  parentPartNumber: string;
  parentItemId: string | null;
  status: AssemblyPlanMethodStatus;
  /** `active` only: the panel's Draft this push writes into; absent, a new one. */
  reusedDraftVersion?: number | null;
  writes: Array<{
    index: string;
    partNumber: string;
    name: string | null;
    quantity: number;
  }>;
  /** Lines a previous push wrote. */
  replaces: PlanLine[];
  /** Manual lines taking Onshape's quantity; their operation and scrap stay. */
  takesOver: Array<PlanLine & { onshapeQuantity: number }>;
  keeps: PlanLine[];
  /**
   * `active` with no reusable Draft: Onshape's lines equal the method's and
   * none is taken over, so no Draft is made. Apply rechecks child methods.
   */
  unchanged?: true;
};

export type AssemblyPlanRoot = MappedRowPlan & {
  partNumber: string;
  name: string | null;
  description: string | null;
  revision: string | null;
  action: "create" | "reuse";
  itemId: string | null;
  /** `conflict`, `current`, `changes` and `released` as on AssemblyPlanItem. */
  conflict?: boolean;
  proposed: ProposedItem | null;
  current?: ItemFieldSnapshot | null;
  changes?: OwnedFieldChange[];
  released?: { revision: string };
};

/**
 * `all` writes every sub-assembly's method in one push. `top` writes only the
 * root's: a line points at its child's own make method, so a multi-level
 * structure composes from levels pushed separately.
 */
export type AssemblyPlanDepth = "all" | "top";

export type AssemblyPlan = {
  kind: "assembly";
  documentId: string;
  wv: "w" | "v";
  wvId: string;
  elementId: string;
  configuration?: string | null;
  root: AssemblyPlanRoot;
  items: AssemblyPlanItem[];
  methods: AssemblyPlanMethod[];
  /** BOM rows the push cannot place ("<name>: no part number in Onshape"). */
  skipped: string[];
  options: PlanOptions;
  depth: AssemblyPlanDepth;
  /** `top` plans only: what the push leaves out. */
  deeper?: {
    subAssemblies: string[];
    partCount: number;
  };
};

export function flattenNodes(nodes: OnshapeBomNode[]): OnshapeBomNode[] {
  const out: OnshapeBomNode[] = [];
  const walk = (list: OnshapeBomNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

export function buildAssemblyPlan({
  documentId,
  wv,
  wvId,
  elementId,
  root,
  nodes,
  items,
  methodByItemId,
  mappedLinesByMethodId,
  manualLinesByMethodId,
  options,
  depth = "all",
  linkedItemIdByExternalId = new Map(),
  linkedItemIds,
  configuration = null,
  reusableDraftByItemId = new Map(),
  mapping,
  rootProperties = null,
  released = new Map()
}: {
  documentId: string;
  wv: "w" | "v";
  wvId: string;
  elementId: string;
  root: {
    partNumber: string;
    name: string | null;
    description: string | null;
    revision: string | null;
  };
  /** Top-level BOM lines with children nested (parseBomTree().lines). */
  nodes: OnshapeBomNode[];
  /** Carbon items whose readableId is any part number in the BOM or root. */
  items: PlanItemRow[];
  /** Active make method per existing item id (activeMakeMethods). */
  methodByItemId: Map<string, PlanMethodRow>;
  /** Lines a previous push wrote, per method id. */
  mappedLinesByMethodId: Map<string, PlanLine[]>;
  /** Lines no push wrote, per method id. */
  manualLinesByMethodId: Map<string, PlanLine[]>;
  options: PlanOptions;
  depth?: AssemblyPlanDepth;
  /** `onshape-v2` item mappings by externalId; a reuse without one conflicts. */
  linkedItemIdByExternalId?: Map<string, string>;
  /** Items with any Onshape link; one linked elsewhere is left as it is. */
  linkedItemIds?: ReadonlySet<string>;
  configuration?: string | null;
  /** `loadReusableDrafts`: the Draft a push reuses per Active-method item. */
  reusableDraftByItemId?: Map<string, { id: string; version: number | null }>;
  mapping?: PlanMappingContext;
  /** Element metadata; BOM rows carry their own. */
  rootProperties?: OnshapePropertyValue[] | null;
  released?: ReadonlyMap<string, ReleasedRevision>;
}): AssemblyPlan {
  const rowsByReadableId = new Map<string, PlanItemRow[]>();
  // A link to any revision of a part is a link to that part.
  const readableIdByItemId = new Map<string, string>();
  for (const item of items) {
    readableIdByItemId.set(item.id, item.readableId);
    const list = rowsByReadableId.get(item.readableId) ?? [];
    list.push(item);
    rowsByReadableId.set(item.readableId, list);
  }
  // The pick apply makes.
  const itemByReadableId = new Map<string, PlanItemRow>();
  for (const [readableId, rows] of rowsByReadableId) {
    const latest = pickReuseRow(rows);
    if (latest) itemByReadableId.set(readableId, latest);
  }
  const everything = flattenNodes(nodes);
  // At `top` only the root's children become items; `everything` still
  // describes what is left out.
  const all = depth === "top" ? nodes : everything;

  // A node with children is made at every depth, exploded or not.
  const madePartNumbers = new Set<string>([root.partNumber]);
  for (const node of everything) {
    if (node.partNumber && node.children.length > 0) {
      madePartNumbers.add(node.partNumber);
    }
  }

  // Linked when a row's source maps to any revision of its part number: a
  // release repoints the default revision but leaves the part-studio mapping
  // on the old one.
  const linkedPartNumbers = new Set<string>();
  for (const node of everything) {
    if (!node.partNumber) continue;
    const externalId = externalIdForBomLine(node.itemSource ?? null);
    const linkedId = externalId
      ? linkedItemIdByExternalId.get(externalId)
      : undefined;
    if (linkedId && readableIdByItemId.get(linkedId) === node.partNumber) {
      linkedPartNumbers.add(node.partNumber);
    }
  }

  const descriptionModes =
    mapping?.descriptionModes ?? DEFAULT_DESCRIPTION_MODES;
  const resolve = (
    properties: OnshapePropertyValue[] | null | undefined,
    matchByName: boolean
  ) =>
    mapping && mapping.map.length > 0 && properties
      ? resolveMappedFields({
          properties,
          map: mapping.map,
          definitions: mapping.definitions,
          units: options.unitsOfMeasure,
          matchByName
        })
      : null;
  const existingPlan = (
    item: PlanItemRow,
    onshape: { name: string | null; description: string | null },
    resolved: ReturnType<typeof resolve>
  ) => {
    const { changes, ...planned } = planExistingItem({
      current: currentItemFields(item),
      item,
      onshape,
      resolved,
      heldCustomFields: mapping?.heldCustomFields.get(item.readableId),
      descriptionModes,
      units: options.unitsOfMeasure
    });
    return { ...planned, ...nonEmpty("changes", changes) };
  };

  const rootItem = itemByReadableId.get(root.partNumber);
  const linkedRootId = linkedItemIdByExternalId.get(
    externalIdForAssembly(documentId, elementId, configuration)
  );
  const rootConflict =
    !!rootItem &&
    (!linkedRootId || readableIdByItemId.get(linkedRootId) !== root.partNumber);
  // BOM rows are not reported as unmapped: every column would be.
  const rootResolved = resolve(rootProperties, false);
  const rootIdentity = {
    partNumber: root.partNumber,
    name: root.name,
    description: root.description,
    revision: root.revision
  };
  // The pushed assembly is always linked, so it takes "everyPush" values,
  // unless a release made a revision of it: then only its BOM is written.
  const rootReleased = released.get(root.partNumber);
  const planRoot: AssemblyPlanRoot = rootItem
    ? rootReleased
      ? {
          ...rootIdentity,
          action: "reuse",
          itemId: rootItem.id,
          released: { revision: rootReleased.revision },
          proposed: null
        }
      : {
          ...rootIdentity,
          ...existingPlan(rootItem, root, rootResolved),
          ...nonEmpty("unmappedProperties", rootResolved?.unmapped ?? []),
          action: "reuse",
          itemId: rootItem.id,
          ...(rootConflict ? { conflict: true } : {}),
          current: currentItemFields(rootItem),
          proposed: null
        }
    : {
        ...rootIdentity,
        ...planCreatedItem(rootIdentity, rootResolved, options),
        ...nonEmpty("unmappedProperties", rootResolved?.unmapped ?? []),
        action: "create",
        itemId: null
      };

  // As apply's `linkChildParts`: a row takes "everyPush" values when linked to
  // it already, or when neither item nor source is linked anywhere and the
  // source carries one part number.
  const numbersBySource = new Map<string, Set<string>>();
  for (const node of everything) {
    const externalId = externalIdForBomLine(node.itemSource ?? null);
    if (!externalId || !node.partNumber) continue;
    const numbers = numbersBySource.get(externalId) ?? new Set<string>();
    numbers.add(node.partNumber);
    numbersBySource.set(externalId, numbers);
  }
  const pushWrites = (node: OnshapeBomNode, item: PlanItemRow) => {
    if (!node.partNumber) return false;
    if (linkedPartNumbers.has(node.partNumber)) return true;
    if (!linkedItemIds || linkedItemIds.has(item.id)) return false;
    const externalId = externalIdForBomLine(node.itemSource ?? null);
    return (
      !!externalId &&
      !linkedItemIdByExternalId.has(externalId) &&
      (numbersBySource.get(externalId)?.size ?? 0) === 1
    );
  };

  const planItems: AssemblyPlanItem[] = [];
  const seen = new Set<string>([root.partNumber]);
  const skipped: string[] = [];
  // Items that cannot be a BOM line (a Tool): skipped, as apply refuses them.
  const unusable = new Set<string>();
  for (const node of all) {
    if (!node.partNumber) {
      skipped.push(`${node.name ?? node.index}: no part number in Onshape`);
      continue;
    }
    if (seen.has(node.partNumber)) continue;
    seen.add(node.partNumber);
    const existing = itemByReadableId.get(node.partNumber);
    if (existing && bomLineItemType(existing) === null) {
      unusable.add(node.partNumber);
      skipped.push(
        `${node.partNumber}: Carbon has it as a ${existing.type ?? "non-part"} item, which cannot be a BOM line`
      );
      continue;
    }
    const identity = {
      partNumber: node.partNumber,
      name: node.name,
      revision: node.revision,
      isAssembly: node.children.length > 0,
      ...(node.shownAsUnit ? { shownAsUnit: true as const } : {})
    };
    const childReleased = existing ? released.get(node.partNumber) : undefined;
    if (existing && childReleased) {
      planItems.push({
        ...identity,
        action: "reuse",
        itemId: existing.id,
        released: { revision: childReleased.revision },
        proposed: null
      });
      continue;
    }
    if (existing) {
      planItems.push({
        ...identity,
        ...(pushWrites(node, existing)
          ? existingPlan(existing, node, resolve(node.properties, true))
          : {}),
        action: "reuse",
        itemId: existing.id,
        ...(!linkedPartNumbers.has(node.partNumber) ? { conflict: true } : {}),
        current: currentItemFields(existing),
        proposed: null
      });
      continue;
    }
    planItems.push({
      ...identity,
      ...planCreatedItem(
        {
          partNumber: node.partNumber,
          name: node.name,
          description: node.description,
          revision: node.revision,
          hasChildren: madePartNumbers.has(node.partNumber),
          standardContent: node.standardContent === true
        },
        resolve(node.properties, true),
        options
      ),
      action: "create",
      itemId: null
    });
  }

  // One method per made part number, in tree order; the root first.
  const methods: AssemblyPlanMethod[] = [];
  const methodSeen = new Set<string>();
  const addMethod = (
    parentPartNumber: string,
    parentItemId: string | null,
    children: OnshapeBomNode[]
  ) => {
    if (methodSeen.has(parentPartNumber)) return;
    methodSeen.add(parentPartNumber);
    const method = parentItemId ? methodByItemId.get(parentItemId) : undefined;
    const status: AssemblyPlanMethodStatus = !parentItemId
      ? "new"
      : !method
        ? "missing"
        : method.status === "Active"
          ? "active"
          : "draft";
    // An Active method is written through a Draft: the reused Draft's lines,
    // or the Active method's, which a new Draft copies with their ownership.
    const reusedDraft =
      status === "active" && parentItemId
        ? reusableDraftByItemId.get(parentItemId)
        : undefined;
    const linesMethodId = reusedDraft?.id ?? method?.id;
    const writes = children
      .filter((child) => !!child.partNumber && !unusable.has(child.partNumber))
      .map((child) => ({
        index: child.index,
        partNumber: child.partNumber as string,
        name: child.name,
        quantity: child.quantity
      }));
    const replaces = linesMethodId
      ? (mappedLinesByMethodId.get(linesMethodId) ?? [])
      : [];
    const manual = linesMethodId
      ? (manualLinesByMethodId.get(linesMethodId) ?? [])
      : [];
    // The type of the item each write points at; a new item is a Part.
    const { takesOver, keeps } = pairManualLines(
      writes.map((write) => {
        const existing = itemByReadableId.get(write.partNumber);
        return {
          ...write,
          itemType: existing ? (bomLineItemType(existing) ?? undefined) : "Part"
        };
      }),
      replaces,
      manual
    );
    const unchanged =
      status === "active" &&
      !reusedDraft &&
      takesOver.length === 0 &&
      writes.length === replaces.length &&
      writes.every(
        (write, index) =>
          replaces[index]?.readableId === write.partNumber &&
          replaces[index]?.quantity === write.quantity
      );
    methods.push({
      parentPartNumber,
      parentItemId,
      status,
      ...(reusedDraft ? { reusedDraftVersion: reusedDraft.version } : {}),
      writes,
      replaces,
      takesOver,
      keeps,
      ...(unchanged ? { unchanged: true as const } : {})
    });
    for (const child of children) {
      if (child.partNumber && child.children.length > 0) {
        addMethod(
          child.partNumber,
          itemByReadableId.get(child.partNumber)?.id ?? null,
          child.children
        );
      }
    }
  };
  addMethod(root.partNumber, rootItem?.id ?? null, nodes);

  if (depth === "all") {
    return {
      kind: "assembly",
      documentId,
      wv,
      wvId,
      elementId,
      configuration: normalizeConfiguration(configuration),
      root: planRoot,
      items: planItems,
      methods,
      skipped,
      options,
      depth
    };
  }

  const topLevelPartNumbers = new Set(
    nodes.map((node) => node.partNumber).filter((n): n is string => !!n)
  );
  const deeperPartNumbers = new Set(
    everything
      .map((node) => node.partNumber)
      .filter(
        (n): n is string =>
          !!n && !topLevelPartNumbers.has(n) && n !== root.partNumber
      )
  );

  return {
    kind: "assembly",
    documentId,
    wv,
    wvId,
    elementId,
    configuration: normalizeConfiguration(configuration),
    root: planRoot,
    items: planItems,
    // `addMethod` recursed; keep only the root's method.
    methods: methods.slice(0, 1),
    skipped,
    options,
    depth,
    deeper: {
      subAssemblies: nodes
        .filter((node) => !!node.partNumber && node.children.length > 0)
        .map((node) => node.partNumber as string),
      partCount: deeperPartNumbers.size
    }
  };
}

/**
 * Takes out the methods the push must not write (a change notice's Draft, a
 * locked revision) and lists each under `skipped` with its reason, keyed by
 * parent item id. An Active method that stays unchanged writes nothing, so it
 * is not refused. Apply checks again before it writes.
 */
export function withRefusedMethods(
  plan: AssemblyPlan,
  reasonByItemId: ReadonlyMap<string, string>
): AssemblyPlan {
  const reasonFor = (method: AssemblyPlanMethod) =>
    method.parentItemId && !method.unchanged
      ? reasonByItemId.get(method.parentItemId)
      : undefined;
  const refused = plan.methods.filter((method) => reasonFor(method));
  if (refused.length === 0) return plan;
  return {
    ...plan,
    methods: plan.methods.filter((method) => !reasonFor(method)),
    skipped: [
      ...plan.skipped,
      ...refused.map(
        (method) => `${method.parentPartNumber}: ${reasonFor(method)}`
      )
    ]
  };
}

export type ReleasePlanItemAction =
  /** An item already exists at the released letter. */
  | "reuse"
  | "revision"
  | "create"
  /** A released drawing with a model item to attach to. */
  | "drawing"
  | "drawing-unmatched";

export type ReleasePlanItem = MappedRowPlan & {
  partNumber: string;
  revision: string;
  elementType: number;
  elementId: string;
  versionId: string;
  /** Part Studio items: the part the export translates; without one, none. */
  partId?: string | null;
  configuration?: string | null;
  action: ReleasePlanItemAction;
  baseItemId: string | null;
  baseRevision: string | null;
  existingItemId: string | null;
  /** Create only. */
  proposed: ProposedItem | null;
  /** reuse/revision only: the reused item's fields, or the base's. */
  current?: ItemFieldSnapshot | null;
  /** reuse/revision only. */
  changes?: OwnedFieldChange[];
  /** Released assemblies only; a reused item's Active method is refused. */
  methodStatus: "draft" | "active" | "new" | "missing" | null;
  /**
   * Drawings only: the release's model item with the drawing's number, else
   * the model the package lists, with `itemId` when Carbon has it outside the
   * release at the package's revision.
   */
  drawingOf?: {
    partNumber: string;
    revision: string | null;
    itemId?: string | null;
  } | null;
};

/** A BOM child of a released assembly that is not itself in the release. */
export type ReleasePlanChild = MappedRowPlan & {
  partNumber: string;
  name: string | null;
  revision: string | null;
  action: "create" | "reuse";
  itemId: string | null;
  /** Reuse only: the Carbon revision the line points at. */
  itemRevision?: string | null;
  /** Reuse only: the revision the BOM names that Carbon lacks. */
  missingRevision?: string;
  proposed: ProposedItem | null;
  current?: ItemFieldSnapshot | null;
};

export type ReleasePlan = {
  kind: "release";
  documentId: string;
  releaseId: string;
  releaseName: string | null;
  createdAt: string | null;
  items: ReleasePlanItem[];
  children: ReleasePlanChild[];
  /** Null when the push creates no release item; BOM children do not count. */
  changeNotice: { name: string; description: string | null } | null;
  /** An open notice an earlier push of this release made; the push adds to it. */
  existingChangeNotice?: string | null;
  makeDefault: boolean;
  alreadyPushed: boolean;
  options: PlanOptions;
};

export function buildReleasePlan({
  documentId,
  release,
  items,
  bomLinesByElementId,
  methodByItemId,
  options,
  mapping,
  propertiesByPartNumber,
  drawingModelByElementId = new Map()
}: {
  documentId: string;
  release: PanelRelease;
  /** Every Carbon revision row for the release's and the BOMs' part numbers. */
  items: PlanItemRow[];
  /**
   * Keyed by `releaseBomKey` (element plus configuration). Null when the read
   * failed; apply then leaves that method alone.
   */
  bomLinesByElementId: Record<string, OnshapeBomNode[] | null>;
  methodByItemId: Map<string, PlanMethodRow>;
  options: PlanOptions;
  mapping?: PlanMappingContext;
  /** Model items' properties at the released version; BOM rows carry theirs. */
  propertiesByPartNumber?: ReadonlyMap<string, OnshapePropertyValue[]>;
  /** `drawingModels` over the release package, per drawing element. */
  drawingModelByElementId?: ReadonlyMap<
    string,
    { partNumber: string; revision: string | null }
  >;
}): ReleasePlan {
  const descriptionModes =
    mapping?.descriptionModes ?? DEFAULT_DESCRIPTION_MODES;
  const resolve = (
    properties: OnshapePropertyValue[] | null | undefined,
    matchByName: boolean
  ) =>
    mapping && mapping.map.length > 0 && properties
      ? resolveMappedFields({
          properties,
          map: mapping.map,
          definitions: mapping.definitions,
          units: options.unitsOfMeasure,
          matchByName
        })
      : null;
  // A new revision copies its base, then takes the "everyPush" values.
  const existingPlan = (
    item: PlanItemRow,
    onshape: { name: string | null; description: string | null },
    partNumber: string
  ) => {
    const resolved = resolve(propertiesByPartNumber?.get(partNumber), false);
    const { changes, ...planned } = planExistingItem({
      current: currentItemFields(item),
      item,
      onshape,
      resolved,
      heldCustomFields: mapping?.heldCustomFields.get(item.readableId),
      descriptionModes,
      units: options.unitsOfMeasure
    });
    return {
      ...planned,
      ...nonEmpty("changes", changes),
      ...nonEmpty("unmappedProperties", resolved?.unmapped ?? [])
    };
  };
  const byReadable = new Map<string, PlanItemRow[]>();
  for (const row of items) {
    const list = byReadable.get(row.readableId) ?? [];
    list.push(row);
    byReadable.set(row.readableId, list);
  }
  const letterRowFor = (partNumber: string, revision: string) =>
    (byReadable.get(partNumber) ?? []).find((row) => row.revision === revision);

  const modelItems = release.items.filter(isModelReleaseItem);
  const modelPartNumbers = new Set(modelItems.map((item) => item.partNumber));

  // Fallback text for release items: the revisions list has part numbers only.
  const bomNodeByPartNumber = new Map<string, OnshapeBomNode>();
  for (const lines of Object.values(bomLinesByElementId)) {
    for (const node of lines ?? []) {
      if (node.partNumber && !bomNodeByPartNumber.has(node.partNumber)) {
        bomNodeByPartNumber.set(node.partNumber, node);
      }
    }
  }

  const planItems: ReleasePlanItem[] = [];
  for (const item of release.items) {
    if (!isModelReleaseItem(item)) {
      const model = modelPartNumbers.has(item.partNumber)
        ? { partNumber: item.partNumber, revision: item.revision }
        : (drawingModelByElementId.get(item.elementId) ?? null);
      const inRelease = !!model && modelPartNumbers.has(model.partNumber);
      const carbonRow =
        model && !inRelease && model.revision
          ? letterRowFor(model.partNumber, model.revision)
          : undefined;
      const attaches = inRelease || !!carbonRow;
      planItems.push({
        ...releaseIdentity(item),
        action: attaches ? "drawing" : "drawing-unmatched",
        baseItemId: null,
        baseRevision: null,
        existingItemId: null,
        proposed: null,
        methodStatus: null,
        drawingOf: model
          ? { ...model, ...(carbonRow ? { itemId: carbonRow.id } : {}) }
          : null
      });
      continue;
    }

    const isAssembly = item.elementType === 1;
    const node = bomNodeByPartNumber.get(item.partNumber);
    const properties = propertiesByPartNumber?.get(item.partNumber);
    const onshapeText = {
      name: propertyText(properties, "Name") ?? node?.name ?? null,
      description:
        propertyText(properties, "Description") ?? node?.description ?? null
    };
    const existingLetter = letterRowFor(item.partNumber, item.revision);
    if (existingLetter) {
      const method = methodByItemId.get(existingLetter.id);
      planItems.push({
        ...releaseIdentity(item),
        ...existingPlan(existingLetter, onshapeText, item.partNumber),
        action: "reuse",
        baseItemId: null,
        baseRevision: null,
        existingItemId: existingLetter.id,
        proposed: null,
        current: currentItemFields(existingLetter),
        methodStatus: !isAssembly
          ? null
          : !method
            ? "missing"
            : method.status === "Active"
              ? "active"
              : "draft"
      });
      continue;
    }

    const base = pickRevisionBase(
      byReadable.get(item.partNumber) ?? [],
      item.revision
    );
    if (base) {
      planItems.push({
        ...releaseIdentity(item),
        ...existingPlan(base, onshapeText, item.partNumber),
        action: "revision",
        baseItemId: base.id,
        baseRevision: base.revision,
        existingItemId: null,
        proposed: null,
        current: currentItemFields(base),
        methodStatus: isAssembly ? "new" : null
      });
      continue;
    }

    const resolved = resolve(properties, false);
    planItems.push({
      ...releaseIdentity(item),
      ...planCreatedItem(
        {
          partNumber: item.partNumber,
          name: onshapeText.name,
          description: onshapeText.description,
          revision: item.revision,
          hasChildren: isAssembly
        },
        resolved,
        options
      ),
      ...nonEmpty("unmappedProperties", resolved?.unmapped ?? []),
      action: "create",
      baseItemId: null,
      baseRevision: null,
      existingItemId: null,
      methodStatus: isAssembly ? "new" : null
    });
  }

  // Level-1 BOM children outside the release: reused when Carbon has any
  // revision, else created. A reused child is not linked, so takes no values.
  const children: ReleasePlanChild[] = [];
  const childSeen = new Set<string>();
  for (const lines of Object.values(bomLinesByElementId)) {
    for (const node of lines ?? []) {
      if (!node.partNumber || modelPartNumbers.has(node.partNumber)) continue;
      if (childSeen.has(node.partNumber)) continue;
      childSeen.add(node.partNumber);
      const { row: existing, missingRevision } = pickBomChildRow(
        byReadable.get(node.partNumber) ?? [],
        node.revision
      );
      const identity = {
        partNumber: node.partNumber,
        name: node.name,
        revision: node.revision
      };
      if (existing) {
        children.push({
          ...identity,
          action: "reuse",
          itemId: existing.id,
          itemRevision: existing.revision,
          ...(missingRevision ? { missingRevision } : {}),
          current: currentItemFields(existing),
          proposed: null
        });
        continue;
      }
      children.push({
        ...identity,
        ...planCreatedItem(
          {
            partNumber: node.partNumber,
            name: node.name,
            description: node.description,
            revision: node.revision,
            hasChildren: node.children.length > 0,
            standardContent: node.standardContent === true
          },
          resolve(node.properties, true),
          options
        ),
        action: "create",
        itemId: null
      });
    }
  }

  // The notice gets one affected row per created release item and none for
  // BOM children, so only release items propose one.
  const createsReleaseItems = planItems.some(
    (item) => item.action === "revision" || item.action === "create"
  );
  // A release whose items are all in Carbon can still create a BOM child.
  const createsAnything =
    createsReleaseItems || children.some((child) => child.action === "create");

  return {
    kind: "release",
    documentId,
    releaseId: release.releaseId,
    releaseName: release.releaseName,
    createdAt: release.createdAt,
    items: planItems,
    children,
    changeNotice: createsReleaseItems
      ? {
          name: release.releaseName ?? `Onshape release ${release.releaseId}`,
          description: null
        }
      : null,
    makeDefault: true,
    alreadyPushed: !createsAnything,
    options
  };
}

function propertyText(
  properties: OnshapePropertyValue[] | undefined,
  name: string
): string | null {
  const value = properties?.find((property) => property.name === name)?.value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
}

function releaseIdentity(item: PanelReleaseItem) {
  return {
    partNumber: item.partNumber,
    revision: item.revision,
    elementType: item.elementType,
    elementId: item.elementId,
    versionId: item.versionId,
    partId: item.partId ?? null,
    // Raw: the export sends it back to Onshape as the revision gave it.
    configuration: item.configuration ?? null
  };
}

export type ChangeNoticeEdit = {
  name: string;
  description: string | null;
};

export const CHANGE_NOTICE_NAME_MAX_LENGTH = 255;
export const CHANGE_NOTICE_DESCRIPTION_MAX_LENGTH = 4000;

export function mergeChangeNoticeEdit(
  proposed: ChangeNoticeEdit,
  edit: Partial<ChangeNoticeEdit> | null | undefined
):
  | { ok: true; changeNotice: ChangeNoticeEdit }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const changeNotice: ChangeNoticeEdit = { ...proposed };
  if (!edit) return { ok: true, changeNotice };
  if (edit.name !== undefined) {
    const name = typeof edit.name === "string" ? edit.name.trim() : "";
    if (name === "") errors.push("Change notice name is required");
    else if (name.length > CHANGE_NOTICE_NAME_MAX_LENGTH)
      errors.push(
        `Change notice name is longer than ${CHANGE_NOTICE_NAME_MAX_LENGTH} characters`
      );
    else changeNotice.name = name;
  }
  if (edit.description !== undefined) {
    const description =
      typeof edit.description === "string" ? edit.description.trim() : "";
    if (description.length > CHANGE_NOTICE_DESCRIPTION_MAX_LENGTH)
      errors.push(
        `Change notice description is longer than ${CHANGE_NOTICE_DESCRIPTION_MAX_LENGTH} characters`
      );
    else changeNotice.description = description === "" ? null : description;
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, changeNotice };
}

/** changeOrder.description is a tiptap document; wraps text as the ERP form does. */
export function changeNoticeDescriptionJson(text: string | null): {
  type: "doc";
  content: Array<{
    type: "paragraph";
    content: Array<{ type: "text"; text: string }>;
  }>;
} | null {
  if (!text) return null;
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }]
  };
}

/** Keyed as the plan is: partId for parts, part number otherwise. */
export function mergeEditsForCreates(
  creates: Array<{ key: string; proposed: ProposedItem }>,
  edits: Record<string, ItemEdit> | null | undefined,
  options: PlanOptions
): {
  items: Map<string, ProposedItem>;
  errors: Array<{ key: string; errors: string[] }>;
} {
  const items = new Map<string, ProposedItem>();
  const errors: Array<{ key: string; errors: string[] }> = [];
  for (const { key, proposed } of creates) {
    const merged = mergeItemEdits(proposed, edits?.[key], options);
    if (merged.ok) items.set(key, merged.item);
    else errors.push({ key, errors: merged.errors });
  }
  return { items, errors };
}
