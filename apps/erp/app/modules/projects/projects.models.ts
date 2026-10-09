// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { parseDate, startOfWeek } from "@internationalized/date";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { methodType } from "../shared/shared.models";

type Enums = Database["public"]["Enums"];

export type ProjectStatus = Enums["projectStatus"];
export type ProjectCostTreatment = Enums["projectCostTreatment"];
export type ProjectElementType = Enums["projectElementType"];
export type ProjectStateGroup = Enums["projectStateGroup"];
export type ProjectElementPriority = Enums["projectElementPriority"];
export type ProjectCostType = Enums["projectCostType"];
export type TimesheetEntryStatus = Enums["timesheetEntryStatus"];

export const projectStatuses = [
  "Draft",
  "Released",
  "On Hold",
  "Technically Complete",
  "Closed"
] as const satisfies readonly ProjectStatus[];

/**
 * The cost treatments the UI offers in Phase 1a. `Capitalize` exists in the
 * enum but arrives in Phase 1b, so no form can submit it yet.
 */
export const projectCostTreatments = [
  "Statistical",
  "Expense",
  "Contract"
] as const satisfies readonly ProjectCostTreatment[];

export const projectElementTypes = [
  "Folder",
  "System",
  "Requirement",
  "Function",
  "Task",
  "Test Case",
  "Parameter"
] as const satisfies readonly ProjectElementType[];

export const projectStateGroups = [
  "Backlog",
  "Unstarted",
  "Started",
  "Completed",
  "Cancelled"
] as const satisfies readonly ProjectStateGroup[];

export const projectElementPriorities = [
  "Urgent",
  "High",
  "Medium",
  "Low",
  "None"
] as const satisfies readonly ProjectElementPriority[];

export const projectCostTypes = [
  "Material",
  "Labor",
  "Machine",
  "Overhead",
  "Outside Processing",
  "Purchased Service",
  "Other Direct",
  "Material Variance",
  "Payback Variance",
  "Burden"
] as const satisfies readonly ProjectCostType[];

export const timesheetEntryStatuses = [
  "Draft",
  "Submitted",
  "Approved",
  "Posted",
  "Rejected"
] as const satisfies readonly TimesheetEntryStatus[];

/** Whether a new element of each type takes charges when the user does not say. */
export const chargeableByDefault: Record<ProjectElementType, boolean> = {
  Folder: false,
  System: true,
  Requirement: true,
  Function: true,
  Task: true,
  "Test Case": true,
  Parameter: false
};

/**
 * The six states every new project starts with. The backfill migration
 * (`*_projects-backfill.sql`) seeds the same rows for existing projects.
 */
export const defaultProjectStates: {
  name: string;
  group: ProjectStateGroup;
  color: string;
  sortOrder: number;
  isDefault: boolean;
}[] = [
  {
    name: "Backlog",
    group: "Backlog",
    color: "#60646C",
    sortOrder: 1,
    isDefault: true
  },
  {
    name: "Todo",
    group: "Unstarted",
    color: "#60646C",
    sortOrder: 2,
    isDefault: true
  },
  {
    name: "In Progress",
    group: "Started",
    color: "#F59E0B",
    sortOrder: 3,
    isDefault: true
  },
  {
    name: "In Review",
    group: "Started",
    color: "#3B82F6",
    sortOrder: 4,
    isDefault: false
  },
  {
    name: "Done",
    group: "Completed",
    color: "#46A758",
    sortOrder: 5,
    isDefault: true
  },
  {
    name: "Cancelled",
    group: "Cancelled",
    color: "#9AA4BC",
    sortOrder: 6,
    isDefault: true
  }
];

/** The pattern the `project_identifier_check` constraint enforces. */
export const PROJECT_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;

/**
 * Suggests a project identifier from its name: the first character of each
 * word, capitals, 2 to 4 characters. This mirrors the SQL function
 * `derive_project_identifier` without its uniqueness loop, so both give the
 * same base for the same name. Words split on whitespace only.
 */
export function suggestProjectIdentifier(name: string): string {
  let base = name
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0))
    .join("")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (!/^[A-Z]/.test(base)) base = `P${base}`;
  if (base.length < 2) base = base.padEnd(2, "X");
  return base.slice(0, 4);
}

