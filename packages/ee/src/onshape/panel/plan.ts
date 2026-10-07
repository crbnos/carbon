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
  normalizeConfiguration
} from "./status";

/**
 * Plan / apply for the panel's pushes.
 *
 * PLAN reads Onshape and Carbon and returns what would happen — every item it
 * would create with the values it would use, every BOM line it would replace
 * or leave alone — and APPLY consumes that plan (stored server-side, plus the
 * user's edits and deselections) without reading Onshape again. The builders
 * here are pure so the decision a user reviewed is the decision that runs.
 *
 * Onshape owns identity (part number, revision). Every other value a push
 * writes to an existing item comes from a mapping, or a description, in
 * "everyPush" mode; Carbon locks no field.
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

/** The row a create would write, before and after the user's edits. */
export type ProposedItem = {
  /** Locked: the Onshape part number. */
  readableId: string;
  /** Locked: the Onshape revision, "0" when none. */
  revision: string;
  name: string;
  description: string | null;
  replenishmentSystem: ItemReplenishmentSystem;
  defaultMethodType: ItemMethodType;
  itemTrackingType: ItemTrackingType;
  unitOfMeasureCode: string;
  /** From a mapping only; written right after the item is created. */
  mpn?: string | null;
  /** From a mapping only, on a Buy and Make item. */
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

/**
 * A Short Description (`name`) or Long Description (`description`) the push
 * overwrites with Onshape's.
 */
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
  /** item.type — Part, Material, Consumable, … */
  type?: string | null;
  /** False for a revision not yet in use (a change notice's, say). */
  active?: boolean | null;
  /**
   * The three Carbon-side manufacturing attributes the panel can edit on an
   * existing item. `currentItemFields` coerces whatever is present.
   */
  replenishmentSystem?: string | null;
  defaultMethodType?: string | null;
  itemTrackingType?: string | null;
  unitOfMeasureCode?: string | null;
  sourcingType?: string | null;
  mpn?: string | null;
};

/** methodMaterial.itemType accepts only these (shared.models methodItemType). */
export const BOM_LINE_ITEM_TYPES = ["Part", "Material", "Consumable"] as const;

/** The line itemType for a reused item, or null when it cannot be a BOM line. */
export function bomLineItemType(
  item: Pick<PlanItemRow, "type">
): (typeof BOM_LINE_ITEM_TYPES)[number] | null {
  const type = item.type ?? "Part";
  return (BOM_LINE_ITEM_TYPES as readonly string[]).includes(type)
    ? (type as (typeof BOM_LINE_ITEM_TYPES)[number])
    : null;
}

/**
 * The latest revision among rows sharing a part number — the row a BOM line
 * points at when the plan reuses an item, and the base a release revision is
 * copied from. Active rows win over inactive ones (a revision a change notice
 * has not released yet is not the one in use). Order-independent, so plan and
 * apply agree whatever the query returned.
 */
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
 * Which hand-added lines a push takes over. Each Onshape line first pairs with
 * a line an earlier push wrote for the same part number, then with a manual
 * one of the same item type, in line order — the pairing apply makes. Manual lines left unpaired are
 * kept as they are.
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
    // Item numbers are unique per type: a Material sharing a Part's number
    // is a different item, so its line is kept, never repointed.
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

/**
 * Which existing row an assembly push reuses when several share a part number:
 * the latest Part, else the latest row that can be a BOM line, else the latest
 * row (which the plan then reports as unusable). Item numbers are unique per
 * type, so a Tool can share a Part's number; picking it by revision alone
 * dropped the line although the Part was there.
 */
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

/**
 * Which existing row an Onshape part adopts when several share its part
 * number: a Part at the same revision, else the latest Part, else nothing — an
 * Onshape part never adopts a Material or Tool that happens to share the
 * number.
 */
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
  /** makeMethodStatus: Draft | Active | Archived. */
  status: string;
};

/** A BOM line as the plan shows it — what a method will gain, lose or keep. */
export type PlanLine = {
  readableId: string;
  quantity: number;
  /** Manual lines only: the line's item type, which a takeover must match. */
  itemType?: string | null;
};

// ---------------------------------------------------------------------------
// Proposals and edits
// ---------------------------------------------------------------------------

