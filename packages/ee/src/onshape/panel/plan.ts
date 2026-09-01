import type { OnshapeElementPart } from "../lib/client";
import type { OnshapeBomNode } from "./bom";
import type { PlanCustomField, UnmappedProperty } from "./properties";
import type { PanelRelease, PanelReleaseItem } from "./releases";
import { isModelReleaseItem } from "./releases";
import { externalIdForPart } from "./status";

/**
 * Plan / apply for the panel's pushes.
 *
 * A push used to read Onshape, decide and write in one request. It is now two:
 * PLAN reads Onshape and Carbon and returns what would happen — every item it
 * would create with the values it would use, every BOM line it would replace
 * or leave alone — and APPLY consumes that plan (stored server-side, plus the
 * user's edits and deselections) without reading Onshape again. The builders
 * here are pure so the decision a user reviewed is the decision that runs.
 *
 * Editable at CREATE only. Onshape owns identity (part number, revision) and,
 * once an item is linked, its name and description — an update never takes
 * edits, so the owned-field lock on the item page stays true.
 */

// Enum literals from packages/database (item.replenishmentSystem,
// item.defaultMethodType, item.itemTrackingType). Item type stays "Part":
// other types are created through other services and tables.
export const ITEM_REPLENISHMENT_SYSTEMS = [
  "Buy",
  "Make",
  "Buy and Make"
] as const;
export const ITEM_METHOD_TYPES = [
  "Make to Order",
  "Pull from Inventory",
  "Purchase to Order"
] as const;
export const ITEM_TRACKING_TYPES = [
  "Inventory",
  "Non-Inventory",
  "Serial",
  "Batch"
] as const;

export type ItemReplenishmentSystem =
  (typeof ITEM_REPLENISHMENT_SYSTEMS)[number];
export type ItemMethodType = (typeof ITEM_METHOD_TYPES)[number];
export type ItemTrackingType = (typeof ITEM_TRACKING_TYPES)[number];

/**
 * The ERP's interlock between replenishment and default method
 * (`validMethodTypesByReplenishment` in apps/erp shared.models — duplicated
 * here because @carbon/ee cannot import the app). A plan never proposes, and
 * apply never accepts, a pair the Part form itself would refuse.
 */
export const VALID_METHOD_TYPES_BY_REPLENISHMENT: Record<
  ItemReplenishmentSystem,
  readonly ItemMethodType[]
> = {
  Buy: ["Pull from Inventory", "Purchase to Order"],
  Make: ["Pull from Inventory", "Make to Order"],
  "Buy and Make": ["Pull from Inventory", "Purchase to Order"]
};

export const ITEM_NAME_MAX_LENGTH = 255;
export const ITEM_DESCRIPTION_MAX_LENGTH = 2000;

export type PlanUnitOfMeasure = { code: string; name: string };
export type PlanOptions = { unitsOfMeasure: PlanUnitOfMeasure[] };

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
> & {
  /**
   * Edits to mapped custom fields, keyed by Carbon field id. Only
   * `default`-mode fields accept one (see panel/properties.ts).
   */
  customFields?: Record<string, unknown>;
};

export type PlanMappingRow = {
  entityId: string;
  externalId: string | null;
  lastSyncedAt: string | null;
  metadata?: Record<string, unknown> | null;
};