export const projectValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  identifier: zfd.text(
    z
      .string()
      .trim()
      .regex(PROJECT_IDENTIFIER_PATTERN, {
        message: "Use 2 to 6 capital letters or digits, starting with a letter"
      })
      .optional()
  ),
  description: zfd.text(z.string().trim().optional()),
  costTreatment: z.enum(projectCostTreatments, {
    error: "Cost treatment is required"
  }),
  costAccountId: zfd.text(z.string().optional()),
  customerId: zfd.text(z.string().optional()),
  ownerId: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  startDate: zfd.text(z.string().optional()),
  endDate: zfd.text(z.string().optional()),
  priority: zfd.text(z.enum(projectElementPriorities).optional())
});

/**
 * The status changes the project header offers, by current status. Release
 * opens a Draft project to charges; Close is final.
 */
export const projectStatusTransitions: Record<
  ProjectStatus,
  readonly ProjectStatus[]
> = {
  Draft: ["Released"],
  Released: ["On Hold", "Technically Complete"],
  "On Hold": ["Released", "Technically Complete"],
  "Technically Complete": ["Released", "Closed"],
  Closed: []
};

export function canChangeProjectStatus(
  from: ProjectStatus,
  to: ProjectStatus
): boolean {
  return projectStatusTransitions[from].includes(to);
}

export const projectStatusValidator = z.object({
  status: z.enum(projectStatuses, { error: "Status is required" })
});

export const projectStateValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  group: z.enum(projectStateGroups, { error: "Group is required" }),
  color: z.string().min(1, { message: "Color is required" })
});

export const projectLabelValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  color: z.string().min(1, { message: "Color is required" })
});

export const projectMilestoneValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().trim().min(1, { message: "Name is required" }),
    startDate: zfd.text(z.string().optional()),
    endDate: zfd.text(z.string().optional())
  })
  .refine(
    (data) =>
      !data.startDate || !data.endDate || data.endDate >= data.startDate,
    {
      message: "End date must be on or after the start date",
      path: ["endDate"]
    }
  );

export const projectElementValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    type: z.enum(projectElementTypes, { error: "Type is required" }),
    name: z.string().trim().min(1, { message: "Name is required" }),
    parentId: zfd.text(z.string().optional()),
    stateId: zfd.text(z.string().optional()),
    ownerId: zfd.text(z.string().optional()),
    priority: zfd.text(z.enum(projectElementPriorities).optional()),
    milestoneId: zfd.text(z.string().optional()),
    startDate: zfd.text(z.string().optional()),
    targetDate: zfd.text(z.string().optional()),
    estimatedHours: zfd.numeric(z.number().min(0).optional()),
    // Absent means "use chargeableByDefault for the type", so this is not a
    // plain zfd.checkbox(), which reads an absent box as false.
    isChargeable: z.preprocess(
      (v) =>
        v === undefined || v === null || v === ""
          ? undefined
          : v === true || v === "on" || v === "true",
      z.boolean().optional()
    ),
    budget: zfd.numeric(z.number().min(0).optional()),
    itemId: zfd.text(z.string().optional())
  })
  .refine((data) => data.type !== "Parameter" || data.isChargeable !== true, {
    message: "A Parameter cannot take charges",
    path: ["isChargeable"]
  });

/** The element fields that the List, Board and Table layouts edit in place. */
export const projectElementEditableFields = [
  "name",
  "stateId",
  "ownerId",
  "priority",
  "milestoneId",
  "startDate",
  "targetDate",
  "estimatedHours",
  "budget",
  "isChargeable",
  "itemId",
  "description"
] as const;

export type ProjectElementEditableField =
  (typeof projectElementEditableFields)[number];

export const projectElementFieldUpdateValidator = z.object({
  ids: zfd.repeatable(
    z.array(z.string().min(1)).min(1, { message: "No elements selected" })
  ),
  field: z.enum(projectElementEditableFields, {
    error: "Field is required"
  }),
  value: zfd.text(z.string().optional())
});

export const projectElementCommentValidator = z.object({
  projectElementId: z.string().min(1, { message: "Element is required" }),
  content: z.string().min(1, { message: "Comment is required" })
});

