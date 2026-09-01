import type {
  AssemblyPlan,
  AssemblyPlanMethod,
  ChangeNoticeEdit,
  ItemEdit,
  ItemMethodType,
  PartPlan,
  PartPlanRow,
  ProposedItem,
  ReleasePlan
} from "./plan";
import {
  ITEM_METHOD_TYPES,
  ITEM_REPLENISHMENT_SYSTEMS,
  ITEM_TRACKING_TYPES,
  VALID_METHOD_TYPES_BY_REPLENISHMENT
} from "./plan";
import type { PlanCustomField } from "./properties";
import { BOOLEAN_TRUE, CUSTOM_FIELD_DATA_TYPES } from "./properties";
import type { PanelPartStatus } from "./status";

/**
 * The panel's review state: a stored plan plus what the user changed before
 * applying it. Everything here is pure so the transitions the panel makes
 * between "plan came back" and "apply request goes out" can be tested without
 * React. Panel.tsx owns the fetches; this file owns the shape of what they
 * send and receive.
 *
 * Edits are sparse — `edits[key]` holds only the fields that differ from the
 * plan's proposal — so the apply body says exactly what the user changed and
 * an untouched row sends nothing. The key is the plan's own: partId for
 * parts, part number for assemblies and releases.
 */

export type EditableItemField =
  | "name"
  | "description"
  | "replenishmentSystem"
  | "defaultMethodType"
  | "itemTrackingType"
  | "unitOfMeasureCode";

type ReviewBase = {
  planId: string;
  expiresAt: string;
  /**
   * The Onshape context the plan was built for (element for parts and
   * assemblies, document for releases). A review whose scope no longer
   * matches the panel's context is dropped: the stored plan describes
   * another element.
   */
  scope: string;
  edits: Record<string, ItemEdit>;
  applying: boolean;
  error: string | null;
  /** Per-row validation errors from a 422, keyed like `edits`. */
  fieldErrors: Record<string, string[]>;
  /** The stored plan is gone (410): only "Review again" can continue. */
  expired: boolean;
};

export type PartReview = ReviewBase & {
  kind: "part";
  plan: PartPlan;
  selected: Set<string>;
};

export type AssemblyReview = ReviewBase & {
  kind: "assembly";
  plan: AssemblyPlan;
  excluded: Set<string>;
};

export type ReleaseReview = ReviewBase & {
  kind: "release";
  plan: ReleasePlan;
  changeNotice: ChangeNoticeEdit | null;
  makeDefault: boolean;
  /** Assemblies whose BOM the plan could not read; their lines are empty. */
  warnings: string[];
};

export type ReviewState = PartReview | AssemblyReview | ReleaseReview;

/**
 * Rows a part review ticks by default: the ones a push would act on. An
 * `unchanged` row is shown for context and left unticked so the button count
 * is the number of items the apply touches; a row without a part number
 * cannot be pushed at all.
 */
export function defaultSelectedPartIds(rows: PartPlanRow[]): Set<string> {
  return new Set(
    rows
      .filter(
        (row) =>
          row.action === "create" ||
          row.action === "adopt" ||
          row.action === "update"
      )
      .map((row) => row.partId)
  );
}

