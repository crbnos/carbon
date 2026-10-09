// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { EPSILON, equals, formatPercent, formatQuantity } from "@carbon/utils";
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
 * The cost treatments the UI offers. `Capitalize` (Phase 1b) builds the
 * project's assets under construction and needs a CIP class.
 */
export const projectCostTreatments = [
  "Statistical",
  "Expense",
  "Contract",
  "Capitalize"
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

export const projectValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().trim().min(1, { message: "Name is required" }),
    identifier: zfd.text(
      z
        .string()
        .trim()
        .regex(PROJECT_IDENTIFIER_PATTERN, {
          message:
            "Use 2 to 6 capital letters or digits, starting with a letter"
        })
        .optional()
    ),
    description: zfd.text(z.string().trim().optional()),
    costTreatment: z.enum(projectCostTreatments, {
      error: "Cost treatment is required"
    }),
    costAccountId: zfd.text(z.string().optional()),
    // Capitalize: the Construction in Progress class of the project's assets.
    fixedAssetClassId: zfd.text(z.string().optional()),
    customerId: zfd.text(z.string().optional()),
    ownerId: zfd.text(z.string().optional()),
    locationId: zfd.text(z.string().optional()),
    startDate: zfd.text(z.string().optional()),
    endDate: zfd.text(z.string().optional()),
    priority: zfd.text(z.enum(projectElementPriorities).optional())
  })
  .refine(
    (data) => data.costTreatment !== "Capitalize" || !!data.fixedAssetClassId,
    {
      message: "A capital project needs a Construction in Progress class",
      path: ["fixedAssetClassId"]
    }
  );

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