export const projectElementMaterialValidator = z.object({
  id: zfd.text(z.string().optional()),
  projectElementId: z.string().min(1, { message: "Element is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  methodType: z.enum(methodType, { error: "Method type is required" }),
  quantity: zfd.numeric(
    z.number().gt(0, { message: "Quantity must be greater than 0" })
  ),
  unitOfMeasureCode: zfd.text(z.string().optional()),
  unitCost: zfd.numeric(z.number().min(0).optional()),
  requiredDate: zfd.text(z.string().optional())
});

export const projectElementLaborValidator = z.object({
  id: zfd.text(z.string().optional()),
  projectElementId: z.string().min(1, { message: "Element is required" }),
  laborCategoryId: z.string().min(1, { message: "Labor category is required" }),
  hours: zfd.numeric(
    z.number().gt(0, { message: "Hours must be greater than 0" })
  ),
  startDate: zfd.text(z.string().optional()),
  endDate: zfd.text(z.string().optional())
});

export const projectElementCostValidator = z.object({
  id: zfd.text(z.string().optional()),
  projectElementId: z.string().min(1, { message: "Element is required" }),
  description: z.string().trim().min(1, { message: "Description is required" }),
  amount: zfd.numeric(z.number())
});

export const laborCategoryValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().trim().optional()),
  active: zfd.checkbox().optional()
});

export const laborCategoryRateValidator = z.object({
  id: zfd.text(z.string().optional()),
  laborCategoryId: z.string().min(1, { message: "Labor category is required" }),
  costRate: zfd.numeric(
    z.number().min(0, { message: "Rate cannot be negative" })
  ),
  effectiveFrom: z.string().min(1, { message: "Effective date is required" })
});

const timesheetCellFields = {
  entryDate: z.string().min(1, { message: "Date is required" }),
  projectId: z.string().min(1, { message: "Project is required" }),
  projectElementId: zfd.text(z.string().optional()),
  laborCategoryId: z.string().min(1, { message: "Labor category is required" }),
  note: zfd.text(z.string().optional())
};

/** One cell of the timesheet grid. Zero hours deletes the Draft entry. */
export const timesheetCellValidator = z.object({
  ...timesheetCellFields,
  hours: zfd.numeric(
    z
      .number()
      .min(0, { message: "Hours cannot be negative" })
      .max(24, { message: "A day has 24 hours" })
  )
});

/** Log time on an element page. The same fields as one timesheet cell. */
export const logTimeValidator = z.object({
  ...timesheetCellFields,
  hours: zfd.numeric(
    z
      .number()
      .gt(0, { message: "Hours must be greater than 0" })
      .max(24, { message: "A day has 24 hours" })
  )
});

export const timesheetCorrectionValidator = z.object({
  timesheetEntryId: z.string().min(1, { message: "Entry is required" }),
  hours: zfd.numeric(
    z
      .number()
      .min(0, { message: "Hours cannot be negative" })
      .max(24, { message: "A day has 24 hours" })
  ),
  correctionReason: z
    .string()
    .trim()
    .min(1, { message: "A reason is required for a correction" })
});

export const projectIssueDirections = ["Issue", "Return"] as const;

export const projectIssueValidator = z.object({
  projectId: z.string().min(1, { message: "Project is required" }),
  projectElementId: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  storageUnitId: zfd.text(z.string().optional()),
  trackedEntityId: zfd.text(z.string().optional()),
  quantity: zfd.numeric(
    z.number().gt(0, { message: "Quantity must be greater than 0" })
  ),
  direction: z.enum(projectIssueDirections, {
    error: "Direction is required"
  })
});

/** The `FlatTreeItem` shape of `~/components/TreeView`. */
export type ElementTreeItem<T> = {
  id: string;
  parentId: string | undefined;
  children: string[];
  hasChildren: boolean;
  /** The indentation level, the root is 0 */
  level: number;
  data: T;
};

/**
 * Builds a depth-first list of elements for the tree layouts. Siblings sort
 * by `sortOrder`. An element whose parent is not in the input (a filter
 * removed it) shows at level 0.
 */
export function buildElementTree<
  T extends { id: string; parentId: string | null; sortOrder: number }