/** "EA" when the company has it, else its first unit — never a code it lacks. */
export function defaultUnitOfMeasureCode(options: PlanOptions): string {
  const codes = options.unitsOfMeasure.map((u) => u.code);
  // The configured unit wins, but only while the company still has it: a unit
  // the settings name and the company deleted would fail the same validation
  // `mergeItemEdits` applies to a user's edit.
  const configured = options.defaults.unitOfMeasureCode;
  if (configured && codes.includes(configured)) return configured;
  if (codes.includes("EA")) return "EA";
  return codes[0] ?? "EA";
}

/** What a push knows about an item it would create. */
export type ProposalInput = {
  partNumber: string;
  name: string | null;
  description?: string | null;
  revision?: string | null;
  /** A BOM row with children: Make, unless a mapping says otherwise. */
  hasChildren?: boolean;
  /** A BOM row from Standard content: Buy, unless a mapping says otherwise. */
  standardContent?: boolean;
  /** Mapped item field values, which win over every rule below them. */
  mapped?: MappedItemValues;
};

/** The item a push would create for an Onshape part, assembly or BOM row. */
export function proposeItem(
  input: ProposalInput,
  options: PlanOptions
): ProposedItem {
  return proposeMappedItem(input, options).proposed;
}

/**
 * The item a push would create, and the mapped values it cannot use.
 *
 * For each field the first rule that gives a value wins: the mapped value,
 * then (Replenishment only) a BOM row with children is Make, then a Standard
 * content row is Buy, then the push defaults. A mapped Replenishment with no
 * mapped method takes the push default method for that Replenishment. The
 * reviewer's choice in the review sits above all of these.
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

/** The push defaults as item fields: the last rule of the precedence order. */
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

/**
 * Apply a user's edits to a proposal, refusing anything the Part form would:
 * unknown enum values, a unit the company does not have, an empty name, a
 * method type the replenishment system does not allow. Unknown keys and
 * locked fields are ignored, never applied.
 */
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

  // The interlock is checked on the merged pair, so an edit that changes only
  // one side is still held to the rule.
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

// ---------------------------------------------------------------------------
// Item fields: mapped values, the interlock, and reviewer edits
// ---------------------------------------------------------------------------

/**
 * An item's fields the panel can set. The review edits the first three; the
 * rest change only through a mapping. A field the plan did not read is
 * absent, and a push never writes an absent field.
 */
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

/** A value a push writes to an existing item's field, for the review. */
export type ItemFieldChange = {
  field: StandardFieldId;
  label: string;
  from: string | null;
  to: string | null;
  /**
   * The Onshape property behind the change. Null when Carbon derived it: the
   * method that goes with a new Replenishment or Sourcing.
   */
  onshapeName: string | null;
};

/** An Onshape value the push does not write to an existing item. */
export type KeptDifference = {
  label: string;
  onshape: string;
  carbon: string | null;
};

/**
 * What the property map does to one plan row. On a create: the custom field
 * values and item field values it writes. On an existing item: the values
 * "everyPush" mappings write, and the "create" values it keeps out.
 */
export type MappedRowPlan = {
  /** Custom field values the push writes. */
  customFields?: PlanCustomField[];
  /** Mapped item field values, with the property each came from. */
  itemFields?: PlanItemField[];
  /** Existing items: the item fields the push changes. */
  itemFieldChanges?: ItemFieldChange[];
  /**
   * Existing items: the fields after the push's mapped writes, before the
   * reviewer's edits. Absent when no mapping changes a field.
   */
  target?: ItemFieldSnapshot;
  /** Existing items: Onshape values the push does not write. */
  keptDifferences?: KeptDifference[];
  /** Mapped values the push cannot write; shown, never written. */
  mappedFieldProblems?: string[];
  /** Valued Onshape properties no map entry covers. */
  unmappedProperties?: UnmappedProperty[];
};