/** Place in service: capitalize a capital project's assets under construction. */
export const placeInServiceValidator = z.object({
  fixedAssetIds: zfd.repeatable(
    z.array(z.string().min(1)).min(1, { message: "Select at least one asset" })
  ),
  toClassId: z.string().min(1, { message: "Asset class is required" }),
  inServiceDate: z.string().min(1, { message: "In-service date is required" })
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
  "isFinalAsset",
  "itemId",
  "description",
  "requirementCategory",
  "targetOperator",
  "targetValue",
  "targetUpperValue",
  "targetUnit",
  "verificationMethod",
  "actualParameterId",
  "qualityDocumentId",
  "verdict",
  "parameterValue",
  "parameterUnit",
  "parameterSource",
  "parameterItemField",
  "parameterContingencyPercent",
  "allocationPercent"
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

// --- Trace links -------------------------------------------------------------

export type ProjectElementLinkType = Enums["projectElementLinkType"];

export const projectElementLinkTypes = [
  "satisfies",
  "verifies",
  "derives",
  "implements",
  "blocks",
  "precedes",
  "relates to",
  "feeds"
] as const satisfies readonly ProjectElementLinkType[];

/** How a link reads from its "to" end ("A verifies B" → "B verified by A"). */
export const linkReverseLabel: Record<ProjectElementLinkType, string> = {
  satisfies: "satisfied by",
  verifies: "verified by",
  derives: "derived from",
  implements: "implemented by",
  blocks: "blocked by",
  precedes: "follows",
  "relates to": "relates to",
  feeds: "fed by"
};

/** The element types each end of a link may have. */
export const allowedLinkEnds: Record<
  ProjectElementLinkType,
  { from: readonly ProjectElementType[]; to: readonly ProjectElementType[] }
> = {
  satisfies: { from: ["System", "Function"], to: ["Requirement"] },
  verifies: { from: ["Test Case"], to: ["Requirement"] },
  derives: { from: ["Requirement"], to: ["Requirement"] },
  implements: {
    from: ["Task"],
    to: ["System", "Function", "Requirement"]
  },
  blocks: { from: projectElementTypes, to: projectElementTypes },
  precedes: { from: projectElementTypes, to: projectElementTypes },
  "relates to": { from: projectElementTypes, to: projectElementTypes },
  feeds: { from: ["Parameter"], to: ["Parameter"] }
};

export type ProjectElementLinkEnd = { id: string; type: ProjectElementType };

export type ProjectElementLinkRef = {
  fromElementId: string;
  toElementId: string;
  linkType: ProjectElementLinkType;
};

/** Whether `from` reaches `to` over the `precedes` links. */
function precedesReaches(
  links: ProjectElementLinkRef[],
  from: string,
  to: string
): boolean {
  const next = new Map<string, string[]>();
  for (const link of links) {
    if (link.linkType !== "precedes") continue;
    const targets = next.get(link.fromElementId) ?? [];
    targets.push(link.toElementId);
    next.set(link.fromElementId, targets);
  }
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

/**
 * Whether a user may add a link of `type` from `from` to `to`. It refuses a
 * `feeds` link (only a formula save writes them), a self link, ends that
 * `allowedLinkEnds` does not allow, a duplicate, and a cycle of `precedes`.
 */
export function canLink(
  from: ProjectElementLinkEnd,
  to: ProjectElementLinkEnd,
  type: ProjectElementLinkType,
  existingLinks: ProjectElementLinkRef[]
): { ok: true } | { ok: false; reason: string } {
  if (type === "feeds") {
    return {
      ok: false,
      reason: "A formula writes its feeds links. Edit the formula instead."
    };
  }
  if (from.id === to.id) {
    return { ok: false, reason: "An element cannot link to itself" };
  }
  const ends = allowedLinkEnds[type];
  if (!ends.from.includes(from.type) || !ends.to.includes(to.type)) {
    return {
      ok: false,
      reason: `A ${from.type} cannot ${type} a ${to.type}`
    };
  }
  if (
    existingLinks.some(
      (link) =>
        link.fromElementId === from.id &&
        link.toElementId === to.id &&
        link.linkType === type
    )
  ) {
    return { ok: false, reason: "This link already exists" };
  }
  if (type === "precedes" && precedesReaches(existingLinks, to.id, from.id)) {
    return {
      ok: false,
      reason: "This link would make a loop of precedes links"
    };
  }
  return { ok: true };
}

export const projectElementLinkValidator = z.object({
  fromElementId: z.string().min(1, { message: "Element is required" }),
  toElementId: z.string().min(1, { message: "Element is required" }),
  linkType: z.enum(projectElementLinkTypes, { error: "Link type is required" })
});

/**
 * The element fields whose change makes the incoming trace links suspect: the
 * linked element was reviewed against the old value.
 */
export const suspectLinkFields: readonly string[] = [
  "name",
  "description",
  "targetOperator",
  "targetValue",
  "targetUpperValue",
  "targetUnit",
  "parameterValue",
  "parameterUnit"
];

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

/** A new row of the timesheet grid: a charge number and a labor category. */
export const timesheetRowValidator = z.object({
  projectId: z.string().min(1, { message: "Charge number is required" }),
  projectElementId: zfd.text(z.string().optional()),
  laborCategoryId: z.string().min(1, { message: "Labor category is required" })
});

/** The grid key of a timesheet row, as `groupTimesheetRows` builds it. */
export function timesheetRowKey(row: {
  projectId: string;
  projectElementId?: string | null;
  laborCategoryId: string;
}): string {
  return [row.projectId, row.projectElementId ?? "", row.laborCategoryId].join(
    "\u001f"
  );
}

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
    const key = timesheetRowKey(entry);
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

// --- Requirements, Test Cases and Parameters ---------------------------------

export type RequirementCategory = Enums["requirementCategory"];
export type RequirementTargetOperator = Enums["requirementTargetOperator"];
export type RequirementVerificationMethod =
  Enums["requirementVerificationMethod"];
export type TestCaseVerdict = Enums["testCaseVerdict"];
export type ParameterSource = Enums["parameterSource"];

export const requirementCategories = [
  "Functional",
  "Performance",
  "Interface",
  "Environmental",
  "Design Constraint"
] as const satisfies readonly RequirementCategory[];

export const requirementTargetOperators = [
  "≤",
  "≥",
  "=",
  "Range"
] as const satisfies readonly RequirementTargetOperator[];

export const requirementVerificationMethods = [
  "Test",
  "Analysis",
  "Inspection",
  "Demonstration"
] as const satisfies readonly RequirementVerificationMethod[];

export const testCaseVerdicts = [
  "Not Run",
  "Pass",
  "Fail",
  "Inconclusive"
] as const satisfies readonly TestCaseVerdict[];

export const parameterSources = [
  "Manual",
  "Sum",
  "Min",
  "Max",
  "Formula",
  "Item"
] as const satisfies readonly ParameterSource[];

/** The `parameterItemField` value that reads the item's unit cost. */
export const PARAMETER_ITEM_UNIT_COST = "unitCost";

/** The fields that only one element type has. Another type refuses them. */
export const typeSpecificElementFields: Partial<
  Record<ProjectElementEditableField, ProjectElementType>
> = {
  requirementCategory: "Requirement",
  targetOperator: "Requirement",
  targetValue: "Requirement",
  targetUpperValue: "Requirement",
  targetUnit: "Requirement",
  verificationMethod: "Requirement",
  actualParameterId: "Requirement",
  qualityDocumentId: "Test Case",
  verdict: "Test Case",
  parameterValue: "Parameter",
  parameterUnit: "Parameter",
  parameterSource: "Parameter",
  parameterItemField: "Parameter",
  parameterContingencyPercent: "Parameter",
  allocationPercent: "Parameter"
};

/** A readable id in a formula: `SNS-7`, or a Service project's `SVC000123-4`. */
const FORMULA_REF_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;
const FORMULA_FUNCTIONS = ["min", "max", "abs"] as const;
type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];

export type FormulaNode =
  | { kind: "number"; value: number }
  | { kind: "ref"; id: string }
  | { kind: "negate"; arg: FormulaNode }
  | {
      kind: "binary";
      op: "+" | "-" | "*" | "/";
      left: FormulaNode;
      right: FormulaNode;
    }
  | { kind: "call"; name: FormulaFunction; args: FormulaNode[] };

type FormulaToken =
  | { kind: "number"; value: number; position: number }
  | { kind: "ref"; id: string; position: number }
  | { kind: "function"; name: FormulaFunction; position: number }
  | { kind: "symbol"; symbol: string; position: number }
  | { kind: "end"; position: number };

class FormulaError extends Error {
  constructor(
    message: string,
    readonly position: number
  ) {
    super(message);
  }
}

function tokenizeFormula(text: string, start: number): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let i = start;
  const isDigit = (c: string | undefined) =>
    c !== undefined && c >= "0" && c <= "9";
  const isLetter = (c: string | undefined) =>
    c !== undefined && ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z"));
  while (i < text.length) {
    const c = text[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (isDigit(c) || (c === "." && isDigit(text[i + 1]))) {
      const begin = i;
      while (isDigit(text[i])) i++;
      if (text[i] === ".") {
        i++;
        if (!isDigit(text[i])) {
          throw new FormulaError(`Expected a digit at position ${i}`, i);
        }
        while (isDigit(text[i])) i++;
      }
      tokens.push({
        kind: "number",
        value: Number(text.slice(begin, i)),
        position: begin
      });
      continue;
    }
    if (isLetter(c)) {
      const begin = i;
      while (isLetter(text[i]) || isDigit(text[i])) i++;
      const word = text.slice(begin, i);
      // A readable id is a word, a hyphen and digits: `SNS-7`.
      if (text[i] === "-" && isDigit(text[i + 1])) {
        let end = i + 1;
        while (isDigit(text[end])) end++;
        const id = text.slice(begin, end);
        if (FORMULA_REF_PATTERN.test(id)) {
          tokens.push({ kind: "ref", id, position: begin });
          i = end;
          continue;
        }
      }
      const name = word.toLowerCase();
      if ((FORMULA_FUNCTIONS as readonly string[]).includes(name)) {
        tokens.push({
          kind: "function",
          name: name as FormulaFunction,
          position: begin
        });
        continue;
      }
      throw new FormulaError(
        `Unknown name "${word}" at position ${begin}`,
        begin
      );
    }
    if ("+-*/(),".includes(c)) {
      tokens.push({ kind: "symbol", symbol: c, position: i });
      i++;
      continue;
    }
    throw new FormulaError(`Unexpected "${c}" at position ${i}`, i);
  }
  tokens.push({ kind: "end", position: text.length });
  return tokens;
}

/**
 * Parses a Parameter formula such as `= SNS-20 - SNS-21` or
 * `= max(SNS-3, SNS-4) * 1.2`. A hand-written recursive-descent parser:
 * expression → term (`+ -`) → factor (`* /`) → unary minus → primary (a
 * number, a readable id, `min`/`max`/`abs`, or a parenthesis). It never
 * evaluates the text as code. `refs` lists the distinct readable ids.
 */
export function parseParameterFormula(
  text: string
): { ast: FormulaNode; refs: string[] } | { error: string; position: number } {
  let start = 0;
  while (start < text.length && /\s/.test(text[start]!)) start++;
  if (text[start] !== "=") {
    return { error: "A formula starts with =", position: start };
  }

  try {
    const tokens = tokenizeFormula(text, start + 1);
    let index = 0;
    const peek = () => tokens[index]!;
    const isSymbol = (symbol: string) => {
      const token = peek();
      return token.kind === "symbol" && token.symbol === symbol;
    };
    const expect = (symbol: string) => {
      if (!isSymbol(symbol)) {
        const token = peek();
        throw new FormulaError(
          `Expected "${symbol}" at position ${token.position}`,
          token.position
        );
      }
      index++;
    };

    const expression = (): FormulaNode => {
      let node = term();
      while (isSymbol("+") || isSymbol("-")) {
        const op = (tokens[index++] as { symbol: "+" | "-" }).symbol;
        node = { kind: "binary", op, left: node, right: term() };
      }
      return node;
    };
    const term = (): FormulaNode => {
      let node = unary();
      while (isSymbol("*") || isSymbol("/")) {
        const op = (tokens[index++] as { symbol: "*" | "/" }).symbol;
        node = { kind: "binary", op, left: node, right: unary() };
      }
      return node;
    };
    const unary = (): FormulaNode => {
      if (isSymbol("-")) {
        index++;
        return { kind: "negate", arg: unary() };
      }
      return primary();
    };
    const primary = (): FormulaNode => {
      const token = peek();
      if (token.kind === "number") {
        index++;
        return { kind: "number", value: token.value };
      }
      if (token.kind === "ref") {
        index++;
        return { kind: "ref", id: token.id };
      }
      if (token.kind === "function") {
        index++;
        expect("(");
        const args = [expression()];
        while (isSymbol(",")) {
          index++;
          args.push(expression());
        }
        expect(")");
        if (token.name === "abs" && args.length !== 1) {
          throw new FormulaError(
            `abs takes one value (position ${token.position})`,
            token.position
          );
        }
        return { kind: "call", name: token.name, args };
      }
      if (isSymbol("(")) {
        index++;
        const node = expression();
        expect(")");
        return node;
      }
      throw new FormulaError(
        token.kind === "end"
          ? `The formula ends early at position ${token.position}`
          : `Unexpected value at position ${token.position}`,
        token.position
      );
    };

    const ast = expression();
    const end = peek();
    if (end.kind !== "end") {
      throw new FormulaError(
        `Unexpected value at position ${end.position}`,
        end.position
      );
    }
    return { ast, refs: formulaRefs(ast) };
  } catch (err) {
    if (err instanceof FormulaError) {
      return { error: err.message, position: err.position };
    }
    throw err;
  }
}

/** The distinct readable ids a formula names, in order of first use. */
export function formulaRefs(ast: FormulaNode): string[] {
  const refs = new Set<string>();
  const walk = (node: FormulaNode) => {
    switch (node.kind) {
      case "ref":
        refs.add(node.id);
        break;
      case "negate":
        walk(node.arg);
        break;
      case "binary":
        walk(node.left);
        walk(node.right);
        break;
      case "call":
        node.args.forEach(walk);
        break;
      case "number":
        break;
    }
  };
  walk(ast);
  return [...refs];
}

export type FormulaResult =
  | { value: number; reason: null }
  | { value: null; reason: string };

/**
 * Evaluates a parsed formula. `valueOf(readableId)` gives a Parameter's
 * value or null. A null input or a division by zero gives null with a reason.
 */
export function evaluateFormula(
  ast: FormulaNode,
  valueOf: (readableId: string) => number | null
): FormulaResult {
  const fail = (reason: string): never => {
    throw new FormulaError(reason, 0);
  };
  const evaluate = (node: FormulaNode): number => {
    switch (node.kind) {
      case "number":
        return node.value;
      case "ref": {
        const value = valueOf(node.id);
        if (value === null || !Number.isFinite(value)) {
          return fail(`${node.id} has no value`);
        }
        return value;
      }
      case "negate":
        return -evaluate(node.arg);
      case "binary": {
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        switch (node.op) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            if (right === 0) return fail("Division by zero");
            return left / right;
        }
        return fail("Unknown operator");
      }
      case "call": {
        const values = node.args.map(evaluate);
        if (node.name === "abs") return Math.abs(values[0]!);
        return node.name === "min" ? Math.min(...values) : Math.max(...values);
      }
    }
  };
  try {
    return { value: evaluate(ast), reason: null };
  } catch (err) {
    if (err instanceof FormulaError)
      return { value: null, reason: err.message };
    throw err;
  }
}

/**
 * Whether a formula adds or subtracts values with different units. Units
 * are free text and never convert. A product or quotient has no checked unit.
 */
function formulaMixesUnits(
  ast: FormulaNode,
  unitOf: (readableId: string) => string | null
): boolean {
  let mixed = false;
  const unit = (node: FormulaNode): string | null => {
    switch (node.kind) {
      case "number":
        return null;
      case "ref":
        return unitOf(node.id);
      case "negate":
        return unit(node.arg);
      case "binary": {
        const left = unit(node.left);
        const right = unit(node.right);
        if (node.op === "*" || node.op === "/") return null;
        if (left !== null && right !== null && left !== right) mixed = true;
        return left ?? right;
      }
      case "call": {
        const units = node.args.map(unit).filter((u) => u !== null);
        if (new Set(units).size > 1) mixed = true;
        return units[0] ?? null;
      }
    }
  };
  unit(ast);
  return mixed;
}

/** The element fields `computeVerification` reads. */
export type VerificationElement = {
  id: string;
  readableId: string;
  type: ProjectElementType;
  parentId: string | null;
  itemId: string | null;
  parameterValue: number | null;
  parameterUnit: string | null;
  parameterSource: ParameterSource | null;
  parameterFormula: string | null;
  parameterItemField: string | null;
  parameterContingencyPercent: number | null;
  allocationPercent: number | null;
  targetOperator: RequirementTargetOperator | null;
  targetValue: number | null;
  targetUpperValue: number | null;
  targetUnit: string | null;
  actualParameterId: string | null;
  verdict: TestCaseVerdict | null;
};

export type VerificationLink = {
  fromElementId: string;
  toElementId: string;
  linkType: ProjectElementLinkType;
};

/** The values of a linked part: its unit cost and its custom field values. */
export type ItemValues = {
  unitCost: number | null;
  customFields: Record<string, unknown> | null;
};

export type RequirementStatus = "Pass" | "Fail" | "Unverified";

export type ParameterVerification = {
  kind: "Parameter";
  computedValue: number | null;
  /** Why `computedValue` is null. */
  reason: string | null;
  mixedUnits: boolean;
  /** The value a `≤` check uses: computed × (1 + contingency). */
  checkedHigh: number | null;
  /** The value a `≥` check uses: computed × (1 − contingency). */
  checkedLow: number | null;
  /** Allocation × the parent Parameter's computed value. */
  budgetValue: number | null;
  /** The parent Parameter's computed value, for `formatAllocation`. */
  parentValue: number | null;
  budgetPass: boolean | null;
};

export type RequirementVerification = {
  kind: "Requirement";
  targetPass: boolean | null;
  anyTestFail: boolean;
  checkCount: number;
  status: RequirementStatus;
};

export type ElementVerification =
  | ParameterVerification
  | RequirementVerification;

function itemFieldValue(
  values: ItemValues | undefined,
  field: string
): FormulaResult {
  if (!values) return { value: null, reason: "The item has no values" };
  const raw =
    field === PARAMETER_ITEM_UNIT_COST
      ? values.unitCost
      : (values.customFields?.[field] ?? null);
  if (raw === null || raw === undefined || raw === "") {
    return { value: null, reason: "The item has no value for this field" };
  }
  const value = typeof raw === "number" ? raw : Number(raw);
  if (typeof raw === "boolean" || !Number.isFinite(value)) {
    return { value: null, reason: "The item field is not a number" };
  }
  return { value, reason: null };
}

/** Whether a checked value meets a Requirement's target. */
function meetsTarget(
  element: VerificationElement,
  parameter: ParameterVerification
): boolean | null {
  const { targetOperator: operator, targetValue: target } = element;
  const { checkedLow: low, checkedHigh: high } = parameter;
  if (!operator || target === null || low === null || high === null) {
    return null;
  }
  const t = Number(target);
  switch (operator) {
    case "≤":
      return high <= t + EPSILON;
    case "≥":
      return low >= t - EPSILON;
    case "=":
      return equals(low, t) && equals(high, t);
    case "Range": {
      if (element.targetUpperValue === null) return null;
      return (
        low >= t - EPSILON && high <= Number(element.targetUpperValue) + EPSILON
      );
    }
  }
}

/**
 * Computes the verification of every Parameter and Requirement of a project
 * from the rows the page already loads. A Parameter's value comes from its
 * source (Manual, a Sum/Min/Max of its direct child Parameters in the same
 * unit, a Formula, or a field of the nearest linked part). Values compute in
 * dependency order; a cycle gives its Parameters null with "Circular
 * formula". A Requirement passes or fails on its target and on the Test Cases
 * that verify it.
 */
export function computeVerification(
  elements: VerificationElement[],
  links: VerificationLink[],
  itemValues: Map<string, ItemValues>
): Map<string, ElementVerification> {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const byReadableId = new Map(elements.map((e) => [e.readableId, e]));
  const childParameters = new Map<string, VerificationElement[]>();
  for (const element of elements) {
    if (element.type !== "Parameter" || !element.parentId) continue;
    const siblings = childParameters.get(element.parentId) ?? [];
    siblings.push(element);
    childParameters.set(element.parentId, siblings);
  }

  const parsed = new Map<string, ReturnType<typeof parseParameterFormula>>();
  const dependencies = new Map<string, string[]>();
  for (const element of elements) {
    if (element.type !== "Parameter") continue;
    const deps: string[] = [];
    if (
      element.parameterSource === "Sum" ||
      element.parameterSource === "Min" ||
      element.parameterSource === "Max"
    ) {
      for (const child of childParameters.get(element.id) ?? []) {
        deps.push(child.id);
      }
    } else if (element.parameterSource === "Formula") {
      const result = parseParameterFormula(element.parameterFormula ?? "");
      parsed.set(element.id, result);
      if ("ast" in result) {
        for (const ref of result.refs) {
          const target = byReadableId.get(ref);
          if (target?.type === "Parameter") deps.push(target.id);
        }
      }
      for (const link of links) {
        if (link.linkType === "feeds" && link.toElementId === element.id) {
          deps.push(link.fromElementId);
        }
      }
    }
    dependencies.set(element.id, [...new Set(deps)]);
  }

  // Tarjan's strongly connected components: every Parameter in a component
  // of two or more (or with a self edge) is part of a cycle.
  const inCycle = new Set<string>();
  {
    let counter = 0;
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const connect = (id: string) => {
      index.set(id, counter);
      low.set(id, counter);
      counter++;
      stack.push(id);
      onStack.add(id);
      for (const dep of dependencies.get(id) ?? []) {
        if (!dependencies.has(dep)) continue;
        if (!index.has(dep)) {
          connect(dep);
          low.set(id, Math.min(low.get(id)!, low.get(dep)!));
        } else if (onStack.has(dep)) {
          low.set(id, Math.min(low.get(id)!, index.get(dep)!));
        }
      }
      if (low.get(id) === index.get(id)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== id);
        if (component.length > 1 || (dependencies.get(id) ?? []).includes(id)) {
          for (const c of component) inCycle.add(c);
        }
      }
    };
    for (const id of dependencies.keys()) {
      if (!index.has(id)) connect(id);
    }
  }

  const result = new Map<string, ElementVerification>();
  const computed = new Map<string, FormulaResult & { mixedUnits: boolean }>();

  const computeParameter = (
    element: VerificationElement
  ): FormulaResult & { mixedUnits: boolean } => {
    const done = computed.get(element.id);
    if (done) return done;
    let value: FormulaResult & { mixedUnits: boolean };
    if (inCycle.has(element.id)) {
      value = { value: null, reason: "Circular formula", mixedUnits: false };
    } else {
      switch (element.parameterSource ?? "Manual") {
        case "Manual":
          value =
            element.parameterValue === null
              ? { value: null, reason: "No value", mixedUnits: false }
              : {
                  value: Number(element.parameterValue),
                  reason: null,
                  mixedUnits: false
                };
          break;
        case "Sum":
        case "Min":
        case "Max": {
          let mixedUnits = false;
          const values: number[] = [];
          let missing: string | null = null;
          for (const child of childParameters.get(element.id) ?? []) {
            if (
              (child.parameterUnit ?? null) !== (element.parameterUnit ?? null)
            ) {
              mixedUnits = true;
              continue;
            }
            const childValue = computeParameter(child);
            if (childValue.value === null) {
              missing ??= `${child.readableId} has no value`;
              continue;
            }
            values.push(childValue.value);
          }
          if (missing) {
            value = { value: null, reason: missing, mixedUnits };
          } else if (values.length === 0) {
            value = {
              value: null,
              reason: "No child Parameters in this unit",
              mixedUnits
            };
          } else {
            const source = element.parameterSource;
            value = {
              value:
                source === "Sum"
                  ? values.reduce((sum, v) => sum + v, 0)
                  : source === "Min"
                    ? Math.min(...values)
                    : Math.max(...values),
              reason: null,
              mixedUnits
            };
          }
          break;
        }
        case "Formula": {
          const formula = parsed.get(element.id);
          if (!formula || "error" in formula) {
            value = {
              value: null,
              reason: formula?.error ?? "No formula",
              mixedUnits: false
            };
            break;
          }
          const parameterOf = (readableId: string) => {
            const ref = byReadableId.get(readableId);
            return ref?.type === "Parameter" ? ref : null;
          };
          value = {
            ...evaluateFormula(formula.ast, (readableId) => {
              const ref = parameterOf(readableId);
              return ref ? computeParameter(ref).value : null;
            }),
            mixedUnits: formulaMixesUnits(
              formula.ast,
              (readableId) => parameterOf(readableId)?.parameterUnit ?? null
            )
          };
          break;
        }
        case "Item": {
          // A Parameter links no part, so the nearest part is above it.
          let itemId: string | null = null;
          const seen = new Set<string>();
          let current: VerificationElement | undefined = element;
          while (current && !seen.has(current.id)) {
            seen.add(current.id);
            if (current.itemId) {
              itemId = current.itemId;
              break;
            }
            current = current.parentId ? byId.get(current.parentId) : undefined;
          }
          value = itemId
            ? {
                ...itemFieldValue(
                  itemValues.get(itemId),
                  element.parameterItemField ?? PARAMETER_ITEM_UNIT_COST
                ),
                mixedUnits: false
              }
            : {
                value: null,
                reason: "No element above links a part",
                mixedUnits: false
              };
          break;
        }
      }
    }
    computed.set(element.id, value);
    return value;
  };

  for (const element of elements) {
    if (element.type !== "Parameter") continue;
    const own = computeParameter(element);
    const contingency = Number(element.parameterContingencyPercent ?? 0);
    const parent = element.parentId ? byId.get(element.parentId) : undefined;
    const parentValue =
      parent?.type === "Parameter" ? computeParameter(parent).value : null;
    const checkedHigh =
      own.value === null ? null : own.value * (1 + contingency);
    const budgetValue =
      element.allocationPercent === null || parentValue === null
        ? null
        : Number(element.allocationPercent) * parentValue;
    result.set(element.id, {
      kind: "Parameter",
      computedValue: own.value,
      reason: own.reason,
      mixedUnits: own.mixedUnits,
      checkedHigh,
      checkedLow: own.value === null ? null : own.value * (1 - contingency),
      budgetValue,
      parentValue,
      budgetPass:
        budgetValue === null || checkedHigh === null
          ? null
          : checkedHigh <= budgetValue + EPSILON
    });
  }

  const verifiers = new Map<string, VerificationElement[]>();
  for (const link of links) {
    if (link.linkType !== "verifies") continue;
    const from = byId.get(link.fromElementId);
    if (from?.type !== "Test Case") continue;
    const list = verifiers.get(link.toElementId) ?? [];
    list.push(from);
    verifiers.set(link.toElementId, list);
  }

  for (const element of elements) {
    if (element.type !== "Requirement") continue;
    const parameter = element.actualParameterId
      ? result.get(element.actualParameterId)
      : undefined;
    const targetPass =
      parameter?.kind === "Parameter" ? meetsTarget(element, parameter) : null;
    const tests = verifiers.get(element.id) ?? [];
    const anyTestFail = tests.some((test) => test.verdict === "Fail");
    const checkCount =
      (targetPass === null ? 0 : 1) +
      tests.filter((test) => test.verdict && test.verdict !== "Not Run").length;
    const status: RequirementStatus =
      targetPass === false || anyTestFail
        ? "Fail"
        : checkCount > 0
          ? "Pass"
          : "Unverified";
    result.set(element.id, {
      kind: "Requirement",
      targetPass,
      anyTestFail,
      checkCount,
      status
    });
  }

  return result;
}