>(elements: T[]): ElementTreeItem<T>[] {
  const ids = new Set(elements.map((e) => e.id));
  const byParent = new Map<string | null, T[]>();
  for (const element of elements) {
    const key =
      element.parentId && ids.has(element.parentId) ? element.parentId : null;
    const siblings = byParent.get(key) ?? [];
    siblings.push(element);
    byParent.set(key, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const result: ElementTreeItem<T>[] = [];
  const visited = new Set<string>();

  function walk(parentId: string | null, level: number) {
    for (const element of byParent.get(parentId) ?? []) {
      // A cycle cannot exist (moveProjectElement refuses one), but a visited
      // set keeps a bad row from recursing forever.
      if (visited.has(element.id)) continue;
      visited.add(element.id);
      const children = (byParent.get(element.id) ?? []).map((c) => c.id);
      result.push({
        id: element.id,
        parentId: parentId ?? undefined,
        children,
        hasChildren: children.length > 0,
        level,
        data: element
      });
      walk(element.id, level + 1);
    }
  }

  walk(null, 0);
  return result;
}

/**
 * The labor rate in effect on `date`: the rate with the latest
 * `effectiveFrom` on or before it, else null. Dates are `YYYY-MM-DD`
 * strings, so string order is date order.
 */
export function rateOn<T extends { effectiveFrom: string }>(
  rates: T[],
  date: string
): T | null {
  let best: T | null = null;
  for (const rate of rates) {
    if (rate.effectiveFrom > date) continue;
    if (!best || rate.effectiveFrom > best.effectiveFrom) best = rate;
  }
  return best;
}

/** The Monday of the ISO week that holds `date` (`YYYY-MM-DD`). */
export function weekStartOf(date: string): string {
  return startOfWeek(parseDate(date), "en-GB").toString();
}

export type TimesheetCell = {
  entryId: string;
  hours: number;
  status: TimesheetEntryStatus;
};

export type TimesheetRow<T> = {
  key: string;
  projectId: string;
  projectElementId: string | null;
  laborCategoryId: string;
  /** The first entry of the row, for its display fields. */
  entry: T;
  cells: Record<string, TimesheetCell>;
  total: number;
};

/**
 * Groups timesheet entries into grid rows: one row per project, element and
 * labor category, with one cell per date. Two entries on the same date (a
 * correction and its reversal) add up in one cell; the cell names the Draft
 * entry when there is one, because that is the entry a user can edit.
 */
export function groupTimesheetRows<
  T extends {
    id: string;
    projectId: string;
    projectElementId: string | null;
    laborCategoryId: string;
    entryDate: string;
    hours: number;
    status: TimesheetEntryStatus;
  }
>(entries: T[]): TimesheetRow<T>[] {
  const rows = new Map<string, TimesheetRow<T>>();
  for (const entry of entries) {
    const key = [
      entry.projectId,
      entry.projectElementId ?? "",
      entry.laborCategoryId
    ].join("\u001f");
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        projectId: entry.projectId,
        projectElementId: entry.projectElementId,
        laborCategoryId: entry.laborCategoryId,
        entry,
        cells: {},
        total: 0
      };
      rows.set(key, row);
    }
    const hours = Number(entry.hours);
    const cell = row.cells[entry.entryDate];
    if (!cell) {
      row.cells[entry.entryDate] = {
        entryId: entry.id,
        hours,
        status: entry.status
      };
    } else {
      cell.hours += hours;
      if (entry.status === "Draft") {
        cell.entryId = entry.id;
        cell.status = entry.status;
      }
    }
    row.total += hours;
  }
  return [...rows.values()];
}

export type CostTotals = {
  plan: number;
  committed: number;
  actual: number;
  hours: number;
};

/**
 * Rolls the per-element cost summary (`get_project_cost_summary`) up the
 * element tree. Each element's totals are its own row plus the rows of all
 * its descendants. The project total adds every row, including the row with
 * no element (charges to the project itself).
 */
