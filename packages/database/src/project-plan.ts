// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The plan layer of a project and the shape of a `projectBaseline.snapshot`.
// Shared by the ERP (baselines, change requests, earned value) and the demo
// datasets, which write a baseline with the same snapshot builder.

import type { Database } from "./types";

export type ProjectPlanTable = Database["public"]["Enums"]["projectPlanTable"];

/**
 * The plan-layer columns of each plan table: the only columns that baselines
 * snapshot, change requests change and the plan lock guards. Progress fields
 * (state, owner, priority, labels, dates, milestone, verdict) stay out. So does
 * what records history: a link's suspect flag and review, a material's issued
 * quantity and its job or PO line, an element's asset. The cost treatment and
 * the final-asset flag stay out too, because their writes create assets.
 */
export const PLAN_LAYER_FIELDS: Record<ProjectPlanTable, readonly string[]> = {
  projectElement: [
    "id",
    "parentId",
    "readableId",
    "wbsCode",
    "sortOrder",
    "type",
    "name",
    "description",
    "isChargeable",
    "budget",
    "estimatedHours",
    "itemId",
    "trackedEntityId",
    "requirementCategory",
    "targetOperator",
    "targetValue",
    "targetUpperValue",
    "targetUnit",
    "verificationMethod",
    "actualParameterId",
    "qualityDocumentId",
    "parameterValue",
    "parameterUnit",
    "parameterSource",
    "parameterFormula",
    "parameterItemField",
    "parameterContingencyPercent",
    "allocationPercent"
  ],
  projectElementLink: [
    "id",
    "projectId",
    "fromElementId",
    "toElementId",
    "linkType"
  ],
  projectElementMaterial: [
    "id",
    "projectId",
    "projectElementId",
    "itemId",
    "methodType",
    "quantity",
    "unitOfMeasureCode",
    "requiredDate",
    "unitCost"
  ],
  projectElementLabor: [
    "id",
    "projectId",
    "projectElementId",
    "laborCategoryId",
    "hours",
    "startDate",
    "endDate"
  ],
  projectElementCost: [
    "id",
    "projectId",
    "projectElementId",
    "description",
    "amount"
  ]
};

/**
 * The version of the `projectBaseline.snapshot` shape this code writes.
 * Version 2 adds `schedule`, the element dates that earned value reads.
 */
export const PROJECT_BASELINE_FORMAT_VERSION = 2;

/** One row of a plan snapshot: only the table's `PLAN_LAYER_FIELDS`. */
export type PlanRow = Record<string, unknown> & { id: string };

/** One element's dates in a baseline (format version 2). */
export type PlanScheduleRow = {
  id: string;
  startDate: string | null;
  targetDate: string | null;
};

export type ProjectPlanSnapshot = {
  elements: PlanRow[];
  links: PlanRow[];
  materials: PlanRow[];
  labor: PlanRow[];
  costs: PlanRow[];
  /**
   * Each element's `startDate` and `targetDate`, sorted by `id` (format
   * version 2). Dates stay progress fields: the diff, change requests and the
   * plan lock ignore `schedule`. Earned value spreads BCWS over these dates.
   */
  schedule?: PlanScheduleRow[];
};

/** The snapshot keys that hold the rows of a plan table. */
export type ProjectPlanSnapshotKey = Exclude<
  keyof ProjectPlanSnapshot,
  "schedule"
>;

/** The snapshot key that holds the rows of each plan table. */
export const planSnapshotKeys: Record<
  ProjectPlanTable,
  ProjectPlanSnapshotKey
> = {
  projectElement: "elements",
  projectElementLink: "links",
  projectElementMaterial: "materials",
  projectElementLabor: "labor",
  projectElementCost: "costs"
};

const planTableBySnapshotKey = Object.fromEntries(
  Object.entries(planSnapshotKeys).map(([table, key]) => [key, table])
) as Record<ProjectPlanSnapshotKey, ProjectPlanTable>;