/**
 * Rolls Requirement status up the tree. A Requirement with child
 * Requirements fails when it or any child fails. It passes only when its own
 * status is Pass (or Unverified with no checks) and every child passes.
 * Everything else is Unverified.
 */
export function rollUpRequirementStatus(
  tree: { id: string; parentId: string | null; type: ProjectElementType }[],
  verification: Map<string, ElementVerification>
): Map<string, RequirementStatus> {
  const children = new Map<string, string[]>();
  for (const element of tree) {
    if (element.type !== "Requirement" || !element.parentId) continue;
    const list = children.get(element.parentId) ?? [];
    list.push(element.id);
    children.set(element.parentId, list);
  }

  const rolled = new Map<string, RequirementStatus>();
  const visiting = new Set<string>();
  const statusOf = (id: string): RequirementStatus => {
    const done = rolled.get(id);
    if (done) return done;
    const own = verification.get(id);
    const ownStatus: RequirementStatus =
      own?.kind === "Requirement" ? own.status : "Unverified";
    if (visiting.has(id)) return ownStatus;
    visiting.add(id);
    const childStatuses = (children.get(id) ?? []).map(statusOf);
    visiting.delete(id);

    let status: RequirementStatus;
    if (ownStatus === "Fail" || childStatuses.includes("Fail")) {
      status = "Fail";
    } else if (childStatuses.length === 0) {
      status = ownStatus;
    } else {
      const ownOk =
        ownStatus === "Pass" ||
        (own?.kind === "Requirement" ? own.checkCount === 0 : true);
      status =
        ownOk && childStatuses.every((s) => s === "Pass")
          ? "Pass"
          : "Unverified";
    }
    rolled.set(id, status);
    return status;
  };

  for (const element of tree) {
    if (element.type === "Requirement") statusOf(element.id);
  }
  return rolled;
}

