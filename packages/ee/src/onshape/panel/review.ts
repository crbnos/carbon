// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type {
  AssemblyPlan,
  AssemblyPlanMethod,
  ChangeNoticeEdit,
  ItemEdit,
  ItemFieldChange,
  KeptDifference,
  PartPlan,
  PartPlanRow,
  ProposedItem,
  ReleasePlan
} from "./plan";
import type { PlanCustomField, PlanItemField } from "./properties";
import { customFieldDisplayValue } from "./properties";
import type { PanelPartStatus } from "./status";

/**
 * The panel's review state: a stored plan plus the user's sparse edits, keyed
 * by partId for parts and by part number for assemblies and releases.
 */

type ReviewBase = {
  planId: string;
  expiresAt: string;
  /** The element, or the document for a release; another drops the review. */
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
  createChangeNotice: boolean;
  makeDefault: boolean;
  /** Assemblies whose BOM the plan could not read; their lines are empty. */
  warnings: string[];
};

export type ReviewState = PartReview | AssemblyReview | ReleaseReview;

/** `unchanged` rows start unticked: the button counts what apply touches. */
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
 * A Buy item the push writes a BOM into, and a Make item Onshape shows as one
 * unit (no BOM), after mapped values and edits. The push writes both anyway.
 */
export function replenishmentMismatches(
  plan: AssemblyPlan,
  edits: Record<string, ItemEdit>,
  excluded: ReadonlySet<string>
): string[] {
  const rows = new Map<
    string,
    {
      current?: { replenishmentSystem: string } | null;
      target?: { replenishmentSystem: string };
      proposed: ProposedItem | null;
    }
  >([
    [plan.root.partNumber, plan.root],
    ...plan.items.map((item) => [item.partNumber, item] as const)
  ]);
  const replenishment = (partNumber: string) => {
    const row = rows.get(partNumber);
    return (
      edits[partNumber]?.replenishmentSystem ??
      row?.target?.replenishmentSystem ??
      row?.current?.replenishmentSystem ??
      row?.proposed?.replenishmentSystem
    );
  };
  const lines: string[] = [];
  for (const method of plan.methods) {
    if (
      method.status === "missing" ||
      method.writes.length === 0 ||
      excluded.has(method.parentPartNumber)
    ) {
      continue;
    }
    if (replenishment(method.parentPartNumber) === "Buy") {
      lines.push(
        `${method.parentPartNumber} is Buy in Carbon, so the BOM written to it isn't used until it's set to Make`
      );
    }
  }
  for (const item of plan.items) {
    if (!item.shownAsUnit || excluded.has(item.partNumber)) continue;
    if (replenishment(item.partNumber) === "Make") {
      lines.push(
        `${item.partNumber} is one unit in Onshape (Show Assembly only), so no BOM is written for it, but Carbon makes it`
      );
    }
  }
  return lines;
}

export const CARBON_ONLY_NOTE =
  "Changes here apply to Carbon only. Onshape keeps its values.";

export function mappedValueText(field: PlanItemField): string {
  return `${field.label}: ${field.value ?? "—"} · from Onshape "${field.onshapeName}"`;
}

export function keptDifferenceText(kept: KeptDifference): string {
  return `${kept.label}: Onshape has ${kept.onshape}. Carbon keeps ${
    kept.carbon ?? "no value"
  } (set at creation only).`;
}

export function customFieldChangeText(field: PlanCustomField): string {
  const replaces = field.replaces ?? null;
  const verb =
    field.value === null
      ? `Clears ${replaces ?? "the value"}`
      : replaces === null
        ? `Sets ${customFieldDisplayValue(field)}`
        : `Replaces ${replaces} with ${customFieldDisplayValue(field)}`;
  return `${field.name}: ${verb} (updated on every push).`;
}

export function itemFieldChangeText(change: ItemFieldChange): string {
  const verb =
    change.from === null
      ? `Sets ${change.to ?? "no value"}`
      : `Replaces ${change.from} with ${change.to ?? "no value"}`;
  return `${change.label}: ${verb} (${
    change.onshapeName === null
      ? "goes with the change above"
      : "updated on every push"
  }).`;
}

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
   * Sent only when the plan proposed a notice. Omitted, apply still records
   * one for a create the plan did not foresee (a row gone since review).
   */
  createChangeNotice?: boolean;
  makeDefault: boolean;
};

/** An existing item keeps only its manufacturing choices. */
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

/** A deselected or excluded row sends nothing, even when edited. */
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
      // An attached drawing is uploaded to its model, so a release of
      // drawings alone still has something to push.
      return (
        review.plan.items.filter(
          (item) =>
            item.action === "reuse" ||
            item.action === "revision" ||
            item.action === "create" ||
            item.action === "drawing"
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

/** plan-release's unreadable-BOM warnings as text; anything else is dropped. */
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

/**
 * `warning`: the method is not written. `notice`: it is written into a Draft
 * version, so nothing live changes until someone releases it.
 */
export type MethodDescription = {
  text: string;
  tone: "normal" | "muted" | "notice" | "warning";
};

/** Leaves out excluded children; an excluded parent's method is not applied. */
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
  // A released method whose lines already match gets no Draft, unless the
  // reviewer excluded one of its parts (that line would then go).
  if (
    method.status === "active" &&
    method.unchanged &&
    !method.writes.some((line) => excluded.has(line.partNumber))
  ) {
    return {
      text: `${parent} · released in Carbon — no change`,
      tone: "muted"
    };
  }
  // The push writes a Draft version (`ensureDraftMakeMethod`): the one an
  // earlier push made, or a new one.
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

export type ReleaseResultCounts = {
  revisionsCreated: number;
  itemsCreated: number;
  childrenCreated?: number;
  linesWritten: number;
  methodsTouched: number;
  changeNotice: string | null;
  /** Drawings whose upload to their model item was queued. */
  drawingsQueued?: number;
  /** The release held drawings only, so there is no model to report on. */
  drawingsOnly?: boolean;
};

const countOf = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** BOM parts the push created are listed apart: they are not on the notice. */
export function releaseResultText(s: ReleaseResultCounts): string {
  const staged = [
    s.revisionsCreated > 0 ? countOf(s.revisionsCreated, "new revision") : null,
    s.itemsCreated > 0 ? countOf(s.itemsCreated, "new item") : null
  ]
    .filter(Boolean)
    .join(" and ");
  const parts: string[] = [];
  if (staged) {
    parts.push(
      s.changeNotice
        ? `${staged} on change notice ${s.changeNotice}, inactive until it is released in Carbon`
        : staged
    );
  } else if (!s.drawingsOnly) {
    parts.push("Already in Carbon");
  }
  const children = s.childrenCreated ?? 0;
  if (children > 0) {
    parts.push(`${countOf(children, "BOM part")} added to Carbon`);
  }
  if (s.methodsTouched > 0) {
    parts.push(
      s.linesWritten > 0
        ? `${countOf(s.linesWritten, "BOM line")} written`
        : "BOM unchanged"
    );
  }
  const drawings = s.drawingsQueued ?? 0;
  if (drawings > 0) {
    parts.push(`${countOf(drawings, "drawing")} sent to Carbon`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Nothing to push";
}

export type PartApplyResult = {
  partId: string;
  action: "created" | "adopted" | "updated" | "unchanged" | "skipped" | "error";
  itemId?: string;
  readableId?: string;
  message?: string;
};

/**
 * Marks pushed parts linked without another Onshape read. Identity comes from
 * the result; revision and name from the plan, which is what the server wrote.
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