/** True when `field` is a plan-layer column of `table`. */
export function isPlanLayerField(table: ProjectPlanTable, field: string) {
  return PLAN_LAYER_FIELDS[table].includes(field);
}

/** The plan-layer columns of one row; a missing column reads as null. */
export function pickPlanLayerFields(
  table: ProjectPlanTable,
  row: Record<string, unknown>
): PlanRow {
  const picked: Record<string, unknown> = {};
  for (const field of PLAN_LAYER_FIELDS[table]) {
    picked[field] = row[field] ?? null;
  }
  return picked as PlanRow;
}

function byId(a: PlanRow, b: PlanRow) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Builds a plan snapshot from the rows of the 5 plan tables. It keeps the
 * plan-layer columns only and sorts each array by `id`, so two snapshots of
 * the same plan are equal. `schedule` takes each element row's `startDate`
 * and `targetDate`; a missing date reads as null.
 */
export function toPlanSnapshot(
  rows: Record<ProjectPlanSnapshotKey, Record<string, unknown>[]>
): ProjectPlanSnapshot {
  const pick = (key: ProjectPlanSnapshotKey) =>
    rows[key]
      .map((row) => pickPlanLayerFields(planTableBySnapshotKey[key], row))
      .sort(byId);
  const schedule = rows.elements
    .map((row) => ({
      id: String(row.id),
      startDate: (row.startDate as string | null | undefined) ?? null,
      targetDate: (row.targetDate as string | null | undefined) ?? null
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    elements: pick("elements"),
    links: pick("links"),
    materials: pick("materials"),
    labor: pick("labor"),
    costs: pick("costs"),
    schedule
  };
}

/** Reads a stored `projectBaseline.snapshot`; a missing array reads as empty. */
export function parsePlanSnapshot(value: unknown): ProjectPlanSnapshot {
  const source = (value && typeof value === "object" ? value : {}) as Partial<
    Record<ProjectPlanSnapshotKey, unknown>
  >;
  const rowsOf = (key: ProjectPlanSnapshotKey) =>
    Array.isArray(source[key]) ? (source[key] as PlanRow[]) : [];
  const schedule = (source as { schedule?: unknown }).schedule;
  return {
    elements: rowsOf("elements"),
    links: rowsOf("links"),
    materials: rowsOf("materials"),
    labor: rowsOf("labor"),
    costs: rowsOf("costs"),
    ...(Array.isArray(schedule)
      ? { schedule: schedule as PlanScheduleRow[] }
      : {})
  };
}

/**
 * True when the project locks its plan layer: it names a lock milestone and
 * that milestone is completed. After that, plan-layer fields change only
 * through a change request.
 */
export function isProjectPlanLocked(args: {
  lockMilestone: { completedAt: string | null } | null | undefined;
}) {
  return Boolean(args.lockMilestone?.completedAt);
}

export type ProjectStateGroup =
  Database["public"]["Enums"]["projectStateGroup"];

/** An element's `completedAt` for a state group: set on Completed, else cleared. */
export function completedAtForGroup(
  group: ProjectStateGroup,
  now: string
): string | null {
  return group === "Completed" ? now : null;
}

/**
 * The state an element takes for a state group. It keeps its current state
 * when that is already in the group (a company can have several), else the
 * group's default, else the group's first state by `sortOrder`.
 */
export function pickStateForGroup(
  states: Array<{
    id: string;
    group: ProjectStateGroup;
    isDefault: boolean;
    sortOrder: number;
  }>,
  group: ProjectStateGroup,
  currentStateId: string | null | undefined
): string | null {
  const inGroup = states.filter((state) => state.group === group);
  if (inGroup.some((state) => state.id === currentStateId)) {
    return currentStateId ?? null;
  }
  const preferred =
    inGroup.find((state) => state.isDefault) ??
    [...inGroup].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return preferred?.id ?? null;
}