/** What a plan builder needs to resolve the company's property map. */
export type PlanMappingContext = {
  map: PropertyMapEntry[];
  definitions: PlanCustomFieldDefinition[];
  descriptionModes: DescriptionModes;
  /** `part.customFields` per part number, for the existing items. */
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

/** A method the replenishment system allows, keeping the given one when legal. */
export function reconcileMethodForReplenishment(
  replenishment: ItemReplenishmentSystem,
  method: ItemMethodType
): ItemMethodType {
  const allowed = VALID_METHOD_TYPES_BY_REPLENISHMENT[replenishment];
  return allowed.includes(method) ? method : (allowed[0] ?? method);
}

/**
 * The method Carbon sets with a new Replenishment, as the item page does
 * (`deriveItemMethodUpdate`): Make pins Make to Order, Buy pins Purchase to
 * Order, and Buy and Make leaves the method.
 */
export function methodForReplenishment(
  replenishment: ItemReplenishmentSystem,
  method: ItemMethodType
): ItemMethodType {
  if (replenishment === "Make") return "Make to Order";
  if (replenishment === "Buy") return "Purchase to Order";
  return method;
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

/**
 * An existing item's current fields, coerced to the enums. A stored value
 * outside the enum (or a legacy replenishment/method pair that no longer
 * interlocks) falls back to something legal, so the review always renders and
 * the seed the editor shows is always a valid starting point. Sourcing, unit
 * and MPN are carried only when the row has them.
 */
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

/** Mapped item field values, typed: the input to the interlock. */
export type MappedItemValues = {
  mpn?: string;
  replenishmentSystem?: ItemReplenishmentSystem;
  defaultMethodType?: ItemMethodType;
  sourcingType?: ItemSourcingType;
  itemTrackingType?: ItemTrackingType;
  unitOfMeasureCode?: string;
};

/**
 * The values of the given mapped item fields that a push can use. "No value"
 * gives none. A unit the company no longer has is a problem: a translation
 * row can outlive the unit it names.
 */
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
 * Lay mapped values over an item's fields, in the order the item page's
 * interlock needs:
 *
 * 1. Replenishment, with the method `methodFor` gives for it.
 * 2. The default method, refused when the final Replenishment does not allow
 *    it.
 * 3. Sourcing, on a Buy and Make item only, with the method it sets.
 * 4. Tracking type, unit and MPN.
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

/** The label the item page uses for a snapshot field. */
function fieldLabel(field: StandardFieldId): string {
  return standardField(field)?.label ?? field;
}

/**
 * The fields where `next` differs from `current`. A field `next` does not
 * carry is not a change.
 */
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
 * What a push does to an item it does not create but links, or that is
 * linked to its source: the "everyPush" values it writes, and the "create"
 * values it keeps out (shown as kept differences).
 *
 * - Descriptions: only a value Onshape gives is compared; an empty one never
 *   blanks Carbon's text.
 * - Item fields: the "everyPush" values go through the interlock, with the
 *   method the item page would set (`methodForReplenishment`).
 * - Custom fields: an "everyPush" value replaces Carbon's, and an empty one
 *   clears it. The part row is shared by every revision, so a new revision is
 *   not a creation here.
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
  item: { name?: string | null; description?: string | null };
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
    ).map(([field, to]) => ({
      field: field as StandardFieldId,
      label: fieldLabel(field as StandardFieldId),
      from:
        (current[field as keyof ItemFieldSnapshot] as string | null) ?? null,
      to: (to as string | null) ?? null,
      onshapeName: sourceByField.get(field as StandardFieldId) ?? null
    }));
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
    for (const field of customFieldKeptDifferences(
      heldCustomFields,
      resolved.fields
    )) {
      const definition = definitions.get(field.fieldId);
      const heldValue = held[field.fieldId];
      kept.push({
        label: field.name,
        onshape: customFieldDisplayValue(field),
        carbon:
          heldValue === undefined || heldValue === null || heldValue === ""
            ? null
            : customFieldDisplayValue({
                value: heldValue as string | number | boolean,
                dataTypeId: definition?.dataTypeId ?? field.dataTypeId
              })
      });
    }
    const customFields = customFieldWrites(heldCustomFields, resolved.fields);
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

/**
 * What the property map does to an item a push creates: the proposal with
 * the mapped values in it, the custom field values the create writes, and
 * the mapped values it cannot use.
 */
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
  const itemFields = resolved.itemFields.filter(
    (field) => field.value !== null
  );
  if (itemFields.length > 0) out.itemFields = itemFields;
  const allProblems = [...resolved.problems, ...mapped.problems, ...problems];
  if (allProblems.length > 0) out.mappedFieldProblems = allProblems;
  return out;
}