export function createReview(input: {
  planId: string;
  expiresAt: string;
  scope: string;
  plan: PartPlan | AssemblyPlan | ReleasePlan;
  warnings?: string[];
}): ReviewState {
  const base: ReviewBase = {
    planId: input.planId,
    expiresAt: input.expiresAt,
    scope: input.scope,
    edits: {},
    applying: false,
    error: null,
    fieldErrors: {},
    expired: false
  };
  const plan = input.plan;
  switch (plan.kind) {
    case "part":
      return {
        ...base,
        kind: "part",
        plan,
        selected: defaultSelectedPartIds(plan.rows)
      };
    case "assembly":
      return { ...base, kind: "assembly", plan, excluded: new Set() };
    case "release":
      return {
        ...base,
        kind: "release",
        plan,
        changeNotice: plan.changeNotice ? { ...plan.changeNotice } : null,
        makeDefault: plan.makeDefault,
        warnings: input.warnings ?? []
      };
  }
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/** The proposal with the user's edits laid over it — what the editor shows. */
export function editedItem(
  proposed: ProposedItem,
  edit: ItemEdit | undefined
): ProposedItem {
  if (!edit) return proposed;
  const item: ProposedItem = { ...proposed };
  if (edit.name !== undefined) item.name = edit.name;
  if (edit.description !== undefined) item.description = edit.description;
  if (edit.replenishmentSystem !== undefined)
    item.replenishmentSystem = edit.replenishmentSystem;
  if (edit.defaultMethodType !== undefined)
    item.defaultMethodType = edit.defaultMethodType;
  if (edit.itemTrackingType !== undefined)
    item.itemTrackingType = edit.itemTrackingType;
  if (edit.unitOfMeasureCode !== undefined)
    item.unitOfMeasureCode = edit.unitOfMeasureCode;
  return item;
}

function isOneOf<T extends string>(
  list: readonly T[],
  value: string
): value is T {
  return (list as readonly string[]).includes(value);
}

/** Only the fields where `next` departs from the proposal. */
function diffItem(proposed: ProposedItem, next: ProposedItem): ItemEdit {
  const edit: ItemEdit = {};
  if (next.name !== proposed.name) edit.name = next.name;
  if (next.description !== proposed.description)
    edit.description = next.description;
  if (next.replenishmentSystem !== proposed.replenishmentSystem)
    edit.replenishmentSystem = next.replenishmentSystem;
  if (next.defaultMethodType !== proposed.defaultMethodType)
    edit.defaultMethodType = next.defaultMethodType;
  if (next.itemTrackingType !== proposed.itemTrackingType)
    edit.itemTrackingType = next.itemTrackingType;
  if (next.unitOfMeasureCode !== proposed.unitOfMeasureCode)
    edit.unitOfMeasureCode = next.unitOfMeasureCode;
  return edit;
}

/**
 * Record one field change for one row, keeping `edits` sparse: a value typed
 * back to the proposal drops out of the edit, and an edit with nothing left
 * drops out of the record. Text is stored as typed — the server trims — so a
 * trailing space survives while the user is still writing the next word; an
 * empty description means "none", as the proposal itself encodes it.
 *
 * Changing the replenishment system re-checks the ERP's interlock: when the
 * current default method is not allowed for the new system, the method moves
 * to the first allowed one, the same coercion the Part form applies. An enum
 * value the plan does not know is ignored rather than sent to be refused.
 */
export function applyItemEdit(
  edits: Record<string, ItemEdit>,
  key: string,
  proposed: ProposedItem,
  field: EditableItemField,
  value: string
): Record<string, ItemEdit> {
  const next: ProposedItem = { ...editedItem(proposed, edits[key]) };
  switch (field) {
    case "name":
      next.name = value;
      break;
    case "description":
      next.description = value === "" ? null : value;
      break;
    case "replenishmentSystem": {
      if (!isOneOf(ITEM_REPLENISHMENT_SYSTEMS, value)) return edits;
      next.replenishmentSystem = value;
      const allowed = VALID_METHOD_TYPES_BY_REPLENISHMENT[value];
      const [first] = allowed;
      if (first && !allowed.includes(next.defaultMethodType)) {
        next.defaultMethodType = first;
      }
      break;
    }
    case "defaultMethodType":
      if (!isOneOf(ITEM_METHOD_TYPES, value)) return edits;
      next.defaultMethodType = value;
      break;
    case "itemTrackingType":
      if (!isOneOf(ITEM_TRACKING_TYPES, value)) return edits;
      next.itemTrackingType = value;
      break;
    case "unitOfMeasureCode":
      next.unitOfMeasureCode = value;
      break;
  }

  const edit = diffItem(proposed, next);
  // Custom-field edits live on the same entry (applyCustomFieldEdit): an
  // item field typed back to the proposal must not drop them with its diff.
  const customFields = edits[key]?.customFields;
  if (customFields && Object.keys(customFields).length > 0) {
    edit.customFields = customFields;
  }
  const out: Record<string, ItemEdit> = { ...edits };
  if (Object.keys(edit).length === 0) delete out[key];
  else out[key] = edit;
  return out;
}

/**
 * The plan's value as the editor's input string. A Yes/No field holds what
 * the ERP's checkbox posts — BOOLEAN_TRUE when ticked and nothing at all
 * otherwise (properties.ts) — so an unticked one reads as unset, not "no".
 */
export function customFieldInputValue(
  field: Pick<PlanCustomField, "value" | "dataTypeId">
): string {
  if (field.dataTypeId === CUSTOM_FIELD_DATA_TYPES.boolean) {
    return field.value === BOOLEAN_TRUE || field.value === true ? "yes" : "";
  }
  if (field.value === null) return "";
  if (typeof field.value === "boolean") return field.value ? "yes" : "no";
  return String(field.value);
}

/** What a field's editor shows: the typed edit when present, else the plan. */
export function customFieldEditValue(
  field: PlanCustomField,
  customFields: Record<string, unknown> | null | undefined
): string {
  const raw = customFields?.[field.fieldId];
  return typeof raw === "string" ? raw : customFieldInputValue(field);
}

/**
 * A mapped value as review text; "—" when nothing will be written. A Yes/No
 * field stores BOOLEAN_TRUE or no key, so the raw "on" never reaches the
 * review text.
 */
export function customFieldDisplayValue(
  field: Pick<PlanCustomField, "value" | "dataTypeId">
): string {
  if (field.dataTypeId === CUSTOM_FIELD_DATA_TYPES.boolean) {
    return field.value === BOOLEAN_TRUE || field.value === true ? "Yes" : "—";
  }
  if (field.value === null) return "—";
  if (typeof field.value === "boolean") return field.value ? "Yes" : "No";
  return String(field.value);
}

/**
 * Record one custom-field change for one row, sparse like applyItemEdit: a
 * value typed back to the plan's drops out, and an entry with nothing left
 * drops out of the record. Only `default`-mode fields of the reviewed plan
 * take an edit — an owned value is Onshape's, and the server refuses the
 * edit anyway (mergeCustomFieldEdits). Values stay the strings the inputs
 * produce; the server coerces them against the field's type at apply.
 */
export function applyCustomFieldEdit(
  edits: Record<string, ItemEdit>,
  key: string,
  fields: PlanCustomField[],
  fieldId: string,
  value: string
): Record<string, ItemEdit> {
  const field = fields.find((f) => f.fieldId === fieldId);
  if (!field || field.mode === "owned") return edits;
  const customFields = { ...edits[key]?.customFields };
  if (value === customFieldInputValue(field)) delete customFields[fieldId];
  else customFields[fieldId] = value;
  const entry: ItemEdit = { ...edits[key] };
  if (Object.keys(customFields).length === 0) delete entry.customFields;
  else entry.customFields = customFields;
  const out: Record<string, ItemEdit> = { ...edits };
  if (Object.keys(entry).length === 0) delete out[key];
  else out[key] = entry;
  return out;
}

/** The method choices the editor offers for the current replenishment. */
export function methodTypesFor(
  item: Pick<ProposedItem, "replenishmentSystem">
): readonly ItemMethodType[] {
  return VALID_METHOD_TYPES_BY_REPLENISHMENT[item.replenishmentSystem];
}

/** A new Set with `key` present or absent — state is never mutated. */
export function withMember(
  set: Set<string>,
  key: string,
  present: boolean
): Set<string> {
  const next = new Set(set);
  if (present) next.add(key);
  else next.delete(key);
  return next;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export type PartApplyBody = {
  planId: string;
  selected: string[];
  edits: Record<string, ItemEdit>;
};

export type AssemblyApplyBody = {
  planId: string;
  edits: Record<string, ItemEdit>;
  excluded: string[];
};

export type ReleaseApplyBody = {
  planId: string;
  edits: Record<string, ItemEdit>;
  changeNotice: ChangeNoticeEdit | null;
  makeDefault: boolean;
};

function pickEdits(
  edits: Record<string, ItemEdit>,
  keys: Iterable<string>
): Record<string, ItemEdit> {
  const out: Record<string, ItemEdit> = {};
  for (const key of keys) {
    const edit = edits[key];
    if (edit) out[key] = edit;
  }
  return out;
}

/**
 * The apply request for a review. Edits travel only for rows the server will
 * merge — selected or included creates — so a row the user edited and then
 * deselected sends nothing, and a reuse row can never carry an edit.
 */
export function applyRequestBody(
  review: ReviewState
): PartApplyBody | AssemblyApplyBody | ReleaseApplyBody {
  switch (review.kind) {
    case "part": {
      const selected = review.plan.rows
        .filter((row) => review.selected.has(row.partId))
        .map((row) => row.partId);
      const createKeys = review.plan.rows
        .filter(
          (row) => row.action === "create" && review.selected.has(row.partId)
        )
        .map((row) => row.partId);
      return {
        planId: review.planId,
        selected,
        edits: pickEdits(review.edits, createKeys)
      };
    }
    case "assembly": {
      const keys: string[] = [];
      if (review.plan.root.action === "create") {
        keys.push(review.plan.root.partNumber);
      }
      for (const item of review.plan.items) {
        if (item.action === "create" && !review.excluded.has(item.partNumber)) {
          keys.push(item.partNumber);
        }
      }
      return {
        planId: review.planId,
        edits: pickEdits(review.edits, keys),
        excluded: [...review.excluded]
      };
    }
    case "release": {
      const keys: string[] = [];
      for (const item of review.plan.items) {
        if (item.action === "create") keys.push(item.partNumber);
      }
      for (const child of review.plan.children) {
        if (child.action === "create") keys.push(child.partNumber);
      }
      return {
        planId: review.planId,
        edits: pickEdits(review.edits, keys),
        changeNotice: review.plan.changeNotice ? review.changeNotice : null,
        makeDefault: review.makeDefault
      };
    }
  }
}

/** How many Carbon items the apply will touch — the number on the button. */
export function applyCount(review: ReviewState): number {
  switch (review.kind) {
    case "part":
      return review.selected.size;
    case "assembly":
      return (
        1 +
        review.plan.items.filter(
          (item) => !review.excluded.has(item.partNumber)
        ).length
      );
    case "release":
      return (
        review.plan.items.filter(
          (item) =>
            item.action === "reuse" ||
            item.action === "revision" ||
            item.action === "create"
        ).length + review.plan.children.length
      );
  }
}

export type ApplyFieldError = { key: string; errors: string[] };

export function indexFieldErrors(
  list: ApplyFieldError[] | null | undefined
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const entry of list ?? []) {
    if (entry && typeof entry.key === "string" && Array.isArray(entry.errors)) {
      out[entry.key] = entry.errors.map(String);
    }
  }
  return out;
}

/** Errors for `key` are stale once the user edits that row again. */
export function clearFieldErrors(
  fieldErrors: Record<string, string[]>,
  key: string
): Record<string, string[]> {
  if (!(key in fieldErrors)) return fieldErrors;
  const out = { ...fieldErrors };
  delete out[key];
  return out;
}

/**
 * plan-release reports assemblies whose BOM could not be read (their lines
 * are stored empty rather than failing the plan). The panel renders them as
 * text: strings pass through, an object with a string `message` contributes
 * that, anything else is dropped rather than shown as "[object Object]".
 */
export function normalizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      out.push(entry);
      continue;
    }
    if (entry && typeof entry === "object") {
      const message = (entry as { message?: unknown }).message;
      if (typeof message === "string") out.push(message);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

export type MethodDescription = {
  text: string;
  tone: "normal" | "muted" | "destructive";
};

/**
 * One line per make method in the assembly review. Counts reflect the user's
 * exclusions: an excluded child is not written, and a method whose parent is
 * excluded is not applied at all because the parent item will not exist.
 */
export function describeMethod(
  method: AssemblyPlanMethod,
  excluded: Set<string>
): MethodDescription {
  const parent = method.parentPartNumber;
  if (excluded.has(parent)) {
    return { text: `${parent} · excluded`, tone: "muted" };
  }
  if (method.status === "active") {
    return {
      text: `${parent} · released in Carbon — lines will not be applied`,
      tone: "destructive"
    };
  }
  if (method.status === "missing") {
    return { text: `${parent} · no make method`, tone: "destructive" };
  }
  const added = method.writes.filter(
    (line) => !excluded.has(line.partNumber)
  ).length;
  const label = method.status === "new" ? "new method" : "Draft";
  return {
    text:
      `${parent} · ${label}: ${added} added, ${method.replaces.length} replaced, ` +
      `${method.keeps.length} manual kept`,
    tone: "normal"
  };
}

export type PartApplyResult = {
  partId: string;
  action: "created" | "adopted" | "updated" | "unchanged" | "skipped" | "error";
  itemId?: string;
  readableId?: string;
  message?: string;
};

/**
 * Patch the panel's part list from apply results so a pushed part shows as
 * linked without another Onshape read. The Carbon item's identity comes from
 * the result; its revision and name come from the plan — the values the
 * server just wrote (the merged proposal for a create, the Onshape name for
 * an adopt or update). Rows the apply did not link are left as they were.
 */
export function patchPartStatuses(
  rows: PanelPartStatus[],
  review: PartReview,
  results: PartApplyResult[]
): PanelPartStatus[] {
  const planRowByPartId = new Map(
    review.plan.rows.map((row) => [row.partId, row])
  );
  const resultByPartId = new Map(results.map((r) => [r.partId, r]));
  return rows.map((row) => {
    const result = resultByPartId.get(row.partId);
    const planRow = planRowByPartId.get(row.partId);
    if (!result || !planRow || !result.itemId) return row;
    if (
      result.action !== "created" &&
      result.action !== "adopted" &&
      result.action !== "updated"
    ) {
      return row;
    }
    return {
      ...row,
      state: "linked",
      item: {
        id: result.itemId,
        ...linkedItemFromPlan(planRow, review.edits[row.partId], result)
      }
    };
  });
}

function linkedItemFromPlan(
  planRow: PartPlanRow,
  edit: ItemEdit | undefined,
  result: Pick<PartApplyResult, "readableId">
): Pick<
  NonNullable<PanelPartStatus["item"]>,
  "readableId" | "revision" | "name"
> {
  if (planRow.action === "create" && planRow.proposed) {
    const merged = editedItem(planRow.proposed, edit);
    return {
      readableId: result.readableId ?? merged.readableId,
      revision: merged.revision,
      name: merged.name
    };
  }
  return {
    readableId:
      result.readableId ?? planRow.item?.readableId ?? planRow.partNumber ?? "",
    revision: planRow.item?.revision ?? planRow.revision ?? "0",
    name: planRow.name
  };
}
