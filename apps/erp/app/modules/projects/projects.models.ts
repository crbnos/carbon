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