/**
 * The item fields a create writes right after the insert, which `upsertPart`
 * does not take: MPN, and Sourcing while the item is still Buy and Make after
 * the reviewer's edits.
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
 * Apply the panel's three manufacturing edits on top of `base` — the item's
 * fields after the push's mapped writes, or its current fields — refusing an
 * unknown enum or a method the replenishment system does not allow (the same
 * interlock `mergeItemEdits` enforces for creates). Name, description, unit
 * and custom fields on the edit are ignored. Returns the merged values and
 * the subset that differs from `current`, so a push that changes nothing
 * writes nothing and stamps no audit fields.
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

// ---------------------------------------------------------------------------
// Part plan
// ---------------------------------------------------------------------------

export type PartPlanAction =
  | "create"
  | "adopt"
  | "update"
  | "unchanged"
  | "skip-no-part-number";

export type PartPlanRow = MappedRowPlan & {
  partId: string;
  partNumber: string | null;
  name: string;
  description: string | null;
  revision: string | null;
  microversionId: string | null;
  action: PartPlanAction;
  /** The Carbon item an adopt/update/unchanged points at. */
  itemId: string | null;
  item: { readableId: string; revision: string; name: string } | null;
  /** Create only. */
  proposed: ProposedItem | null;
  /**
   * adopt/update/unchanged only: the linked/matched item's CURRENT
   * manufacturing fields, so the review can seed the editor with what Carbon
   * holds and only send the ones the user changes.
   */
  current?: ItemFieldSnapshot | null;
  /** Descriptions in "everyPush" mode that the push overwrites. */
  changes: OwnedFieldChange[];
  /**
   * An update only because mapped values or descriptions differ: the CAD is
   * the one the last push exported, so apply writes the values and the link
   * but skips the model export.
   */
  cadUnchanged?: true;
};

export type PartPlan = {
  kind: "part";
  documentId: string;
  wv: "w" | "v";
  wvId: string;
  elementId: string;
  /**
   * The Part Studio configuration the parts were read in, null for the
   * default. Part of every mapping key the apply writes.
   */
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
  propertiesByPartId
}: {
  documentId: string;
  elementId: string;
  configuration?: string | null;
  parts: OnshapeElementPart[];
  requestedPartIds: string[];
  mappings: PlanMappingRow[];
  items: PlanItemRow[];
  options: PlanOptions;
  /** The company's property map; absent, only descriptions are planned. */
  mapping?: PlanMappingContext;
  /** Each part's Onshape properties, read when the map is not empty. */
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
      // The CAD is the one the last push exported, but a mapped value or a
      // description in "everyPush" mode still has to reach Carbon.
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

/** `{ [key]: list }` when the list has entries, else `{}`. */
function nonEmpty<K extends string, T>(
  key: K,
  list: T[]
): Partial<Record<K, T[]>> {
  return list.length > 0 ? ({ [key]: list } as Record<K, T[]>) : {};
}

/**
 * The descriptions an assembly push overwrites on a reused item. Only values
 * Onshape gives are written: Name and Description are optional BOM columns,
 * so an empty cell may mean "no column", and must not blank Carbon's text.
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

// ---------------------------------------------------------------------------
// Assembly plan
// ---------------------------------------------------------------------------

export type AssemblyPlanItem = MappedRowPlan & {
  partNumber: string;
  name: string | null;
  revision: string | null;
  action: "create" | "reuse";
  itemId: string | null;
  /**
   * Reuse only, and set only when true: the Carbon item was found by part
   * number alone, with no link to this Onshape part. Equal numbers are not
   * proof of the same part, so the review warns before the push writes into it.
   */
  conflict?: boolean;
  /** Create only. */
  proposed: ProposedItem | null;
  /** Reuse only: the existing item's current manufacturing fields. */
  current?: ItemFieldSnapshot | null;
  /**
   * Reuse only, when the item is or becomes linked to this BOM row's Onshape
   * part: the descriptions in "everyPush" mode the push overwrites.
   */
  changes?: OwnedFieldChange[];
  /** Has children in the BOM: gets a make method and lines of its own. */
  isAssembly: boolean;
  /**
   * Onshape lists this sub-assembly as one unit ("Show Assembly only"), so the
   * push writes no BOM for it. Its Buy or Make comes from the precedence order.
   */
  shownAsUnit?: true;
};

