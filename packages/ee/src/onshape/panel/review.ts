import type {
  AssemblyPlan,
  AssemblyPlanMethod,
  ChangeNoticeEdit,
  ItemEdit,
  PartPlan,
  PartPlanRow,
  ProposedItem,
  ReleasePlan
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
 * Edits are sparse, so an untouched row sends nothing. The key is the plan's
 * own: partId for parts, part number for assemblies and releases.
 */

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
  /** Whether this push records a change notice. Decided per push, not by config. */
  createChangeNotice: boolean;
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
        createChangeNotice: plan.changeNotice !== null,
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
  /**
   * Sent only when the plan proposed a notice.
   * Omitted otherwise: the apply then records one if the push creates
   * something the plan did not foresee (a row that vanished since review).
   */
  createChangeNotice?: boolean;
  makeDefault: boolean;
};

/** A create keeps its whole edit; an existing item keeps only what it may change. */
function scopeEdit(
  edit: ItemEdit | undefined,
  isCreate: boolean
): ItemEdit | undefined {
  if (!edit) return undefined;
  if (isCreate) return edit;
  const out: ItemEdit = {};
  if (edit.replenishmentSystem !== undefined) {
    out.replenishmentSystem = edit.replenishmentSystem;
  }
  if (edit.defaultMethodType !== undefined) {
    out.defaultMethodType = edit.defaultMethodType;
  }
  if (edit.itemTrackingType !== undefined) {
    out.itemTrackingType = edit.itemTrackingType;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function collectEdits(
  edits: Record<string, ItemEdit>,
  entries: Array<{ key: string; isCreate: boolean }>
): Record<string, ItemEdit> {
  const out: Record<string, ItemEdit> = {};
  for (const { key, isCreate } of entries) {
    const scoped = scopeEdit(edits[key], isCreate);
    if (scoped) out[key] = scoped;
  }
  return out;
}

/**
 * The apply request for a review. A row the user edited then deselected or
 * excluded sends nothing, and the server recomputes what actually changed, so
 * an edit that matches the current value writes nothing.
 */
export function applyRequestBody(
  review: ReviewState
): PartApplyBody | AssemblyApplyBody | ReleaseApplyBody {
  switch (review.kind) {
    case "part": {
      const selectedRows = review.plan.rows.filter(
        (row) =>
          review.selected.has(row.partId) &&
          row.action !== "skip-no-part-number"
      );
      return {
        planId: review.planId,
        selected: selectedRows.map((row) => row.partId),
        edits: collectEdits(
          review.edits,
          selectedRows.map((row) => ({
            key: row.partId,
            isCreate: row.action === "create"
          }))
        )
      };
    }
    case "assembly": {
      const entries = [
        {
          key: review.plan.root.partNumber,
          isCreate: review.plan.root.action === "create"
        },
        ...review.plan.items
          .filter((item) => !review.excluded.has(item.partNumber))
          .map((item) => ({
            key: item.partNumber,
            isCreate: item.action === "create"
          }))
      ];
      return {
        planId: review.planId,
        edits: collectEdits(review.edits, entries),
        excluded: [...review.excluded]
      };
    }
    case "release": {
      const entries = [
        ...review.plan.items
          .filter(
            (item) =>
              item.action === "create" ||
              item.action === "reuse" ||
              item.action === "revision"
          )
          .map((item) => ({
            key: item.partNumber,
            isCreate: item.action === "create"
          })),
        ...review.plan.children
          .filter(
            (child) => child.action === "create" || child.action === "reuse"
          )
          .map((child) => ({
            key: child.partNumber,
            isCreate: child.action === "create"
          }))
      ];
      return {
        planId: review.planId,
        edits: collectEdits(review.edits, entries),
        changeNotice:
          review.plan.changeNotice && review.createChangeNotice
            ? review.changeNotice
            : null,
        ...(review.plan.changeNotice !== null
          ? { createChangeNotice: review.createChangeNotice }
          : {}),
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

/**
 * `warning`: this method will NOT be written — the reviewer must see it before
 * pushing. `notice`: it will be written, into a new Draft version, so nothing
 * live changes until someone releases it. Neither is an error.
 */
export type MethodDescription = {
  text: string;
  tone: "normal" | "muted" | "notice" | "warning";
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
  if (method.status === "missing") {
    return {
      text: `${parent} · no make method in Carbon, so its lines won't be written`,
      tone: "warning"
    };
  }
  const added = method.writes.filter(
    (line) => !excluded.has(line.partNumber)
  ).length;
  const takenOver = method.takesOver.filter(
    (line) => !excluded.has(line.readableId)
  ).length;
  const counts =
    `${added} added, ${method.replaces.length} replaced, ` +
    (takenOver > 0 ? `${takenOver} manual taken over, ` : "") +
    `${method.keeps.length + method.takesOver.length - takenOver} manual kept`;
  // A released method is not skipped: the push writes a Draft version of it
  // (see `ensureDraftMakeMethod`) — the one an earlier push made, or a new one.
  if (method.status === "active") {
    const draft =
      method.reusedDraftVersion != null
        ? `Draft version ${method.reusedDraftVersion}`
        : "new Draft version";
    return {
      text: `${parent} · released in Carbon — ${draft}: ${counts}`,
      tone: "notice"
    };
  }
  const label = method.status === "new" ? "new method" : "Draft";
  return { text: `${parent} · ${label}: ${counts}`, tone: "normal" };
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