/** A Parameter's budget: `"≤ 600 kg (30% of 2,000 kg)"`. */
export function formatAllocation(
  budgetValue: number,
  allocationPercent: number,
  parentValue: number,
  unit: string | null,
  locale = "en"
): string {
  const withUnit = (value: number) =>
    unit
      ? `${formatQuantity(value, locale)} ${unit}`
      : formatQuantity(value, locale);
  return `≤ ${withUnit(budgetValue)} (${formatPercent(allocationPercent, locale)} of ${withUnit(parentValue)})`;
}

// --- Reader -------------------------------------------------------------------

export type ReaderEntry<T> = {
  element: T;
  /** The tree level, the root is 0. */
  level: number;
  /** The outline number: `1`, `1.2`, `1.2.3`. */
  number: string;
};

/**
 * The elements in tree order with their outline numbers, for the Reader and
 * its PDF. An element whose parent is not in the input starts a new top-level
 * number, as `buildElementTree` puts it at level 0.
 */
export function buildReaderOutline<
  T extends { id: string; parentId: string | null; sortOrder: number }
>(elements: T[]): ReaderEntry<T>[] {
  const counters: number[] = [];
  return buildElementTree(elements).map((node) => {
    counters.length = node.level + 1;
    counters[node.level] = (counters[node.level] ?? 0) + 1;
    return {
      element: node.data,
      level: node.level,
      number: counters.join(".")
    };
  });
}