export type AssemblyPlanMethodStatus =
  /** Existing Draft method: lines are applied. */
  | "draft"
  /** Existing released method. */
  | "active"
  /** The parent item will be created, so the method will be too. */
  | "new"
  /** Existing item without a make method: refused. */
  | "missing";

export type AssemblyPlanMethod = {
  parentPartNumber: string;
  parentItemId: string | null;
  status: AssemblyPlanMethodStatus;
  /**
   * `active` only: the version of the Draft an earlier push made from this
   * method, which this push writes into. Absent, the push creates a new Draft.
   */
  reusedDraftVersion?: number | null;
  /** Lines the push writes, in BOM order. */
  writes: Array<{
    index: string;
    partNumber: string;
    name: string | null;
    quantity: number;
  }>;
  /** Existing Onshape-origin lines a previous push wrote. */
  replaces: PlanLine[];
  /**
   * Lines added by hand for a part number Onshape's BOM also lists. The push
   * takes each over (Onshape's quantity, Carbon's operation and scrap kept)
   * instead of writing a second line for the same part beside it.
   */
  takesOver: Array<PlanLine & { onshapeQuantity: number }>;
  /** Lines added by hand for parts Onshape doesn't list: left untouched. */
  keeps: PlanLine[];
};

export type AssemblyPlanRoot = MappedRowPlan & {
  partNumber: string;
  name: string | null;
  description: string | null;
  revision: string | null;
  action: "create" | "reuse";
  itemId: string | null;
  /** As on {@link AssemblyPlanItem}: reused by part number alone. */
  conflict?: boolean;
  proposed: ProposedItem | null;
  /** Reuse only: the existing item's current manufacturing fields. */
  current?: ItemFieldSnapshot | null;
  /** Reuse only: the descriptions in "everyPush" mode the push overwrites. */
  changes?: OwnedFieldChange[];
};

/**
 * How far down the BOM a push writes.
 *
 * `all` explodes the whole tree: every sub-assembly gets its own make method
 * and its own lines, in one push.
 *
 * `top` writes ONE method — the root's — and treats each sub-assembly as an
 * item to create or reuse rather than a tree to explode. It exists because a
 * BOM line already points at its child's own make method
 * (`methodMaterial.materialMakeMethodId`), so a multi-level structure composes
 * from levels pushed separately. A push is then bounded by one level's line
 * count instead of by the whole tree.
 */
export type AssemblyPlanDepth = "all" | "top";