export function rollUpCostSummary(
  tree: { id: string; parentId?: string | null }[],
  rows: {
    projectElementId: string | null;
    planMaterial: number;
    planLabor: number;
    planOther: number;
    committed: number;
    actual: number;
    actualHours: number;
  }[]
): { byElement: Map<string, CostTotals>; project: CostTotals } {
  const parentOf = new Map<string, string | null>();
  const byElement = new Map<string, CostTotals>();
  for (const element of tree) {
    parentOf.set(element.id, element.parentId ?? null);
    byElement.set(element.id, { plan: 0, committed: 0, actual: 0, hours: 0 });
  }

  const project: CostTotals = { plan: 0, committed: 0, actual: 0, hours: 0 };
  const add = (into: CostTotals, from: CostTotals) => {
    into.plan += from.plan;
    into.committed += from.committed;
    into.actual += from.actual;
    into.hours += from.hours;
  };

  for (const row of rows) {
    const own: CostTotals = {
      plan:
        Number(row.planMaterial) +
        Number(row.planLabor) +
        Number(row.planOther),
      committed: Number(row.committed),
      actual: Number(row.actual),
      hours: Number(row.actualHours)
    };
    add(project, own);

    // Walk up from the element, adding its own row to it and each ancestor.
    const seen = new Set<string>();
    let id = row.projectElementId;
    while (id && byElement.has(id) && !seen.has(id)) {
      seen.add(id);
      add(byElement.get(id)!, own);
      id = parentOf.get(id) ?? null;
    }
  }

  return { byElement, project };
}

export type MilestoneGroup = "Active" | "Upcoming" | "Completed";

/**
 * Which list a milestone shows in. A completed milestone is Completed. A
 * milestone that starts after `today`, or has no dates, is Upcoming. Every
 * other milestone is Active, including one whose end date has passed (it is
 * overdue). Dates are `YYYY-MM-DD` strings, so string order is date order.
 */
export function milestoneGroup(
  milestone: {
    startDate: string | null;
    endDate: string | null;
    completedAt: string | null;
  },
  today: string
): MilestoneGroup {
  if (milestone.completedAt) return "Completed";
  if (!milestone.startDate && !milestone.endDate) return "Upcoming";
  if (milestone.startDate && milestone.startDate > today) return "Upcoming";
  return "Active";
}

export type MilestoneSummary<
  M extends {
    id: string;
    startDate: string | null;
    endDate: string | null;
    completedAt: string | null;
  }
> = M & {
  group: MilestoneGroup;
  isOverdue: boolean;
  elementCount: number;
  completedCount: number;
  estimatedHours: number;
  actualHours: number;
  budget: number;
  actualCost: number;
};

/**
 * The progress of each milestone: its elements (Cancelled ones are left
 * out), how many are Completed, hours actual against estimated, and cost
 * actual against budget. Each element counts its own cost rows only, not its
 * children's, so an element and its child on the same milestone are not
 * counted twice.
 */
export function summarizeMilestones<
  M extends {
    id: string;
    startDate: string | null;
    endDate: string | null;
    completedAt: string | null;
  }
>(args: {
  milestones: M[];
  elements: {
    id: string;
    milestoneId: string | null;
    estimatedHours: number | null;
    budget: number | null;
    state: { group: ProjectStateGroup } | null;
  }[];
  costSummary: {
    projectElementId: string | null;
    actual: number;
    actualHours: number;
  }[];
  today: string;
}): MilestoneSummary<M>[] {
  const costByElement = new Map<string, { actual: number; hours: number }>();
  for (const row of args.costSummary) {
    if (!row.projectElementId) continue;
    costByElement.set(row.projectElementId, {
      actual: Number(row.actual),
      hours: Number(row.actualHours)
    });
  }

  const totals = new Map<
    string,
    {
      elementCount: number;
      completedCount: number;
      estimatedHours: number;
      actualHours: number;
      budget: number;
      actualCost: number;
    }
  >();
  for (const element of args.elements) {
    if (!element.milestoneId) continue;
    if (element.state?.group === "Cancelled") continue;
    const total = totals.get(element.milestoneId) ?? {
      elementCount: 0,
      completedCount: 0,
      estimatedHours: 0,
      actualHours: 0,
      budget: 0,
      actualCost: 0
    };
    const cost = costByElement.get(element.id);
    total.elementCount += 1;
    if (element.state?.group === "Completed") total.completedCount += 1;
    total.estimatedHours += Number(element.estimatedHours ?? 0);
    total.budget += Number(element.budget ?? 0);
    total.actualHours += cost?.hours ?? 0;
    total.actualCost += cost?.actual ?? 0;
    totals.set(element.milestoneId, total);
  }

  return args.milestones.map((milestone) => {
    const group = milestoneGroup(milestone, args.today);
    return {
      ...milestone,
      group,
      isOverdue:
        group === "Active" &&
        milestone.endDate !== null &&
        milestone.endDate < args.today,
      elementCount: 0,
      completedCount: 0,
      estimatedHours: 0,
      actualHours: 0,
      budget: 0,
      actualCost: 0,
      ...totals.get(milestone.id)
    };
  });
}