/** A Requirement's target as text: `≤ 120 g`, `100 – 120 g`. */
export function formatRequirementTarget(
  element: {
    targetOperator: RequirementTargetOperator | null;
    targetValue: number | null;
    targetUpperValue: number | null;
    targetUnit: string | null;
  },
  locale = "en"
): string | null {
  if (!element.targetOperator || element.targetValue === null) return null;
  const unit = element.targetUnit ? ` ${element.targetUnit}` : "";
  const value = formatQuantity(Number(element.targetValue), locale);
  if (element.targetOperator === "Range") {
    const upper =
      element.targetUpperValue === null
        ? "?"
        : formatQuantity(Number(element.targetUpperValue), locale);
    return `${value} – ${upper}${unit}`;
  }
  return `${element.targetOperator} ${value}${unit}`;
}

// --- Element filters ----------------------------------------------------------

/** The values of a `filter=key:eq:a` or `filter=key:in:a,b` search param. */
function filterValues(params: URLSearchParams, key: string): string[] | null {
  for (const filter of params.getAll("filter")) {
    const [column, operator, value] = filter.split(":");
    if (column !== key || !value) continue;
    if (operator === "in") return value.split(",").filter(Boolean);
    if (operator === "eq") return [value];
  }
  return null;
}

export type ProjectElementFilters = {
  type: ProjectElementType[] | null;
  stateGroup: ProjectStateGroup[] | null;
  ownerId: string[] | null;
  milestoneId: string[] | null;
  labelId: string[] | null;
  search: string | null;
};