export type PlanItemRow = {
  id: string;
  readableId: string;
  revision: string;
  name: string;
  description?: string | null;
  /** item.type — Part, Material, Consumable, … */
  type?: string | null;
  defaultMethodType?: string | null;
  unitOfMeasureCode?: string | null;
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
 * copied from. Order-independent (string compare on the letter, which is the
 * ERP's own revision order), so plan and apply agree whatever the query
 * returned.
 */
export function pickLatestRow<T extends { revision: string | null }>(
  rows: T[]
): T | undefined {
  let latest: T | undefined;
  for (const row of rows) {
    if (!latest || (row.revision ?? "") > (latest.revision ?? "")) latest = row;
  }
  return latest;
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
};

// ---------------------------------------------------------------------------
// Proposals and edits
// ---------------------------------------------------------------------------

/** "EA" when the company has it, else its first unit — never a code it lacks. */
export function defaultUnitOfMeasureCode(options: PlanOptions): string {
  const codes = options.unitsOfMeasure.map((u) => u.code);
  if (codes.includes("EA")) return "EA";
  return codes[0] ?? "EA";
}

/**
 * The item a push would create for an Onshape part, assembly or BOM row, with
 * the defaults the routes used to hardcode: designed in-house → Make / Make to
 * Order; a purchased BOM row → Buy / Pull from Inventory.
 */
export function proposeItem(
  input: {
    partNumber: string;
    name: string | null;
    description?: string | null;
    revision?: string | null;
    purchased?: boolean;
  },
  options: PlanOptions
): ProposedItem {
  const purchased = input.purchased === true;
  const name = (input.name ?? "").trim();
  const description = (input.description ?? "").trim();
  return {
    readableId: input.partNumber,
    revision: (input.revision ?? "").trim() || "0",
    name: name === "" ? input.partNumber : name,
    description: description === "" ? null : description,
    replenishmentSystem: purchased ? "Buy" : "Make",
    defaultMethodType: purchased ? "Pull from Inventory" : "Make to Order",
    itemTrackingType: "Inventory",
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
// Part plan
// ---------------------------------------------------------------------------

export type PartPlanAction =
  | "create"
  | "adopt"
  | "update"
  | "unchanged"
  | "skip-no-part-number";

export type PartPlanRow = {
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
  /** Update only: Onshape-owned fields the push will overwrite. */
  changes: Array<{
    field: "name" | "description";
    from: string | null;
    to: string | null;
  }>;
  /** Mapped custom fields apply would write (absent when nothing is mapped). */
  customFields?: PlanCustomField[];
  /** Valued Onshape properties no map entry covers — review shows "not mapped". */
  unmappedProperties?: UnmappedProperty[];
  /** Mapped properties whose value cannot coerce; shown, never written. */
  customFieldProblems?: string[];
};

export type PartPlan = {
  kind: "part";
  documentId: string;
  wv: "w" | "v";
  wvId: string;
  elementId: string;
  rows: PartPlanRow[];
  options: PlanOptions;
};

export function buildPartPlan({
  documentId,
  elementId,
  parts,
  requestedPartIds,
  mappings,
  items,
  options
}: {
  documentId: string;
  elementId: string;
  parts: OnshapeElementPart[];
  requestedPartIds: string[];
  mappings: PlanMappingRow[];
  items: PlanItemRow[];
  options: PlanOptions;
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

    const mapping = mappingByExternalId.get(
      externalIdForPart(documentId, elementId, partId)
    );
    // A mapping whose item is gone is not a link (entityId has no FK).
    const linked = mapping ? itemById.get(mapping.entityId) : undefined;
    if (mapping && linked) {
      const lastMicroversion = mapping.metadata?.microversionId;
      const unchanged =
        !!part.microversionId &&
        typeof lastMicroversion === "string" &&
        part.microversionId === lastMicroversion;
      rows.push({
        ...base,
        action: unchanged ? "unchanged" : "update",
        itemId: linked.id,
        item: {
          readableId: linked.readableId,
          revision: linked.revision,
          name: linked.name
        },
        changes: unchanged ? [] : ownedFieldChanges(linked, part)
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
        action: "adopt",
        itemId: matched.id,
        item: {
          readableId: matched.readableId,
          revision: matched.revision,
          name: matched.name
        },
        changes: ownedFieldChanges(matched, part)
      });
      continue;
    }

    rows.push({
      ...base,
      action: "create",
      proposed: proposeItem(
        {
          partNumber: part.partNumber,
          name: part.name,
          description: part.description ?? null,
          revision: part.revision ?? null
        },
        options
      )
    });
  }
  return rows;
}

function ownedFieldChanges(
  item: PlanItemRow,
  part: Pick<OnshapeElementPart, "name" | "description">
): PartPlanRow["changes"] {
  const changes: PartPlanRow["changes"] = [];
  const toName = part.name;
  if ((item.name ?? null) !== toName) {
    changes.push({ field: "name", from: item.name ?? null, to: toName });
  }
  const toDescription = part.description ?? null;
  if (
    item.description !== undefined &&
    (item.description ?? null) !== toDescription
  ) {
    changes.push({
      field: "description",
      from: item.description ?? null,
      to: toDescription
    });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Assembly plan
// ---------------------------------------------------------------------------

export type AssemblyPlanItem = {
  partNumber: string;
  name: string | null;
  revision: string | null;
  action: "create" | "reuse";
  itemId: string | null;
  /** Create only. */
  proposed: ProposedItem | null;
  /** Has children in the BOM: gets a make method and lines of its own. */
  isAssembly: boolean;
  purchased: boolean;
};

export type AssemblyPlanMethodStatus =
  /** Existing Draft method: lines are applied. */
  | "draft"
  /** Existing released method: refused, lines are not applied. */
  | "active"
  /** The parent item will be created, so the method will be too. */
  | "new"
  /** Existing item without a make method: refused. */
  | "missing";

export type AssemblyPlanMethod = {
  parentPartNumber: string;
  parentItemId: string | null;
  status: AssemblyPlanMethodStatus;
  /** Lines the push writes, in BOM order. */
  writes: Array<{
    index: string;
    partNumber: string;
    name: string | null;
    quantity: number;
    purchased: boolean;
  }>;
  /** Existing Onshape-origin lines a previous push wrote: deleted first. */
  replaces: PlanLine[];
  /** Existing lines no push wrote (manual): left untouched. */
  keeps: PlanLine[];
};

export type AssemblyPlanRoot = {
  partNumber: string;
  name: string | null;
  description: string | null;
  revision: string | null;
  action: "create" | "reuse";
  itemId: string | null;
  proposed: ProposedItem | null;
  /** Mapped custom fields for the root item (element properties). */
  customFields?: PlanCustomField[];
  unmappedProperties?: UnmappedProperty[];
  customFieldProblems?: string[];
};

export type AssemblyPlan = {
  kind: "assembly";
  documentId: string;
  wv: "w" | "v";
  wvId: string;
  elementId: string;
  root: AssemblyPlanRoot;
  /** Every distinct BOM part number below the root. */
  items: AssemblyPlanItem[];
  methods: AssemblyPlanMethod[];
  /** BOM rows the push cannot place ("<name>: no part number in Onshape"). */
  skipped: string[];
  options: PlanOptions;
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
  options
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
}): AssemblyPlan {
  // One row per part number: the latest revision, whatever order the rows
  // arrived in, so the plan pins the same item the apply would pick.
  const itemByReadableId = new Map<string, PlanItemRow>();
  for (const item of items) {
    const current = itemByReadableId.get(item.readableId);
    if (!current || (item.revision ?? "") > (current.revision ?? "")) {
      itemByReadableId.set(item.readableId, item);
    }
  }
  const all = flattenNodes(nodes);

  const madePartNumbers = new Set<string>([root.partNumber]);
  for (const node of all) {
    if (node.partNumber && node.children.length > 0) {
      madePartNumbers.add(node.partNumber);
    }
  }

  const rootItem = itemByReadableId.get(root.partNumber);
  const planRoot: AssemblyPlanRoot = {
    partNumber: root.partNumber,
    name: root.name,
    description: root.description,
    revision: root.revision,
    action: rootItem ? "reuse" : "create",
    itemId: rootItem?.id ?? null,
    proposed: rootItem
      ? null
      : proposeItem(
          {
            partNumber: root.partNumber,
            name: root.name,
            description: root.description,
            revision: root.revision,
            purchased: false
          },
          options
        )
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
    const made = madePartNumbers.has(node.partNumber) || !node.purchased;
    planItems.push({
      partNumber: node.partNumber,
      name: node.name,
      revision: node.revision,
      action: existing ? "reuse" : "create",
      itemId: existing?.id ?? null,
      proposed: existing
        ? null
        : proposeItem(
            {
              partNumber: node.partNumber,
              name: node.name,
              description: node.description,
              revision: node.revision,
              purchased: !made
            },
            options
          ),
      isAssembly: node.children.length > 0,
      purchased: node.purchased
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
    methods.push({
      parentPartNumber,
      parentItemId,
      status,
      writes: children
        .filter(
          (child) => !!child.partNumber && !unusable.has(child.partNumber)
        )
        .map((child) => ({
          index: child.index,
          partNumber: child.partNumber as string,
          name: child.name,
          quantity: child.quantity,
          purchased: child.purchased
        })),
      replaces: method ? (mappedLinesByMethodId.get(method.id) ?? []) : [],
      keeps: method ? (manualLinesByMethodId.get(method.id) ?? []) : []
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

  return {
    kind: "assembly",
    documentId,
    wv,
    wvId,
    elementId,
    root: planRoot,
    items: planItems,
    methods,
    skipped,
    options
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

export type ReleasePlanItem = {
  partNumber: string;
  revision: string;
  elementType: number;
  elementId: string;
  versionId: string;
  action: ReleasePlanItemAction;
  baseItemId: string | null;
  baseRevision: string | null;
  existingItemId: string | null;
  /** Create only. */
  proposed: ProposedItem | null;
  /**
   * Released assemblies only: whether the BOM can be applied to the target
   * method. A reused item with a released (Active) method is refused.
   */
  methodStatus: "draft" | "active" | "new" | "missing" | null;
};

/** A BOM child of a released assembly that is not itself in the release. */
export type ReleasePlanChild = {
  partNumber: string;
  name: string | null;
  revision: string | null;
  purchased: boolean;
  action: "create" | "reuse";
  itemId: string | null;
  proposed: ProposedItem | null;
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
  options
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
}): ReleasePlan {
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
    const existingLetter = letterRowFor(item.partNumber, item.revision);
    if (existingLetter) {
      const method = methodByItemId.get(existingLetter.id);
      planItems.push({
        ...releaseIdentity(item),
        action: "reuse",
        baseItemId: null,
        baseRevision: null,
        existingItemId: existingLetter.id,
        proposed: null,
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
        action: "revision",
        baseItemId: base.id,
        baseRevision: base.revision,
        existingItemId: null,
        proposed: null,
        methodStatus: isAssembly ? "new" : null
      });
      continue;
    }

    const node = bomNodeByPartNumber.get(item.partNumber);
    planItems.push({
      ...releaseIdentity(item),
      action: "create",
      baseItemId: null,
      baseRevision: null,
      existingItemId: null,
      proposed: proposeItem(
        {
          partNumber: item.partNumber,
          name: node?.name ?? null,
          description: node?.description ?? null,
          revision: item.revision,
          purchased: false
        },
        options
      ),
      methodStatus: isAssembly ? "new" : null
    });
  }

  // Level-1 BOM children that are not release items: reused when Carbon has
  // any revision of them (purchased hardware), created otherwise.
  const children: ReleasePlanChild[] = [];
  const childSeen = new Set<string>();
  for (const lines of Object.values(bomLinesByElementId)) {
    for (const node of lines ?? []) {
      if (!node.partNumber || modelPartNumbers.has(node.partNumber)) continue;
      if (childSeen.has(node.partNumber)) continue;
      childSeen.add(node.partNumber);
      const existing = pickLatestRow(byReadable.get(node.partNumber) ?? []);
      children.push({
        partNumber: node.partNumber,
        name: node.name,
        revision: node.revision,
        purchased: node.purchased,
        action: existing ? "reuse" : "create",
        itemId: existing?.id ?? null,
        proposed: existing
          ? null
          : proposeItem(
              {
                partNumber: node.partNumber,
                name: node.name,
                description: node.description,
                revision: node.revision,
                purchased: node.purchased
              },
              options
            )
      });
    }
  }

  const createsAnything = planItems.some(
    (item) => item.action === "revision" || item.action === "create"
  );

  return {
    kind: "release",
    documentId,
    releaseId: release.releaseId,
    releaseName: release.releaseName,
    createdAt: release.createdAt,
    items: planItems,
    children,
    changeNotice: createsAnything
      ? {
          // The engineer already named the release; a prefix would only
          // double the word ("Onshape release Release WB-100 A").
          name: release.releaseName ?? `Onshape release ${release.releaseId}`,
          description: null
        }
      : null,
    makeDefault: true,
    alreadyPushed: !createsAnything,
    options
  };
}

function releaseIdentity(item: PanelReleaseItem) {
  return {
    partNumber: item.partNumber,
    revision: item.revision,
    elementType: item.elementType,
    elementId: item.elementId,
    versionId: item.versionId
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