/** The ids of an element and every element below it. */
export function elementSubtreeIds(
  elements: { id: string; parentId: string | null }[],
  rootId: string
): string[] {
  const children = new Map<string, string[]>();
  for (const element of elements) {
    if (!element.parentId) continue;
    const siblings = children.get(element.parentId) ?? [];
    siblings.push(element.id);
    children.set(element.parentId, siblings);
  }
  if (!elements.some((element) => element.id === rootId)) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    stack.push(...(children.get(id) ?? []));
  }
  return ids;
}

export type ProjectCostFigures = {
  plan: number;
  /** The budgets set in the subtree, or null when none is set. */
  budget: number | null;
  committed: number;
  actual: number;
  hours: number;
  /** Budget less committed and actual, or null with no budget. */
  remaining: number | null;
  estimateAtCompletion: number;
};

/**
 * The estimate at completion: the override when one is set, else actual +
 * committed + whatever of the plan is not spent or committed yet.
 */
export function estimateAtCompletion(args: {
  plan: number;
  committed: number;
  actual: number;
  override?: number | null;
}): number {
  if (args.override !== null && args.override !== undefined) {
    return Number(args.override);
  }
  return (
    args.actual +
    args.committed +
    Math.max(args.plan - args.actual - args.committed, 0)
  );
}

/**
 * The Costs tab figures for each element (its subtree) and for the project.
 * Plan, committed, actual and hours roll up with `rollUpCostSummary`, so the
 * project total includes charges with no element. The budget of a row adds
 * every budget set in its subtree; the project budget adds every element's.
 * An element's own `estimateAtCompletion` overrides its estimate; the project
 * estimate is always computed.
 */
export function buildProjectCostFigures(
  elements: {
    id: string;
    parentId: string | null;
    budget: number | null;
    estimateAtCompletion: number | null;
  }[],
  costSummary: Parameters<typeof rollUpCostSummary>[1]
): { byElement: Map<string, ProjectCostFigures>; project: ProjectCostFigures } {
  const { byElement: totals, project: projectTotals } = rollUpCostSummary(
    elements,
    costSummary
  );

  const parentOf = new Map<string, string | null>();
  const budgets = new Map<string, number | null>();
  for (const element of elements) {
    parentOf.set(element.id, element.parentId);
    budgets.set(element.id, null);
  }

  let projectBudget: number | null = null;
  for (const element of elements) {
    if (element.budget === null) continue;
    const amount = Number(element.budget);
    projectBudget = (projectBudget ?? 0) + amount;
    const seen = new Set<string>();
    let id: string | null = element.id;
    while (id && parentOf.has(id) && !seen.has(id)) {
      seen.add(id);
      budgets.set(id, (budgets.get(id) ?? 0) + amount);
      id = parentOf.get(id) ?? null;
    }
  }

  const figures = (
    total: CostTotals,
    budget: number | null,
    override: number | null
  ): ProjectCostFigures => ({
    plan: total.plan,
    budget,
    committed: total.committed,
    actual: total.actual,
    hours: total.hours,
    remaining: budget === null ? null : budget - total.committed - total.actual,
    estimateAtCompletion: estimateAtCompletion({
      plan: total.plan,
      committed: total.committed,
      actual: total.actual,
      override
    })
  });

  const byElement = new Map<string, ProjectCostFigures>();
  for (const element of elements) {
    byElement.set(
      element.id,
      figures(
        totals.get(element.id) ?? {
          plan: 0,
          committed: 0,
          actual: 0,
          hours: 0
        },
        budgets.get(element.id) ?? null,
        element.estimateAtCompletion
      )
    );
  }

  return { byElement, project: figures(projectTotals, projectBudget, null) };
}