/**
 * The Elements filters of a query string: `type`, `search` and the
 * `filter=` params of the filter row. The Elements page and the Reader PDF
 * read the same filters, so the PDF prints what the page shows.
 */
export function parseElementFilters(params: URLSearchParams): {
  filters: ProjectElementFilters;
  type: ProjectElementType | null;
  isFiltered: boolean;
} {
  const typeParam = params.get("type");
  const type = projectElementTypes.includes(typeParam as ProjectElementType)
    ? (typeParam as ProjectElementType)
    : null;
  const stateGroup = (filterValues(params, "stateGroup") ?? []).filter((g) =>
    projectStateGroups.includes(g as ProjectStateGroup)
  ) as ProjectStateGroup[];
  const filters: ProjectElementFilters = {
    type: type ? [type] : null,
    stateGroup: stateGroup.length > 0 ? stateGroup : null,
    ownerId: filterValues(params, "ownerId"),
    milestoneId: filterValues(params, "milestoneId"),
    labelId: filterValues(params, "labelId"),
    search: params.get("search") || null
  };
  return {
    filters,
    type,
    isFiltered: Object.values(filters).some((value) => value !== null)
  };
}

// --- Views and preferences ----------------------------------------------------

export type ProjectLayout = Enums["projectLayout"];

/** The layouts of the Elements page, in the order the switcher lists them. */
export const projectLayouts = [
  "list",
  "board",
  "table",
  "tree",
  "timeline",
  "reader"
] as const satisfies readonly ProjectLayout[];

/** The properties the Display menu can show or hide. */
export const elementDisplayProperties = [
  "state",
  "owner",
  "priority",
  "labels",
  "dates",
  "milestone",
  "hours",
  "budget",
  "actual"
] as const;

/** How the Table layout groups its rows. */
export const elementGroupings = [
  "none",
  "state",
  "type",
  "owner",
  "milestone"
] as const;

export const timelineZooms = ["day", "week", "month"] as const;

const elementFilterStateValidator = z.object({
  type: z.enum(projectElementTypes).nullable().catch(null),
  stateGroup: z.array(z.enum(projectStateGroups)).catch([]),
  ownerId: z.array(z.string()).catch([]),
  milestoneId: z.array(z.string()).catch([]),
  labelId: z.array(z.string()).catch([]),
  search: z.string().nullable().catch(null)
});

const elementDisplayOptionsValidator = z.object({
  properties: z
    .partialRecord(z.enum(elementDisplayProperties), z.boolean())
    .catch({}),
  grouping: z.enum(elementGroupings).catch("none"),
  timelineZoom: z.enum(timelineZooms).catch("week")
});

/**
 * The state of the Elements page that a view or a user preference keeps. Each
 * part falls back to its default, so a stored `{}` (the column default) or a
 * value from an older shape still parses.
 */
export const projectDisplayStateValidator = z.object({
  layout: z.enum(projectLayouts).catch("list"),
  filters: elementFilterStateValidator.catch(
    elementFilterStateValidator.parse({})
  ),
  displayOptions: elementDisplayOptionsValidator.catch(
    elementDisplayOptionsValidator.parse({})
  )
});

export type ProjectDisplayState = z.infer<typeof projectDisplayStateValidator>;
export type ProjectElementFilterState = ProjectDisplayState["filters"];
export type ProjectDisplayOptions = ProjectDisplayState["displayOptions"];

/** Parses a stored view or preference row; never throws. */
export function parseProjectDisplayState(row: {
  layout?: unknown;
  filters?: unknown;
  displayOptions?: unknown;
}): ProjectDisplayState {
  return projectDisplayStateValidator.parse({
    layout: row.layout,
    filters: row.filters ?? {},
    displayOptions: row.displayOptions ?? {}
  });
}

/** The search params that carry the Elements page state. */
const DISPLAY_STATE_PARAMS = ["layout", "type", "filter", "search"] as const;