export type AssemblyPlan = {
  kind: "assembly";
  documentId: string;
  wv: "w" | "v";
  wvId: string;
  elementId: string;
  /** The assembly configuration the BOM was read in, null for the default. */
  configuration?: string | null;
  root: AssemblyPlanRoot;
  /** Every distinct BOM part number below the root. */
  items: AssemblyPlanItem[];
  methods: AssemblyPlanMethod[];
  /** BOM rows the push cannot place ("<name>: no part number in Onshape"). */
  skipped: string[];
  options: PlanOptions;
  depth: AssemblyPlanDepth;
  /** Only on a `top` plan: what this push is NOT writing. */
  deeper?: {
    /** Sub-assemblies directly under the root, each pushable on its own. */
    subAssemblies: string[];
    /** Distinct part numbers below the top level. */
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
  rootProperties = null
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
  /**
   * The item each `onshape-v2` item mapping points at, keyed by externalId —
   * the same join the status badges use. A reuse with no mapping to its own
   * item is a conflict. Omitted, every reuse is one.
   */
  linkedItemIdByExternalId?: Map<string, string>;
  /**
   * Existing items carrying any Onshape link. One linked elsewhere keeps that
   * link, so the push neither links it nor writes its descriptions. Omitted,
   * only items already linked to their BOM row get their descriptions written.
   */
  linkedItemIds?: ReadonlySet<string>;
  configuration?: string | null;
  /**
   * Per item whose method is Active, the Draft the push would reuse
   * (`loadReusableDrafts`), so the review counts that Draft's lines.
   */
  reusableDraftByItemId?: Map<string, { id: string; version: number | null }>;
  /** The company's property map; absent, only descriptions are planned. */
  mapping?: PlanMappingContext;
  /** The assembly's own properties (element metadata). BOM rows carry theirs. */
  rootProperties?: OnshapePropertyValue[] | null;
}): AssemblyPlan {
  // One row per part number: the latest revision, whatever order the rows
  // arrived in, so the plan pins the same item the apply would pick.
  const rowsByReadableId = new Map<string, PlanItemRow[]>();
  // Every item id → its part number, across all revisions. A link that points
  // at ANY revision of a part is still a link to that part (see below).
  const readableIdByItemId = new Map<string, string>();
  for (const item of items) {
    readableIdByItemId.set(item.id, item.readableId);
    const list = rowsByReadableId.get(item.readableId) ?? [];
    list.push(item);
    rowsByReadableId.set(item.readableId, list);
  }
  // The same pick the apply makes (`pickReuseRow`).
  const itemByReadableId = new Map<string, PlanItemRow>();
  for (const [readableId, rows] of rowsByReadableId) {
    const latest = pickReuseRow(rows);
    if (latest) itemByReadableId.set(readableId, latest);
  }
  const everything = flattenNodes(nodes);
  // At `top` depth only the root's own children become items: the rest of the
  // tree is somebody else's push. `everything` is still needed to describe
  // what is being left out.
  const all = depth === "top" ? nodes : everything;

  // A node with children is made, at every depth — a sub-assembly the push is
  // not exploding is still an assembly, and classifying it as bought
  // because this push declined to look inside it would be wrong.
  const madePartNumbers = new Set<string>([root.partNumber]);
  for (const node of everything) {
    if (node.partNumber && node.children.length > 0) {
      madePartNumbers.add(node.partNumber);
    }
  }

  // A part number is linked when any BOM row carrying it maps to an item that
  // IS that part number — any revision of it, not only the latest. A release
  // mints a higher revision and repoints the default to it while leaving the
  // part-studio mapping on the old revision; matching on the mapped item's own
  // part number (not id-identity with the latest revision) keeps that row
  // linked instead of flipping every released part to a false conflict. A row
  // with no source can never be linked, as in status.
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
  // The pushed assembly is always linked, so it takes "everyPush" values.
  const planRoot: AssemblyPlanRoot = rootItem
    ? {
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

  // Which BOM rows this push links to their Onshape part, the way apply's
  // `linkChildParts` decides: already linked to it, or neither the item nor
  // the source linked anywhere, with the source not shared by two numbers.
  const numbersBySource = new Map<string, Set<string>>();
  for (const node of everything) {
    const externalId = externalIdForBomLine(node.itemSource ?? null);
    if (!externalId || !node.partNumber) continue;
    const numbers = numbersBySource.get(externalId) ?? new Set<string>();
    numbers.add(node.partNumber);
    numbersBySource.set(externalId, numbers);
  }
  // An item the push links, or one linked to this row already, takes the
  // "everyPush" values. One linked to another source is left alone.
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
  // Part numbers whose Carbon item can never be a BOM line (a Tool, say):
  // shown as skipped here so the apply's refusal is no surprise.
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
          // A sub-assembly this push does not explode is still made.
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
    // A released method is written through a Draft: the reused one's lines,
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
    // Each write carries the type of the item it will point at (a new item
    // is a Part), so a hand-added line for another item sharing the number
    // is kept rather than taken over.
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
    methods.push({
      parentPartNumber,
      parentItemId,
      status,
      ...(reusedDraft ? { reusedDraftVersion: reusedDraft.version } : {}),
      writes,
      replaces,
      takesOver,
      keeps
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
    // One method: the root's. `addMethod` recursed into the children, so drop
    // everything it added below the top.
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

// ---------------------------------------------------------------------------
// Release plan
// ---------------------------------------------------------------------------

export type ReleasePlanItemAction =
  /** An item already exists at the released letter. */
  | "reuse"
  /** A new revision is created from the existing item. */
  | "revision"
  /** The part number was never in Carbon: a new item at the letter. */
  | "create"
  /** A released drawing that attaches to a model item of the same number. */
  | "drawing"
  /** A released drawing with no model item to attach to. */
  | "drawing-unmatched";

export type ReleasePlanItem = MappedRowPlan & {
  partNumber: string;
  revision: string;
  elementType: number;
  elementId: string;
  versionId: string;
  /**
   * Part Studio items: the released part. The export translates exactly this
   * part, so an item without one is not exported.
   */
  partId?: string | null;
  /** The released configuration, null for the default. */
  configuration?: string | null;
  action: ReleasePlanItemAction;
  baseItemId: string | null;
  baseRevision: string | null;
  existingItemId: string | null;
  /** Create only. */
  proposed: ProposedItem | null;
  /**
   * reuse/revision only: the manufacturing fields the target item currently
   * has — the reused letter item, or the base a revision is copied from (the
   * new revision inherits them). Seeds the editor; only changes are sent.
   */
  current?: ItemFieldSnapshot | null;
  /** reuse/revision only: the descriptions in "everyPush" mode it takes. */
  changes?: OwnedFieldChange[];
  /**
   * Released assemblies only: whether the BOM can be applied to the target
   * method. A reused item with a released (Active) method is refused.
   */
  methodStatus: "draft" | "active" | "new" | "missing" | null;
};

/** A BOM child of a released assembly that is not itself in the release. */
export type ReleasePlanChild = MappedRowPlan & {
  partNumber: string;
  name: string | null;
  revision: string | null;
  action: "create" | "reuse";
  itemId: string | null;
  proposed: ProposedItem | null;
  /** Reuse only: the existing item's current manufacturing fields. */
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
  /** Null when nothing new is created (re-push): no change notice then. */
  changeNotice: { name: string; description: string | null } | null;
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
  propertiesByPartNumber
}: {
  documentId: string;
  release: PanelRelease;
  /** Every Carbon revision row for the release's and the BOMs' part numbers. */
  items: PlanItemRow[];
  /**
   * Top-level BOM lines per released assembly element, read at its version;
   * null when the read failed (the apply then leaves that method alone).
   */
  bomLinesByElementId: Record<string, OnshapeBomNode[] | null>;
  methodByItemId: Map<string, PlanMethodRow>;
  options: PlanOptions;
  /** The company's property map; absent, only descriptions are planned. */
  mapping?: PlanMappingContext;
  /**
   * Each released model item's properties at its released version, by part
   * number. BOM children carry theirs on the BOM row.
   */
  propertiesByPartNumber?: ReadonlyMap<string, OnshapePropertyValue[]>;
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
  // A reused letter and a new revision's base are existing items: the new
  // revision copies the base, then takes the "everyPush" values.
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

  // Names for release-created items come from the BOM rows that reference
  // them; the revisions list only carries part numbers.
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
      planItems.push({
        ...releaseIdentity(item),
        action: modelPartNumbers.has(item.partNumber)
          ? "drawing"
          : "drawing-unmatched",
        baseItemId: null,
        baseRevision: null,
        existingItemId: null,
        proposed: null,
        methodStatus: null
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

    const bases = byReadable.get(item.partNumber) ?? [];
    const latestBase = pickLatestRow(bases);
    if (latestBase) {
      const base = latestBase;
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

  // Level-1 BOM children that are not release items: reused when Carbon has
  // any revision of them (bought hardware), created otherwise. A reused child
  // is not linked by the release, so it takes no mapped value.
  const children: ReleasePlanChild[] = [];
  const childSeen = new Set<string>();
  for (const lines of Object.values(bomLinesByElementId)) {
    for (const node of lines ?? []) {
      if (!node.partNumber || modelPartNumbers.has(node.partNumber)) continue;
      if (childSeen.has(node.partNumber)) continue;
      childSeen.add(node.partNumber);
      const existing = pickLatestRow(byReadable.get(node.partNumber) ?? []);
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

  // The change notice records the release items the push creates — the apply
  // writes one affected row per created revision or item, and none for BOM
  // children — so only those propose one.
  const createsReleaseItems = planItems.some(
    (item) => item.action === "revision" || item.action === "create"
  );
  // "Already pushed" is broader: a release whose items are all in Carbon can
  // still mint a missing BOM child.
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
    // The engineer already named the release, so that name carries over.
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

/** A text property's value ("Name", "Description"); null when empty. */
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

// ---------------------------------------------------------------------------
// Apply-time helpers shared by the push routes
// ---------------------------------------------------------------------------

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

/**
 * changeOrder.description is a tiptap document, not text: wrap the plan's
 * free text the way the ERP's own New Change Notice form does.
 */
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

/**
 * Merge edits for every create in a plan at once, keyed the way the plan is
 * (partId for parts, part number for assemblies and releases). Returns the
 * merged item per key, or the first error per key.
 */
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