/** True when the URL names no layout, type, filter or search. */
export function isBareElementsUrl(params: URLSearchParams) {
  return DISPLAY_STATE_PARAMS.every((key) => !params.has(key));
}

/** The layout, type, filters and search of the Elements page's URL. */
export function elementFilterStateFromParams(params: URLSearchParams): {
  layout: ProjectLayout;
  filters: ProjectElementFilterState;
} {
  const layoutParam = params.get("layout");
  const layout = projectLayouts.includes(layoutParam as ProjectLayout)
    ? (layoutParam as ProjectLayout)
    : "list";
  const { filters, type } = parseElementFilters(params);
  return {
    layout,
    filters: {
      type,
      stateGroup: filters.stateGroup ?? [],
      ownerId: filters.ownerId ?? [],
      milestoneId: filters.milestoneId ?? [],
      labelId: filters.labelId ?? [],
      search: filters.search
    }
  };
}

/**
 * The search params of a state. `layout` is always set, so a URL the page made
 * is never bare: only a link from outside the page takes the preference.
 */
export function displayStateToParams(
  state: Pick<ProjectDisplayState, "layout" | "filters">,
  viewId?: string | null
) {
  const params = new URLSearchParams();
  params.set("layout", state.layout);
  if (viewId) params.set("view", viewId);
  if (state.filters.type) params.set("type", state.filters.type);
  for (const key of [
    "stateGroup",
    "ownerId",
    "milestoneId",
    "labelId"
  ] as const) {
    const values = state.filters[key];
    if (values.length > 0)
      params.append("filter", `${key}:in:${values.join(",")}`);
  }
  if (state.filters.search) params.set("search", state.filters.search);
  return params;
}

export const projectViewValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  isShared: zfd.checkbox(),
  state: z.string().min(1)
});

// --- Copying a project ---------------------------------------------------------

/**
 * Rewrites the element refs of a formula through `readableIds` (old → new).
 * Only whole ref tokens change, so `SNS-2` never rewrites the `SNS-2` inside
 * `SNS-20`. A formula that does not parse, or a ref with no entry, is kept.
 */
export function rewriteFormulaRefs(
  text: string,
  readableIds: Map<string, string>
): string {
  const start = text.indexOf("=");
  if (start < 0) return text;
  let tokens: FormulaToken[];
  try {
    tokens = tokenizeFormula(text, start + 1);
  } catch {
    return text;
  }
  let result = text;
  // From the end, so earlier positions stay valid.
  for (const token of [...tokens].reverse()) {
    if (token.kind !== "ref") continue;
    const next = readableIds.get(token.id);
    if (!next) continue;
    result =
      result.slice(0, token.position) +
      next +
      result.slice(token.position + token.id.length);
  }
  return result;
}

type CopyRow = Record<string, unknown>;

/** The columns a copy never takes from its source; the caller sets them. */
const COPY_AUDIT_KEYS = [
  "companyId",
  "createdBy",
  "createdAt",
  "updatedBy",
  "updatedAt"
] as const;

/** The row without its audit columns (the type keeps them, as optional). */
function withoutAudit<T extends CopyRow>(row: T): T {
  const copy: CopyRow = { ...row };
  for (const key of COPY_AUDIT_KEYS) delete copy[key];
  return copy as T;
}

export type ProjectCopyElement = CopyRow & {
  id: string;
  readableId: string;
  sequence: number;
  parentId: string | null;
  stateId: string;
  milestoneId: string | null;
  actualParameterId: string | null;
  parameterFormula: string | null;
};

export type ProjectCopySource = {
  states: (CopyRow & { id: string })[];
  labels: (CopyRow & { id: string })[];
  milestones: (CopyRow & { id: string })[];
  elements: ProjectCopyElement[];
  elementLabels: { projectElementId: string; projectLabelId: string }[];
  links: (CopyRow & {
    id: string;
    fromElementId: string;
    toElementId: string;
  })[];
  materials: (CopyRow & { id: string; projectElementId: string })[];
  labor: (CopyRow & { id: string; projectElementId: string })[];
  costs: (CopyRow & { id: string; projectElementId: string })[];
};

/** The id prefixes of the copied tables, as the SQL `id()` defaults use them. */
export const projectCopyIdPrefixes = {
  state: "pjs",
  label: "pjb",
  milestone: "pjm",
  element: "pje",
  link: "pjk",
  material: "pjp",
  labor: "pjr",
  cost: "pjo"
} as const;

/**
 * Plans the rows of a project copy, with new ids from `makeId`. Every
 * reference is remapped to the copy: element parents, states, milestones and
 * actual Parameters, element labels, both ends of each link. Elements are
 * renumbered from 1 in the source's sequence order and returned parents
 * first; formulas name the new readable ids. What belongs to the source's
 * history is cleared: the element's asset, a test verdict, a link's suspect
 * flag and review, a material's issued quantity and its job or PO line.
 */
export function planProjectCopy(
  source: ProjectCopySource,
  newProjectId: string,
  identifier: string,
  makeId: (prefix: string) => string
) {
  const remap = <T extends { id: string }>(rows: T[], prefix: string) =>
    new Map(rows.map((row) => [row.id, makeId(prefix)]));
  const stateIds = remap(source.states, projectCopyIdPrefixes.state);
  const labelIds = remap(source.labels, projectCopyIdPrefixes.label);
  const milestoneIds = remap(
    source.milestones,
    projectCopyIdPrefixes.milestone
  );

  const ordered = [...source.elements].sort(
    (a, b) =>
      a.sequence - b.sequence || a.readableId.localeCompare(b.readableId)
  );
  const elementIds = new Map<string, string>();
  const readableIds = new Map<string, string>();
  const sequences = new Map<string, number>();
  ordered.forEach((element, index) => {
    elementIds.set(element.id, makeId(projectCopyIdPrefixes.element));
    sequences.set(element.id, index + 1);
    readableIds.set(element.readableId, `${identifier}-${index + 1}`);
  });

  // Parents first: an element's depth is one more than its parent's.
  const byId = new Map(source.elements.map((element) => [element.id, element]));
  const depth = new Map<string, number>();
  const depthOf = (
    element: ProjectCopyElement,
    seen = new Set<string>()
  ): number => {
    const known = depth.get(element.id);
    if (known !== undefined) return known;
    const parent = element.parentId ? byId.get(element.parentId) : undefined;
    const value: number =
      parent && !seen.has(parent.id)
        ? depthOf(parent, seen.add(element.id)) + 1
        : 0;
    depth.set(element.id, value);
    return value;
  };
  const elements = [...ordered]
    .sort((a, b) => depthOf(a) - depthOf(b))
    .map((element) => ({
      ...withoutAudit(element),
      id: elementIds.get(element.id)!,
      projectId: newProjectId,
      sequence: sequences.get(element.id)!,
      readableId: `${identifier}-${sequences.get(element.id)!}`,
      parentId: element.parentId
        ? (elementIds.get(element.parentId) ?? null)
        : null,
      stateId: stateIds.get(element.stateId) ?? element.stateId,
      milestoneId: element.milestoneId
        ? (milestoneIds.get(element.milestoneId) ?? null)
        : null,
      actualParameterId: element.actualParameterId
        ? (elementIds.get(element.actualParameterId) ?? null)
        : null,
      parameterFormula: element.parameterFormula
        ? rewriteFormulaRefs(element.parameterFormula, readableIds)
        : null,
      fixedAssetId: null,
      verdict: null,
      verdictAt: null,
      verdictBy: null
    }));

  const planLines = <
    T extends CopyRow & { id: string; projectElementId: string }
  >(
    rows: T[],
    prefix: string
  ) =>
    rows
      .filter((row) => elementIds.has(row.projectElementId))
      .map((row) => ({
        ...withoutAudit(row),
        id: makeId(prefix),
        projectId: newProjectId,
        projectElementId: elementIds.get(row.projectElementId)!
      }));

  return {
    states: source.states.map((state) => ({
      ...withoutAudit(state),
      id: stateIds.get(state.id)!,
      projectId: newProjectId
    })),
    labels: source.labels.map((label) => ({
      ...withoutAudit(label),
      id: labelIds.get(label.id)!,
      projectId: newProjectId
    })),
    milestones: source.milestones.map((milestone) => ({
      ...withoutAudit(milestone),
      id: milestoneIds.get(milestone.id)!,
      projectId: newProjectId
    })),
    elements,
    elementLabels: source.elementLabels
      .filter(
        (row) =>
          elementIds.has(row.projectElementId) &&
          labelIds.has(row.projectLabelId)
      )
      .map((row) => ({
        projectElementId: elementIds.get(row.projectElementId)!,
        projectLabelId: labelIds.get(row.projectLabelId)!
      })),
    links: source.links
      .filter(
        (link) =>
          elementIds.has(link.fromElementId) && elementIds.has(link.toElementId)
      )
      .map((link) => ({
        ...withoutAudit(link),
        id: makeId(projectCopyIdPrefixes.link),
        projectId: newProjectId,
        fromElementId: elementIds.get(link.fromElementId)!,
        toElementId: elementIds.get(link.toElementId)!,
        suspectSince: null,
        reviewedAt: null,
        reviewedBy: null
      })),
    materials: planLines(source.materials, projectCopyIdPrefixes.material).map(
      (material) => ({
        ...material,
        quantityIssued: 0,
        jobId: null,
        purchaseOrderLineId: null
      })
    ),
    labor: planLines(source.labor, projectCopyIdPrefixes.labor),
    costs: planLines(source.costs, projectCopyIdPrefixes.cost),
    nextElementSequence: ordered.length + 1
  };
}

// --- Jobs and purchase order lines from plan-line materials ---------------------

/** Create Job from a Make to Order plan-line material. */
export const createJobFromMaterialValidator = z.object({
  materialId: z.string().min(1, { message: "Material is required" }),
  quantity: zfd.numeric(
    z.number().gt(0, { message: "Quantity must be greater than 0" })
  ),
  dueDate: zfd.text(z.string().optional()),
  locationId: z.string().min(1, { message: "Location is required" })
});

/**
 * The quantity a plan-line material still needs: planned less issued, never
 * below zero.
 */
export function remainingMaterialQuantity(line: {
  quantity: number | string;
  quantityIssued: number | string | null;
}) {
  return Math.max(0, Number(line.quantity) - Number(line.quantityIssued ?? 0));
}

/** The **Add to** value that makes a new purchase order. */
export const NEW_PURCHASE_ORDER = "new";

/** Create PO line from a Purchase to Order plan-line material. */
export const createPurchaseOrderLineFromMaterialValidator = z.object({
  materialId: z.string().min(1, { message: "Material is required" }),
  supplierId: z.string().min(1, { message: "Supplier is required" }),
  quantity: zfd.numeric(
    z.number().gt(0, { message: "Quantity must be greater than 0" })
  ),
  requiredDate: zfd.text(z.string().optional()),
  purchaseOrderId: z.string().min(1, { message: "Choose a purchase order" })
});

// --- Milestone burn chart -------------------------------------------------------

export type BurnPoint = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Days since the start: 0 on the start date. */
  day: number;
  /** The straight line from 0 on the start date to the planned hours on the end date. */
  ideal: number;
  /** Posted hours up to and including the date; null after `today`. */
  actual: number | null;
};

/**
 * One point per day from `startDate` to `endDate` (both `YYYY-MM-DD`): the
 * ideal hours, `plannedHours × day ÷ days`, and the cumulative posted hours of
 * `entries` up to that day (an entry before the start counts from day 0; one
 * after the end does not count). Days after `today`, when given, have no
 * actual. An end before the start gives no points.
 */
export function buildBurnSeries(args: {
  startDate: string;
  endDate: string;
  plannedHours: number;
  entries: { entryDate: string; hours: number }[];
  today?: string;
}): BurnPoint[] {
  const start = parseDate(args.startDate);
  const end = parseDate(args.endDate);
  const days = end.compare(start);
  if (days < 0) return [];

  const hoursByDay = new Array<number>(days + 1).fill(0);
  for (const entry of args.entries) {
    const day = Math.max(0, parseDate(entry.entryDate).compare(start));
    if (day > days) continue;
    hoursByDay[day] = (hoursByDay[day] ?? 0) + Number(entry.hours);
  }

  const today = args.today ? parseDate(args.today) : null;
  const points: BurnPoint[] = [];
  let cumulative = 0;
  for (let day = 0; day <= days; day++) {
    const date = start.add({ days: day });
    cumulative += hoursByDay[day] ?? 0;
    points.push({
      date: date.toString(),
      day,
      ideal: days === 0 ? args.plannedHours : (args.plannedHours * day) / days,
      actual: today && date.compare(today) > 0 ? null : cumulative
    });
  }
  return points;
}
