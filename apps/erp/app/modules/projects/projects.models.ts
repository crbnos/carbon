// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  isPlanLayerField,
  PLAN_LAYER_FIELDS,
  type PlanRow,
  type PlanScheduleRow,
  PROJECT_BASELINE_FORMAT_VERSION,
  type ProjectPlanSnapshot,
  type ProjectPlanSnapshotKey,
  parsePlanSnapshot,
  pickPlanLayerFields,
  planSnapshotKeys,
  toPlanSnapshot
} from "@carbon/database/project-plan";
import { stripCsvFormulaPrefix } from "@carbon/files/csv";
import {
  computeWbsCodes,
  EPSILON,
  equals,
  estimateAtCompletion,
  formatPercent,
  formatQuantity,
  isValidWbsCode,
  type QualifiedHours,
  round,
  type Section6765Input,
  type WbsNode,
  type WbsTemplateRow,
  wageQres,
  wbsTemplateParentCode,
  workCountryClass
} from "@carbon/utils";
import { getDayOfWeek, parseDate, startOfWeek } from "@internationalized/date";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { type DiffEntry, diffFields, diffRows } from "../shared/diff";
import { methodType, months, optionalTiptapDoc } from "../shared/shared.models";

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

export type ProjectCostObjective = Enums["projectCostObjective"];

/** Government Contracting 5a: the cost objective a project charges. */
export const projectCostObjectives = [
  "Direct",
  "IR&D",
  "B&P",
  "Indirect",
  "Commercial"
] as const satisfies readonly ProjectCostObjective[];

/**
 * The cost objectives a project of this cost treatment may take. An Expense
 * project is an indirect or independent research project, never a contract
 * (`project_costObjective_treatment_check`).
 */
export function costObjectivesForTreatment(
  costTreatment: string
): readonly ProjectCostObjective[] {
  return costTreatment === "Expense"
    ? ["IR&D", "B&P", "Indirect"]
    : projectCostObjectives;
}

/** DCAA mode: every project needs a cost objective. */
export const COST_OBJECTIVE_REQUIRED =
  "Set a cost objective. DCAA timekeeping requires one";

export const projectElementTypes = [
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
  "Rejected",
  "Pending Employee Review"
] as const satisfies readonly TimesheetEntryStatus[];

/** Whether a new element of each type takes charges when the user does not say. */
export const chargeableByDefault: Record<ProjectElementType, boolean> = {
  System: true,
  Requirement: true,
  Function: true,
  Task: true,
  "Test Case": true,
  Parameter: false
};

/**
 * The six states every new project starts with. Shared with the server
 * functions, which create a service order's project in their own transaction.
 */

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
    priority: zfd.text(z.enum(projectElementPriorities).optional()),
    // After this milestone completes, the plan layer changes only through a
    // change request.
    lockPlanAfterMilestoneId: zfd.text(z.string().optional()),
    // Project stock (Phase 2a): the project owns the stock received for it.
    // Set while Draft only; the details action keeps it after that.
    projectStock: zfd.checkbox().optional(),
    // Project stock: write the projectLedger row at receipt, not at issue.
    chargeAtReceipt: zfd.checkbox().optional(),
    // Project stock: government-furnished material stays with its customer.
    governmentFurnished: zfd.checkbox().optional(),
    // Projects Phase 3: a project with project stock may join a planning
    // group at its location. The details action checks the group.
    planningGroupId: zfd.text(z.string().optional()),
    // Orders the group's pegs under the Project Priority rule; lower first.
    planningPriority: zfd.numeric(
      z
        .number()
        .int()
        .min(0, { message: "Priority cannot be negative" })
        .optional()
    ),
    // Government Contracting 5a: the cost objective, and whether only the
    // project's members may charge time to it (DCAA mode).
    costObjective: zfd.text(z.enum(projectCostObjectives).optional()),
    restrictCharging: zfd.checkbox().optional()
  })
  .refine(
    (data) => data.costTreatment !== "Capitalize" || !!data.fixedAssetClassId,
    {
      message: "A capital project needs a Construction in Progress class",
      path: ["fixedAssetClassId"]
    }
  )
  .refine(
    (data) =>
      !data.costObjective ||
      costObjectivesForTreatment(data.costTreatment).includes(
        data.costObjective
      ),
    {
      message: "An Expense project's cost objective is IR&D, B&P or Indirect",
      path: ["costObjective"]
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

/**
 * The refusal for a status change of a project with a stop-work order, else
 * null (C16). The order keeps the project On Hold until Resume, which also
 * clears it; the CHECK `project_stopWork_check` refuses any other status.
 */
export function stopWorkStatusRefusal(
  stopWorkDate: string | null,
  to: ProjectStatus
): string | null {
  if (!stopWorkDate || to === "On Hold") return null;
  return "This project has a stop-work order. Use Resume.";
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
  "wbsCode",
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
  "trackedEntityId",
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
  "allocationPercent",
  // Government Contracting 5a element flags.
  "isUnallowable",
  "isPreproduction",
  "isLeave",
  // Government Contracting 5d: the R&D tax business component.
  "isBusinessComponent",
  "rdComponentType",
  "rdSoftwareType"
] as const;

export type ProjectElementEditableField =
  (typeof projectElementEditableFields)[number];

// --- R&D tax (Government Contracting 5d) ---------------------------------------

export type RdActivityRole = Enums["rdActivityRole"];

/** The research role of time: Form 6765 columns 50–52, or none. */
export const rdActivityRoles = [
  "Direct Research",
  "Direct Supervision",
  "Direct Support",
  "Not Qualified"
] as const satisfies readonly RdActivityRole[];

/** Form 6765 column 49(d): the type of a business component. */
export const rdComponentTypes = ["Product", "Process", "All Others"] as const;
export type RdComponentType = (typeof rdComponentTypes)[number];

/** Form 6765 column 49(e): the software type of a business component. */
export const rdSoftwareTypes = [
  "Internal Use",
  "Dual Function",
  "Non-Internal Use",
  "Excepted"
] as const;
export type RdSoftwareType = (typeof rdSoftwareTypes)[number];

/**
 * The Form 6765 column 49(e) text of each software type, as the IRS
 * instructions word it. No letter codes: the instructions disagree on them.
 */
const RD_SOFTWARE_TYPE_IRS_TEXT: Record<RdSoftwareType, string> = {
  "Internal Use": "IUS—internal use software",
  "Dual Function": "DFS—dual function software",
  "Non-Internal Use": "Non-IUS",
  Excepted: "Excepted from IUS treatment"
};

/** Column 49(e) for a stored software type; blank when there is none. */
export function rdSoftwareTypeIrsText(
  softwareType: string | null
): string | null {
  if (!softwareType) return null;
  return (
    RD_SOFTWARE_TYPE_IRS_TEXT[softwareType as RdSoftwareType] ?? softwareType
  );
}

/**
 * The element type a MIL-STD-881F template row is built as: a row with
 * children is a System, a leaf a Task. Both take charges by default.
 */
export function wbsTemplateElementType(
  code: string,
  rows: readonly WbsTemplateRow[]
): "System" | "Task" {
  return rows.some((row) => wbsTemplateParentCode(row.code, rows) === code)
    ? "System"
    : "Task";
}

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
  /** R&D tax: the default research role of time in this category. */
  rdActivityRole: zfd.text(z.enum(rdActivityRoles).optional()),
  active: zfd.checkbox().optional()
});

export const laborCategoryRateValidator = z.object({
  id: zfd.text(z.string().optional()),
  laborCategoryId: z.string().min(1, { message: "Labor category is required" }),
  costRate: zfd.numeric(
    z.number().min(0, { message: "Rate cannot be negative" })
  ),
  /** The default price of an hour (contract billing); empty is none. */
  billRate: zfd.numeric(
    z.number().min(0, { message: "Rate cannot be negative" }).optional()
  ),
  effectiveFrom: z.string().min(1, { message: "Effective date is required" })
});

/** A review action on contract billable items (Projects → Billing). */
export const billableItemActions = [
  "hold",
  "release",
  "writeOff",
  "price"
] as const;

export type BillableItemAction = (typeof billableItemActions)[number];

export const billableItemActionValidator = z
  .object({
    ids: zfd
      .repeatableOfType(z.string().min(1))
      .pipe(
        z.array(z.string()).min(1, { message: "Choose at least one item" })
      ),
    action: z.enum(billableItemActions, { error: "Action is required" }),
    reason: zfd.text(z.string().trim().optional()),
    unitPrice: zfd.numeric(
      z.number().min(0, { message: "The price cannot be negative" }).optional()
    )
  })
  .refine(
    (data) =>
      (data.action !== "hold" && data.action !== "writeOff") || !!data.reason,
    { message: "A reason is required", path: ["reason"] }
  )
  .refine((data) => data.action !== "price" || data.unitPrice !== undefined, {
    message: "A unit price is required",
    path: ["unitPrice"]
  })
  .refine((data) => data.action !== "price" || data.ids.length === 1, {
    message: "Edit the price of one item at a time",
    path: ["ids"]
  });

export const planningGroupExcessRules = [
  "Common Stock",
  "Exception Project"
] as const satisfies readonly Database["public"]["Enums"]["planningGroupExcessRule"][];

export const planningGroupPriorityRules = [
  "Earliest Need",
  "Project Priority"
] as const satisfies readonly Database["public"]["Enums"]["planningGroupPriorityRule"][];

/** A planning group (Projects Phase 3): projects that net in one segment. */
export const planningGroupValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().trim().min(1, { message: "Name is required" }),
    locationId: z.string().min(1, { message: "Location is required" }),
    excessRule: z.enum(planningGroupExcessRules, {
      error: "Excess rule is required"
    }),
    exceptionProjectId: zfd.text(z.string().optional()),
    priorityRule: z.enum(planningGroupPriorityRules, {
      error: "Priority rule is required"
    }),
    active: zfd.checkbox()
  })
  .refine(
    (data) =>
      data.excessRule !== "Exception Project" || !!data.exceptionProjectId,
    {
      message: "Choose the project that takes the excess",
      path: ["exceptionProjectId"]
    }
  );

/** The supply types a Manual peg may name: a planned order is never fixed. */
export const manualPegSupplyTypes = ["Purchase Order Line", "Job"] as const;

/**
 * A Manual peg (Projects Phase 3): a planner's override of one Soft peg of
 * the project. `supply` is `<supplyType>:<supplyId>`.
 */
export const manualPegValidator = z.object({
  pegId: z.string().min(1, { message: "Peg is required" }),
  supply: z
    .string()
    .min(1, { message: "Supply is required" })
    .refine(
      (value) =>
        manualPegSupplyTypes.some((type) => value.startsWith(`${type}:`)),
      { message: "Supply is required" }
    ),
  quantity: zfd.numeric(
    z.number().positive({ message: "Quantity must be greater than 0" })
  ),
  manualReason: z.string().trim().min(1, { message: "Reason is required" })
});

/** Splits a Manual peg form's `supply` value into its type and id. */
export function parseManualPegSupply(value: string): {
  supplyType: (typeof manualPegSupplyTypes)[number];
  supplyId: string;
} | null {
  const supplyType = manualPegSupplyTypes.find((type) =>
    value.startsWith(`${type}:`)
  );
  if (!supplyType) return null;
  const supplyId = value.slice(supplyType.length + 1);
  return supplyId ? { supplyType, supplyId } : null;
}

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
  ),
  // DCAA mode: the reason for a late entry, and for a change to a saved one.
  lateReason: zfd.text(z.string().trim().optional()),
  reason: zfd.text(z.string().trim().optional()),
  // R&D tax: where the work took place and its research role. A field that
  // is not sent takes its default in save-timesheet-entry; an empty one is
  // none.
  workLocationId: z.string().optional(),
  rdActivityRole: z.union([z.enum(rdActivityRoles), z.literal("")]).optional()
});

/** A project member: who may charge time to a project that restricts it. */
export const projectMemberValidator = z.object({
  projectId: z.string().min(1, { message: "Project is required" }),
  userId: z.string().min(1, { message: "Employee is required" })
});

/** Submits a week of the timesheet. DCAA mode also certifies it. */
export const timesheetWeekSubmitValidator = z.object({
  weekStart: z.string().min(1, { message: "Week is required" }),
  certificationText: zfd.text(z.string().optional())
});

/** The employee accepts the entries that another user changed. */
export const timesheetReviewAcceptValidator = z.object({
  ids: zfd.repeatable(
    z.array(z.string().min(1)).min(1, { message: "No entries selected" })
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
  ),
  // DCAA mode: the reason for a date before the entry window.
  lateReason: zfd.text(z.string().trim().optional())
});

/**
 * The reasons DCAA mode asks for before a timesheet cell saves: one for a
 * change to a saved entry, one for a date before the entry window. The form
 * says which it needs.
 */
export const timesheetChangeValidator = z
  .object({
    requiresReason: zfd.checkbox(),
    requiresLateReason: zfd.checkbox(),
    reason: zfd.text(z.string().trim().optional()),
    lateReason: zfd.text(z.string().trim().optional())
  })
  .superRefine((value, ctx) => {
    if (value.requiresReason && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "Give a reason for the change"
      });
    }
    if (value.requiresLateReason && !value.lateReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lateReason"],
        message: "Give a reason for the late entry"
      });
    }
  });

/** A new row of the timesheet grid: a charge number and a labor category. */
export const timesheetRowValidator = z.object({
  projectId: z.string().min(1, { message: "Charge number is required" }),
  projectElementId: zfd.text(z.string().optional()),
  laborCategoryId: z.string().min(1, { message: "Labor category is required" }),
  // R&D tax: an empty value is none.
  workLocationId: z.string().optional(),
  rdActivityRole: z.union([z.enum(rdActivityRoles), z.literal("")]).optional()
});

/** The grid key of a timesheet row, as `groupTimesheetRows` builds it. */
export function timesheetRowKey(row: {
  projectId: string;
  projectElementId?: string | null;
  laborCategoryId: string;
  workLocationId?: string | null;
  rdActivityRole?: RdActivityRole | null;
}): string {
  return [
    row.projectId,
    row.projectElementId ?? "",
    row.laborCategoryId,
    row.workLocationId ?? "",
    row.rdActivityRole ?? ""
  ].join("\u001f");
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
    .min(1, { message: "A reason is required for a correction" }),
  // A labor transfer: the new charge number and labor category. Empty keeps
  // the original's.
  projectId: zfd.text(z.string().optional()),
  projectElementId: zfd.text(z.string().optional()),
  laborCategoryId: zfd.text(z.string().optional())
});

export const LABOR_TRANSFER_SAME_APPROVER =
  "A labor transfer needs an approver other than the requester";

/**
 * In DCAA mode, a labor transfer (an entry with `correctionOfId`) needs an
 * approver other than the user who created it. Throws
 * `LABOR_TRANSFER_SAME_APPROVER` when the approver is the requester.
 */
export function assertCanApprove(args: {
  mode: Database["public"]["Enums"]["timekeepingControls"];
  approverId: string;
  entry: { correctionOfId: string | null; createdBy: string };
}): void {
  if (args.mode !== "DCAA") return;
  if (args.entry.correctionOfId && args.entry.createdBy === args.approverId) {
    throw new Error(LABOR_TRANSFER_SAME_APPROVER);
  }
}

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

// --- Project stock transfers ---------------------------------------------------

export const projectStockTransferTypes = [
  "Transfer",
  "Borrow",
  "Payback"
] as const satisfies readonly Database["public"]["Enums"]["projectStockTransferType"][];

export type ProjectStockTransferType =
  Database["public"]["Enums"]["projectStockTransferType"];

export const projectStockTransferStatuses = [
  "Draft",
  "Approved",
  "Posted",
  "Cancelled"
] as const satisfies readonly Database["public"]["Enums"]["projectStockTransferStatus"][];

export type ProjectStockTransferStatus =
  Database["public"]["Enums"]["projectStockTransferStatus"];

export const projectBorrowStatuses = [
  "Open",
  "Paid Back"
] as const satisfies readonly Database["public"]["Enums"]["projectBorrowStatus"][];

export type ProjectBorrowStatus =
  Database["public"]["Enums"]["projectBorrowStatus"];

/**
 * The owner-picker value for common stock. A transfer stores common stock as
 * a null project; a form field cannot carry null, so it carries this.
 */
export const COMMON_STOCK_OWNER = "common";

/** A stock owner field's value as the project id to store (null: common). */
export function toStockOwner(value: string | null | undefined) {
  if (!value || value === COMMON_STOCK_OWNER) return null;
  return value;
}

/** A stored owner (null: common) as the owner field's value. */
export function fromStockOwner(projectId: string | null | undefined) {
  return projectId ?? COMMON_STOCK_OWNER;
}

/**
 * A project stock transfer header. A Payback names the borrow it settles,
 * and its owners come from that borrow. A Transfer or Borrow names both
 * owners; a Borrow runs between two projects and needs a payback due date.
 */
export const projectStockTransferValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    type: z.enum(projectStockTransferTypes, { error: "Type is required" }),
    fromProjectId: zfd.text(z.string().optional()),
    toProjectId: zfd.text(z.string().optional()),
    locationId: zfd.text(z.string().optional()),
    reason: z.string().trim().min(1, { message: "Reason is required" }),
    paybackDueDate: zfd.text(z.string().optional()),
    settlesBorrowId: zfd.text(z.string().optional())
  })
  .refine((v) => v.type === "Payback" || Boolean(v.fromProjectId), {
    message: "From is required",
    path: ["fromProjectId"]
  })
  .refine((v) => v.type === "Payback" || Boolean(v.toProjectId), {
    message: "To is required",
    path: ["toProjectId"]
  })
  .refine((v) => v.type === "Payback" || Boolean(v.locationId), {
    message: "Location is required",
    path: ["locationId"]
  })
  .refine(
    (v) =>
      v.type === "Payback" ||
      toStockOwner(v.fromProjectId) !== toStockOwner(v.toProjectId),
    { message: "From and To must be different owners", path: ["toProjectId"] }
  )
  .refine(
    (v) =>
      v.type !== "Borrow" ||
      (toStockOwner(v.fromProjectId) !== null &&
        toStockOwner(v.toProjectId) !== null),
    {
      message: "A borrow runs between two projects",
      path: ["fromProjectId"]
    }
  )
  .refine((v) => v.type !== "Borrow" || Boolean(v.paybackDueDate), {
    message: "Payback due date is required",
    path: ["paybackDueDate"]
  })
  .refine((v) => v.type !== "Payback" || Boolean(v.settlesBorrowId), {
    message: "Select the borrow to pay back",
    path: ["settlesBorrowId"]
  });

export const projectStockTransferLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item is required" }),
  storageUnitId: zfd.text(z.string().optional()),
  trackedEntityId: zfd.text(z.string().optional()),
  quantity: zfd.numeric(
    z.number().gt(0, { message: "Quantity must be greater than 0" })
  )
});

/** The status actions of a project stock transfer. */
export const projectStockTransferActions = [
  "approve",
  "post",
  "cancel"
] as const;

export type ProjectStockTransferAction =
  (typeof projectStockTransferActions)[number];

/** The statuses each status action starts from. */
export const projectStockTransferActionFrom: Record<
  ProjectStockTransferAction,
  ProjectStockTransferStatus[]
> = {
  approve: ["Draft"],
  post: ["Approved"],
  cancel: ["Draft", "Approved"]
};

type StockOwnerProject = {
  id: string;
  identifier: string | null;
  name: string;
  customerId: string | null;
  governmentFurnished: boolean;
};

/**
 * The government-furnished refusal for a transfer, or null. Stock of a
 * government-furnished project moves only to a project of the same customer
 * (the rule `post-project-stock-transfer` enforces at posting).
 */
export function governmentFurnishedRefusal(
  from: StockOwnerProject | null | undefined,
  to: StockOwnerProject | null | undefined
): string | null {
  if (!from?.governmentFurnished) return null;
  if (to && from.customerId && to.customerId === from.customerId) return null;
  return `Government-furnished stock of project ${
    from.identifier || from.name
  } can only move to a project of the same customer`;
}

/**
 * True when an open borrow is past its payback due date. Dates are
 * `YYYY-MM-DD` strings, so string order is date order.
 */
export function isBorrowOverdue(
  borrow: { status: ProjectBorrowStatus; paybackDueDate: string },
  today: string
) {
  return borrow.status === "Open" && borrow.paybackDueDate < today;
}

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

/** Where a dragged element lands against the row it is dropped on. */
export type ElementDropPosition = "before" | "after" | "inside";

export type ElementDropPlan<T> = {
  /** The new parent; null for the top level. */
  parentId: string | null;
  /** True when the parent changes (a `move`), false for a reorder. */
  isMove: boolean;
  /** The new parent's children, numbered 1… in their new order. */
  order: { id: string; sortOrder: number }[];
  /** The elements as they will be after the drop, for an optimistic tree. */
  elements: T[];
};

/**
 * Plans a drag-and-drop of `elementId` onto `targetId`: `before` or `after`
 * makes it the target's sibling, `inside` its last child. Returns null for a
 * drop the move route would refuse (onto itself or a descendant, a
 * non-Parameter under a Parameter) and for one that changes nothing. A parent
 * missing from the input counts as the top level, as in `buildElementTree`.
 */
export function planElementDrop<
  T extends {
    id: string;
    parentId: string | null;
    sortOrder: number;
    type: ProjectElementType;
  }
>(
  elements: T[],
  args: { elementId: string; targetId: string; position: ElementDropPosition }
): ElementDropPlan<T> | null {
  const { elementId, targetId, position } = args;
  if (elementId === targetId) return null;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const dragged = byId.get(elementId);
  const target = byId.get(targetId);
  if (!dragged || !target) return null;
  const parentOf = (e: T) =>
    e.parentId && byId.has(e.parentId) ? e.parentId : null;

  // The target may not sit in the dragged element's subtree.
  for (let id: string | null = targetId; id; ) {
    if (id === elementId) return null;
    const current = byId.get(id);
    id = current ? parentOf(current) : null;
  }

  const parentId = position === "inside" ? targetId : parentOf(target);
  const parent = parentId ? byId.get(parentId) : undefined;
  if (parent?.type === "Parameter" && dragged.type !== "Parameter") {
    return null;
  }

  const siblings = elements
    .filter((e) => e.id !== elementId && parentOf(e) === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const targetIndex = siblings.findIndex((e) => e.id === targetId);
  const index =
    position === "inside"
      ? siblings.length
      : position === "before"
        ? targetIndex
        : targetIndex + 1;
  const next = [...siblings.slice(0, index), dragged, ...siblings.slice(index)];

  const isMove = parentOf(dragged) !== parentId;
  if (!isMove) {
    const current = elements
      .filter((e) => parentOf(e) === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((e) => e.id);
    if (current.every((id, i) => next[i]?.id === id)) return null;
  }

  const order = next.map((e, i) => ({ id: e.id, sortOrder: i + 1 }));
  const sortOrders = new Map(order.map((o) => [o.id, o.sortOrder]));
  return {
    parentId,
    isMove,
    order,
    elements: elements.map((e) =>
      e.id === elementId
        ? { ...e, parentId, sortOrder: sortOrders.get(e.id)! }
        : sortOrders.has(e.id)
          ? { ...e, sortOrder: sortOrders.get(e.id)! }
          : e
    )
  };
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
  workLocationId: string | null;
  rdActivityRole: RdActivityRole | null;
  /** The first entry of the row, for its display fields. */
  entry: T;
  cells: Record<string, TimesheetCell>;
  total: number;
};

/**
 * Groups timesheet entries into grid rows: one row per project, element,
 * labor category, work location and research role, with one cell per date. Two entries on the same date (a
 * correction and its reversal) add up in one cell; the cell names the Draft
 * entry when there is one, because that is the entry a user can edit.
 */
export function groupTimesheetRows<
  T extends {
    id: string;
    projectId: string;
    projectElementId: string | null;
    laborCategoryId: string;
    workLocationId?: string | null;
    rdActivityRole?: RdActivityRole | null;
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
        workLocationId: entry.workLocationId ?? null,
        rdActivityRole: entry.rdActivityRole ?? null,
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
  /** The part of `actual` posted as unallowable. */
  unallowable: number;
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
    actualUnallowable: number;
    actualHours: number;
  }[]
): { byElement: Map<string, CostTotals>; project: CostTotals } {
  const parentOf = new Map<string, string | null>();
  const byElement = new Map<string, CostTotals>();
  const empty = (): CostTotals => ({
    plan: 0,
    committed: 0,
    actual: 0,
    unallowable: 0,
    hours: 0
  });
  for (const element of tree) {
    parentOf.set(element.id, element.parentId ?? null);
    byElement.set(element.id, empty());
  }

  const project: CostTotals = empty();
  const add = (into: CostTotals, from: CostTotals) => {
    into.plan += from.plan;
    into.committed += from.committed;
    into.actual += from.actual;
    into.unallowable += from.unallowable;
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
      unallowable: Number(row.actualUnallowable),
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

/**
 * The refusal for a delete of an element subtree, from the rows that name an
 * element of it, else null. An earned value snapshot names its work package
 * and its control account; both FKs have no ON DELETE action, so the delete
 * must stop before it reaches the database.
 */
export function elementDeleteRefusal(counts: {
  ledger: number;
  timesheets: number;
  jobs: number;
  purchaseLines: number;
  earnedValue: number;
}): string | null {
  if (counts.ledger > 0) {
    return "Costs are posted to this element or an element below it. It cannot be deleted.";
  }
  if (counts.timesheets > 0) {
    return "Time is logged on this element or an element below it. It cannot be deleted.";
  }
  if (counts.jobs > 0) {
    return "A job charges this element or an element below it. It cannot be deleted.";
  }
  if (counts.purchaseLines > 0) {
    return "A purchase order line charges this element or an element below it. It cannot be deleted.";
  }
  if (counts.earnedValue > 0) {
    return "Earned value is recorded for this element or an element below it. It cannot be deleted.";
  }
  return null;
}

/**
 * The refusal for a delete that removes the base element of an Apportioned
 * element outside the deleted subtree, else null. The base FK sets
 * `apportionedToElementId` to null, which the Apportioned CHECK refuses, so
 * the delete must stop before it reaches the database. An Apportioned element
 * inside the subtree goes with it, so it does not block the delete.
 */
export function apportionedBaseRefusal(
  deletedIds: Iterable<string>,
  elements: {
    id: string;
    readableId: string;
    name: string;
    earnedValueTechnique: string | null;
    apportionedToElementId: string | null;
  }[]
): string | null {
  const deleted = new Set(deletedIds);
  const byId = new Map(elements.map((element) => [element.id, element]));
  for (const element of elements) {
    if (element.earnedValueTechnique !== "Apportioned") continue;
    if (!element.apportionedToElementId) continue;
    if (deleted.has(element.id)) continue;
    if (!deleted.has(element.apportionedToElementId)) continue;
    const base = byId.get(element.apportionedToElementId);
    const baseLabel = base ? `${base.readableId} ${base.name}` : "This element";
    return `${baseLabel} is the base of apportioned element ${element.readableId} ${element.name}. Change that element first.`;
  }
  return null;
}

export type ProjectCostFigures = {
  plan: number;
  /** The budgets set in the subtree, or null when none is set. */
  budget: number | null;
  committed: number;
  actual: number;
  /** The part of `actual` posted as unallowable. */
  unallowable: number;
  hours: number;
  /** Budget less committed and actual, or null with no budget. */
  remaining: number | null;
  estimateAtCompletion: number;
};

// The estimate at completion lives in `@carbon/utils` so the Costs tab and
// the contract funding notice compute it the same way.
export { estimateAtCompletion } from "@carbon/utils";

/**
 * The Costs tab figures for each element (its subtree) and for the project.
 * Plan, committed, actual and hours roll up with `rollUpCostSummary`, so the
 * project total includes charges with no element. The budget of a row adds
 * every budget set in its subtree; the project budget adds every element's.
 * An element's own `estimateAtCompletion` overrides its estimate; the project
 * estimate is always computed. `serviceActual` is the actual cost of the
 * service orders whose Service project has this project as its parent (a
 * coverage contract's project): it adds to the project total only, never to an
 * element.
 */
export function buildProjectCostFigures(
  elements: {
    id: string;
    parentId: string | null;
    budget: number | null;
    estimateAtCompletion: number | null;
  }[],
  costSummary: Parameters<typeof rollUpCostSummary>[1],
  serviceActual = 0
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
    unallowable: total.unallowable,
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
          unallowable: 0,
          hours: 0
        },
        budgets.get(element.id) ?? null,
        element.estimateAtCompletion
      )
    );
  }

  return {
    byElement,
    project: figures(
      { ...projectTotals, actual: projectTotals.actual + serviceActual },
      projectBudget,
      null
    )
  };
}

/**
 * The actual cost of the preproduction elements: each preproduction element's
 * subtree, counted once. A preproduction element under another preproduction
 * element is already in its ancestor's subtree, so it adds nothing.
 */
export function preproductionActual(
  elements: { id: string; parentId: string | null; isPreproduction: boolean }[],
  byElement: Map<string, { actual: number }>
): number {
  const byId = new Map(elements.map((element) => [element.id, element]));
  let total = 0;
  for (const element of elements) {
    if (!element.isPreproduction) continue;
    const seen = new Set<string>([element.id]);
    let parentId = element.parentId;
    let underPreproduction = false;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.isPreproduction) {
        underPreproduction = true;
        break;
      }
      parentId = parent.parentId;
    }
    if (!underPreproduction) total += byElement.get(element.id)?.actual ?? 0;
  }
  return total;
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
 * The Elements filters of a query string: `search` and the `filter=` params
 * of the filter row. The Type filter is `filter=type:eq:…`; the old `?type=`
 * param still reads, so an older link keeps its filter. The Plan page and the
 * Reader PDF read the same filters, so the PDF prints what the page shows.
 *
 * `type` is the one chosen type, which the Tree layout uses as a lens.
 */
export function parseElementFilters(params: URLSearchParams): {
  filters: ProjectElementFilters;
  type: ProjectElementType | null;
  isFiltered: boolean;
} {
  const legacyType = params.get("type");
  const types = (
    filterValues(params, "type") ?? (legacyType ? [legacyType] : [])
  ).filter((value) =>
    projectElementTypes.includes(value as ProjectElementType)
  ) as ProjectElementType[];
  const stateGroup = (filterValues(params, "stateGroup") ?? []).filter((g) =>
    projectStateGroups.includes(g as ProjectStateGroup)
  ) as ProjectStateGroup[];
  const filters: ProjectElementFilters = {
    type: types.length > 0 ? types : null,
    stateGroup: stateGroup.length > 0 ? stateGroup : null,
    ownerId: filterValues(params, "ownerId"),
    milestoneId: filterValues(params, "milestoneId"),
    labelId: filterValues(params, "labelId"),
    search: params.get("search") || null
  };
  return {
    filters,
    type: types.length === 1 ? types[0] : null,
    isFiltered: Object.values(filters).some((value) => value !== null)
  };
}

// --- Layouts -------------------------------------------------------------------

/** The layouts of the Plan page, in the order the switch lists them. */
export const projectLayouts = [
  "list",
  "tree",
  "reader"
] as const satisfies readonly Enums["projectLayout"][];

export type ProjectLayout = (typeof projectLayouts)[number];

/** The layout a Plan URL names; null when it names none or a retired one. */
export function elementLayoutFromParams(
  params: URLSearchParams
): ProjectLayout | null {
  const layout = params.get("layout");
  return projectLayouts.includes(layout as ProjectLayout)
    ? (layout as ProjectLayout)
    : null;
}

/**
 * The params a Plan URL redirects to, or null when it needs no redirect. A
 * missing or retired layout (`table`, `board`, `timeline`) becomes `list`,
 * and the old `?type=` param becomes the Type filter, so the filter shows as
 * a chip. Every other param stays, `cr` included.
 */
export function canonicalElementsParams(
  params: URLSearchParams
): URLSearchParams | null {
  const legacyType = params.get("type");
  const hasLayout = elementLayoutFromParams(params) !== null;
  if (hasLayout && legacyType === null) return null;
  const next = new URLSearchParams(params);
  if (!hasLayout) next.set("layout", "list");
  if (legacyType !== null) {
    next.delete("type");
    if (
      projectElementTypes.includes(legacyType as ProjectElementType) &&
      filterValues(next, "type") === null
    ) {
      next.append("filter", `type:eq:${legacyType}`);
    }
  }
  return next;
}

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
  milestone: "pjm",
  element: "pje",
  link: "pjk",
  material: "pjp",
  labor: "pjr",
  cost: "pjo"
} as const;

/**
 * Plans the rows of a project copy, with new ids from `makeId`. Every
 * reference is remapped to the copy: element parents, milestones and actual
 * Parameters, element labels, both ends of each link. States and labels are
 * company-wide, so elements keep their state and label ids. Elements are
 * renumbered from 1 in the source's sequence order and returned parents
 * first; formulas name the new readable ids. What belongs to the source's
 * history is cleared: the element's asset, a test verdict, a link's suspect
 * flag and review, a material's issued quantity and its job or PO line.
 */
export function planProjectCopy(
  source: ProjectCopySource,
  newProjectId: string,
  identifier: string,
  makeId: (prefix: string) => string,
  /** The first element sequence (default 1): Build from part numbers on. */
  startSequence = 1
) {
  const remap = <T extends { id: string }>(rows: T[], prefix: string) =>
    new Map(rows.map((row) => [row.id, makeId(prefix)]));
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
    sequences.set(element.id, startSequence + index);
    readableIds.set(
      element.readableId,
      `${identifier}-${startSequence + index}`
    );
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
      stateId: element.stateId,
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
    milestones: source.milestones.map((milestone) => ({
      ...withoutAudit(milestone),
      id: milestoneIds.get(milestone.id)!,
      projectId: newProjectId
    })),
    elements,
    elementLabels: source.elementLabels
      .filter((row) => elementIds.has(row.projectElementId))
      .map((row) => ({
        projectElementId: elementIds.get(row.projectElementId)!,
        projectLabelId: row.projectLabelId
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
    nextElementSequence: startSequence + ordered.length
  };
}

// --- Build from part ------------------------------------------------------------

export const buildFromPartSources = ["Serial", "Item", "Template"] as const;
export type BuildFromPartSource = (typeof buildFromPartSources)[number];

/** The most levels Build from part walks below its source. */
export const BUILD_FROM_PART_MAX_DEPTH = 5;
/** The most nodes one build reads, as the traceability graph caps it. */
export const BUILD_FROM_PART_MAX_NODES = 500;

export const buildFromPartValidator = z
  .object({
    source: z.enum(buildFromPartSources, { error: "Source is required" }),
    itemId: zfd.text(z.string().optional()),
    trackedEntityId: zfd.text(z.string().optional()),
    templateProjectId: zfd.text(z.string().optional()),
    parentId: zfd.text(z.string().optional()),
    depth: zfd.numeric(
      z.number().int().min(1).max(BUILD_FROM_PART_MAX_DEPTH).default(2)
    ),
    includeBought: z.preprocess(
      (v) => v === true || v === "on" || v === "true",
      z.boolean()
    )
  })
  .refine((data) => data.source !== "Serial" || !!data.trackedEntityId, {
    message: "Serial is required",
    path: ["trackedEntityId"]
  })
  .refine((data) => data.source !== "Item" || !!data.itemId, {
    message: "Item is required",
    path: ["itemId"]
  })
  .refine((data) => data.source !== "Template" || !!data.templateProjectId, {
    message: "Template is required",
    path: ["templateProjectId"]
  });

/** One node of a Build from part source tree (a serial's build or a BOM). */
export type BuildSourceNode = {
  key: string;
  /** Null for a node on the first level below the source. */
  parentKey: string | null;
  itemId: string | null;
  trackedEntityId?: string | null;
  name: string;
  replenishment: "Make" | "Buy";
};

/** One genealogy row of a serial's build walk (a traceability RPC row). */
export type BuildTraceRow = {
  /** The entity on the walk's current level. */
  sourceEntityId: string;
  trackedActivityId: string;
  /** The entity on the other side of the activity. */
  id: string;
  status: string;
};

/**
 * The components of the assemblies on one level of a serial's build walk.
 * `consumed` holds the inputs of the activities that output an assembly;
 * `given` the outputs of the activities that took an assembly as input. A
 * component counts when a Consume activity (made in the factory) or a
 * Service activity (installed by a service order) put it in, and no later
 * Unconsume activity of the same assembly gave it back. A scrapped
 * component is out. So is a component every `customerAssetComponent` row of
 * the assembly's customer asset marks removed (`removed` holds those pairs as
 * `${assembly} ${component}`): a later service order replaced it.
 */
export function netBuildComponents(args: {
  consumed: BuildTraceRow[];
  given: BuildTraceRow[];
  typeOf: Map<string, string>;
  removed: Set<string>;
}): { assembly: string; component: string }[] {
  const net = new Map<
    string,
    { assembly: string; component: string; count: number }
  >();
  for (const row of args.consumed) {
    const type = args.typeOf.get(row.trackedActivityId);
    if (type !== "Consume" && type !== "Service") continue;
    if (row.status === "Scrapped") continue;
    const key = `${row.sourceEntityId} ${row.id}`;
    const entry = net.get(key) ?? {
      assembly: row.sourceEntityId,
      component: row.id,
      count: 0
    };
    entry.count += 1;
    net.set(key, entry);
  }
  for (const row of args.given) {
    if (args.typeOf.get(row.trackedActivityId) !== "Unconsume") continue;
    const entry = net.get(`${row.sourceEntityId} ${row.id}`);
    if (entry) entry.count -= 1;
  }
  return [...net.entries()]
    .filter(([key, entry]) => entry.count > 0 && !args.removed.has(key))
    .map(([, { assembly, component }]) => ({ assembly, component }));
}

/** A `projectElement` row that Build from part inserts. */
export type PlannedBuildElement = {
  id: string;
  type: "System";
  name: string;
  parentId: string | null;
  stateId: string;
  isChargeable: true;
  itemId: string | null;
  trackedEntityId: string | null;
  sequence: number;
  readableId: string;
  sortOrder: number;
};

/**
 * Plans the elements of a source tree. It keeps the nodes down to `depth`
 * levels below the source (a first-level node is level 1). Without
 * `includeBought` it drops a Buy node that keeps no child. Each kept node is
 * a chargeable System element in the default Unstarted state, with a new id,
 * its parent remapped (a first-level node goes under `parentId`), and a
 * readable id numbered from `startSequence`. The rows come parents first.
 * `startSortOrder` places the first level after the parent's other children.
 */
export function planElementsFromSource(args: {
  nodes: BuildSourceNode[];
  parentId: string | null;
  depth: number;
  includeBought: boolean;
  makeId: () => string;
  startSequence: number;
  identifier: string;
  defaultStateId: string;
  startSortOrder?: number;
}): PlannedBuildElement[] {
  const children = new Map<string | null, BuildSourceNode[]>();
  for (const node of args.nodes) {
    const siblings = children.get(node.parentKey) ?? [];
    siblings.push(node);
    children.set(node.parentKey, siblings);
  }

  // Bottom up: a node is kept when it is in depth and is made, is bought
  // with includeBought, or keeps a child. `seen` stops a cycle in the source.
  const kept = new Set<string>();
  const seen = new Set<string>();
  const keep = (node: BuildSourceNode, level: number): boolean => {
    if (level > args.depth || seen.has(node.key)) return false;
    seen.add(node.key);
    let keepsChild = false;
    for (const child of children.get(node.key) ?? []) {
      if (keep(child, level + 1)) keepsChild = true;
    }
    const isKept =
      keepsChild || node.replenishment === "Make" || args.includeBought;
    if (isKept) kept.add(node.key);
    return isKept;
  };
  for (const node of children.get(null) ?? []) keep(node, 1);

  // Parents first: breadth first from the first level.
  const rows: PlannedBuildElement[] = [];
  const ids = new Map<string, string>();
  let queue = (children.get(null) ?? []).filter((n) => kept.has(n.key));
  let parentSortStart = args.startSortOrder ?? 0;
  let isFirstLevel = true;
  while (queue.length > 0) {
    const next: BuildSourceNode[] = [];
    const sortOrders = new Map<string | null, number>();
    for (const node of queue) {
      const id = args.makeId();
      ids.set(node.key, id);
      const parentId =
        node.parentKey === null ? args.parentId : ids.get(node.parentKey)!;
      const sortOrder =
        (sortOrders.get(node.parentKey) ??
          (isFirstLevel ? parentSortStart : 0)) + 1;
      sortOrders.set(node.parentKey, sortOrder);
      const sequence = args.startSequence + rows.length;
      rows.push({
        id,
        type: "System",
        name: node.name,
        parentId,
        stateId: args.defaultStateId,
        isChargeable: true,
        itemId: node.itemId,
        trackedEntityId: node.trackedEntityId ?? null,
        sequence,
        readableId: `${args.identifier}-${sequence}`,
        sortOrder
      });
      for (const child of children.get(node.key) ?? []) {
        if (kept.has(child.key) && !ids.has(child.key)) next.push(child);
      }
    }
    queue = next;
    isFirstLevel = false;
    parentSortStart = 0;
  }
  return rows;
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

// --- Baselines and change requests (Phase 1c) ---------------------------------

export type ProjectPlanTable = Enums["projectPlanTable"];
export type ProjectBaselineSource = Enums["projectBaselineSource"];
export type ProjectChangeRequestStatus = Enums["projectChangeRequestStatus"];
export type ProjectChangeOperation = Enums["projectChangeOperation"];

export const projectPlanTables = [
  "projectElement",
  "projectElementLink",
  "projectElementMaterial",
  "projectElementLabor",
  "projectElementCost"
] as const satisfies readonly ProjectPlanTable[];

function byId(a: PlanRow, b: PlanRow) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// The plan layer and the snapshot shape live in `@carbon/database/project-plan`,
// shared with the demo datasets.
export {
  PLAN_LAYER_FIELDS,
  PROJECT_BASELINE_FORMAT_VERSION,
  planSnapshotKeys,
  isPlanLayerField,
  pickPlanLayerFields,
  toPlanSnapshot,
  parsePlanSnapshot
};
export type {
  PlanRow,
  PlanScheduleRow,
  ProjectPlanSnapshot,
  ProjectPlanSnapshotKey
};

export type ProjectPlanDiff = Record<
  ProjectPlanSnapshotKey,
  DiffEntry<PlanRow>[]
>;

/**
 * Diffs two plan snapshots table by table. Rows match by `id`; every
 * plan-layer column is compared.
 */
export function diffPlanSnapshots(
  base: ProjectPlanSnapshot,
  target: ProjectPlanSnapshot
): ProjectPlanDiff {
  const diff = (key: ProjectPlanSnapshotKey) =>
    diffRows(base[key], target[key], { key: "id", ignoredFields: [] });
  return {
    elements: diff("elements"),
    links: diff("links"),
    materials: diff("materials"),
    labor: diff("labor"),
    costs: diff("costs")
  };
}

export const projectBaselineValidator = z.object({
  name: z.string().trim().min(1, { message: "Name is required" })
});

/** The baseline a compare reads as its target: a baseline id or the live plan. */
export const CURRENT_PLAN = "current";

/**
 * One item of a change request: an Add, Update or Delete of one row of a plan
 * table. `payload` is the proposed row (Add, Update). `baseRow` is the live
 * row's plan-layer fields when the draft first touched it (Update, Delete).
 */
export type ChangeRequestItem = {
  operation: ProjectChangeOperation;
  targetTable: ProjectPlanTable;
  targetId: string;
  payload: Record<string, unknown> | null;
  baseRow: Record<string, unknown> | null;
};

/** The plan-layer fields of `payload` that it sets; `id` never changes. */
function presentPlanFields(
  table: ProjectPlanTable,
  payload: Record<string, unknown> | null
) {
  const fields: Record<string, unknown> = {};
  if (!payload) return fields;
  for (const field of PLAN_LAYER_FIELDS[table]) {
    if (field !== "id" && field in payload) fields[field] = payload[field];
  }
  return fields;
}

/**
 * The plan as a change request would leave it. An Add appends its payload, an
 * Update replaces the row's plan-layer fields with its payload, and a Delete
 * removes the row. Deleting an element also removes its descendants, and the
 * links and plan lines of every removed element, as the database cascades do.
 */
export function applyChangeRequestItems(
  live: ProjectPlanSnapshot,
  items: ChangeRequestItem[]
): ProjectPlanSnapshot {
  const tables = Object.fromEntries(
    projectPlanTables.map((table) => [
      table,
      new Map(live[planSnapshotKeys[table]].map((row) => [row.id, row]))
    ])
  ) as Record<ProjectPlanTable, Map<string, PlanRow>>;

  for (const item of items) {
    const rows = tables[item.targetTable];
    if (item.operation === "Add") {
      rows.set(
        item.targetId,
        pickPlanLayerFields(item.targetTable, {
          ...(item.payload ?? {}),
          id: item.targetId
        })
      );
    } else if (item.operation === "Update") {
      const row = rows.get(item.targetId);
      if (row) {
        rows.set(item.targetId, {
          ...row,
          ...presentPlanFields(item.targetTable, item.payload)
        });
      }
    } else {
      rows.delete(item.targetId);
    }
  }

  // An element whose parent is gone goes too, down the whole subtree.
  const elements = tables.projectElement;
  let removed = true;
  while (removed) {
    removed = false;
    for (const [id, row] of elements) {
      const parentId = row.parentId as string | null;
      if (parentId && !elements.has(parentId)) {
        elements.delete(id);
        removed = true;
      }
    }
  }
  for (const [id, row] of tables.projectElementLink) {
    if (
      !elements.has(row.fromElementId as string) ||
      !elements.has(row.toElementId as string)
    ) {
      tables.projectElementLink.delete(id);
    }
  }
  for (const table of [
    "projectElementMaterial",
    "projectElementLabor",
    "projectElementCost"
  ] as const) {
    for (const [id, row] of tables[table]) {
      if (!elements.has(row.projectElementId as string)) {
        tables[table].delete(id);
      }
    }
  }

  const rowsOf = (table: ProjectPlanTable) => [...tables[table].values()];
  return {
    elements: rowsOf("projectElement").sort(byId),
    links: rowsOf("projectElementLink").sort(byId),
    materials: rowsOf("projectElementMaterial").sort(byId),
    labor: rowsOf("projectElementLabor").sort(byId),
    costs: rowsOf("projectElementCost").sort(byId)
  };
}

/** The element a row of a plan table hangs from, for the cascade checks. */
export function planRowParentIds(
  table: ProjectPlanTable,
  row: Record<string, unknown>
): string[] {
  const ids =
    table === "projectElement"
      ? [row.parentId]
      : table === "projectElementLink"
        ? [row.fromElementId, row.toElementId]
        : [row.projectElementId];
  return ids.filter((id): id is string => typeof id === "string" && !!id);
}

export type ChangeOperationMark = ProjectChangeOperation | null;

/**
 * Lays a change request over the rows a page loaded. A live row the change
 * request removes stays, marked Delete. A live row it changes takes the
 * overlaid plan-layer fields, marked Update. A row it adds is built by
 * `build` from the overlaid row, marked Add. Other rows are marked null.
 */
export function overlayPlanRows<T extends { id: string }>(
  liveRows: T[],
  overlaid: PlanRow[],
  liveIds: Set<string>,
  updatedIds: Set<string>,
  build: (row: PlanRow) => T
): (T & { changeOperation: ChangeOperationMark })[] {
  const overlaidById = new Map(overlaid.map((row) => [row.id, row]));
  const rows: (T & { changeOperation: ChangeOperationMark })[] = liveRows.map(
    (row) => {
      const next = overlaidById.get(row.id);
      if (!next) return { ...row, changeOperation: "Delete" as const };
      if (updatedIds.has(row.id)) {
        return { ...row, ...next, changeOperation: "Update" as const };
      }
      return { ...row, changeOperation: null };
    }
  );
  for (const row of overlaid) {
    if (!liveIds.has(row.id)) {
      rows.push({ ...build(row), changeOperation: "Add" as const });
    }
  }
  return rows;
}

/**
 * Parses a field value for a change request item. It refuses what the live
 * update would refuse on its own value, but it does not read other rows.
 */
export function parseElementPlanFieldValue(
  field: string,
  raw: string | null
): { value: unknown } | { error: string } {
  const number = (min?: number, max?: number) => {
    if (raw === null) return { value: null };
    const value = Number(raw);
    if (
      !Number.isFinite(value) ||
      (min !== undefined && value < min) ||
      (max !== undefined && value > max)
    ) {
      return null;
    }
    return { value };
  };
  const oneOf = (values: readonly string[], message: string) =>
    raw === null || values.includes(raw) ? { value: raw } : { error: message };

  switch (field) {
    case "name":
      return raw ? { value: raw } : { error: "Name is required" };
    case "wbsCode":
      return raw === null || isValidWbsCode(raw)
        ? { value: raw }
        : { error: "A WBS code has 1 to 40 letters, digits, dots and dashes" };
    case "estimatedHours":
    case "budget":
      return number(0) ?? { error: "Enter a number of 0 or more" };
    case "isChargeable":
      return { value: raw === "true" || raw === "on" };
    case "description":
      if (raw === null) return { value: null };
      try {
        return { value: JSON.parse(raw) };
      } catch {
        return { error: "The description is not valid" };
      }
    case "targetValue":
    case "targetUpperValue":
    case "parameterValue":
      return number() ?? { error: "Enter a number" };
    case "parameterContingencyPercent":
    case "allocationPercent":
      return number(0, 1) ?? { error: "Enter a percent from 0 to 100" };
    case "requirementCategory":
      return oneOf(requirementCategories, "Choose a requirement category");
    case "verificationMethod":
      return oneOf(
        requirementVerificationMethods,
        "Choose a verification method"
      );
    case "targetOperator":
      return oneOf(requirementTargetOperators, "Choose a target operator");
    case "parameterSource":
      return oneOf(parameterSources, "Choose a source");
    case "parameterItemField":
      return raw === null ? { error: "Choose an item field" } : { value: raw };
    default:
      return { value: raw };
  }
}

/** One write a plan-layer route sends to a change request. */
export type ChangeRequestChange = {
  operation: ProjectChangeOperation;
  targetTable: ProjectPlanTable;
  targetId: string;
  payload: Record<string, unknown> | null;
};

const NO_IGNORED_FIELDS: ReadonlySet<string> = new Set();

/**
 * Folds one change into the change request's item for the same row.
 * Returns the item to keep, or null when no item should remain:
 * - an Update after an Add merges into the Add's payload;
 * - a Delete after an Add removes the Add;
 * - the first Update or Delete of a live row stores its plan-layer fields
 *   as `baseRow`;
 * - an Update that brings a row back to its `baseRow` removes the item.
 */
export function mergeChangeRequestItem(
  existing: ChangeRequestItem | null,
  change: ChangeRequestChange,
  liveRow: Record<string, unknown> | null
): { item: ChangeRequestItem | null } | { error: string } {
  const table = change.targetTable;
  const updated = (
    baseRow: Record<string, unknown>,
    payload: Record<string, unknown>
  ) =>
    diffFields(baseRow, payload, NO_IGNORED_FIELDS)
      ? {
          item: {
            operation: "Update" as const,
            targetTable: table,
            targetId: change.targetId,
            payload,
            baseRow
          }
        }
      : { item: null };

  if (existing?.operation === "Delete") {
    return change.operation === "Delete"
      ? { item: existing }
      : { error: "This row is deleted in the change request" };
  }
  if (change.operation === "Add") {
    if (existing) return { error: "This row is already in the change request" };
    return {
      item: {
        operation: "Add",
        targetTable: table,
        targetId: change.targetId,
        payload: { ...(change.payload ?? {}), id: change.targetId },
        baseRow: null
      }
    };
  }
  if (existing?.operation === "Add") {
    if (change.operation === "Delete") return { item: null };
    return {
      item: {
        ...existing,
        payload: {
          ...(existing.payload ?? {}),
          ...(change.payload ?? {}),
          id: change.targetId
        }
      }
    };
  }

  const baseRow =
    existing?.baseRow ?? (liveRow ? pickPlanLayerFields(table, liveRow) : null);
  if (!baseRow) return { error: "The row no longer exists" };

  if (change.operation === "Delete") {
    return {
      item: {
        operation: "Delete",
        targetTable: table,
        targetId: change.targetId,
        payload: null,
        baseRow
      }
    };
  }
  return updated(baseRow, {
    ...(existing?.payload ?? baseRow),
    ...presentPlanFields(table, change.payload)
  });
}
export type ChangeRequestConflict = {
  targetTable: ProjectPlanTable;
  targetId: string;
  operation: ProjectChangeOperation;
  /** The plan-layer fields changed on the live row since the draft read it. */
  fields: string[];
  /** The live row (or, for an Add, the row it hangs from) no longer exists. */
  missing: boolean;
};

/**
 * The items that no longer fit the live plan. An Update or Delete conflicts
 * when the live row's plan-layer fields differ from its `baseRow`, or when
 * the live row is gone. An Add conflicts when the live element it hangs from
 * is gone.
 */
export function findConflicts(
  items: ChangeRequestItem[],
  live: ProjectPlanSnapshot
): ChangeRequestConflict[] {
  const liveById = Object.fromEntries(
    projectPlanTables.map((table) => [
      table,
      new Map(live[planSnapshotKeys[table]].map((row) => [row.id, row]))
    ])
  ) as Record<ProjectPlanTable, Map<string, PlanRow>>;
  const addedElementIds = new Set(
    items
      .filter(
        (item) =>
          item.operation === "Add" && item.targetTable === "projectElement"
      )
      .map((item) => item.targetId)
  );

  const conflicts: ChangeRequestConflict[] = [];
  for (const item of items) {
    const conflict = {
      targetTable: item.targetTable,
      targetId: item.targetId,
      operation: item.operation
    };
    if (item.operation === "Add") {
      const parentIds = planRowParentIds(item.targetTable, item.payload ?? {});
      const missing = parentIds.some(
        (id) => !addedElementIds.has(id) && !liveById.projectElement.has(id)
      );
      if (missing) conflicts.push({ ...conflict, fields: [], missing: true });
      continue;
    }
    const row = liveById[item.targetTable].get(item.targetId);
    if (!row) {
      conflicts.push({ ...conflict, fields: [], missing: true });
      continue;
    }
    const changed = diffFields(
      item.baseRow ?? {},
      pickPlanLayerFields(item.targetTable, row),
      NO_IGNORED_FIELDS
    );
    if (changed) {
      conflicts.push({
        ...conflict,
        fields: Object.keys(changed),
        missing: false
      });
    }
  }
  return conflicts;
}

/**
 * Brings a reopened change request back onto the live plan, after an apply
 * refused it on a conflict. An Update keeps only the fields it changed, laid
 * over the live row, and stores the live row as its new `baseRow`. A Delete
 * takes the live row as its `baseRow`. An item whose live row is gone, an
 * Update left with no change, and an Add whose element is gone are dropped.
 */
export function rebaseChangeRequestItems(
  items: ChangeRequestItem[],
  live: ProjectPlanSnapshot
): { keep: ChangeRequestItem[]; drop: ChangeRequestItem[] } {
  const liveById = Object.fromEntries(
    projectPlanTables.map((table) => [
      table,
      new Map(live[planSnapshotKeys[table]].map((row) => [row.id, row]))
    ])
  ) as Record<ProjectPlanTable, Map<string, PlanRow>>;

  const keep: ChangeRequestItem[] = [];
  const drop: ChangeRequestItem[] = [];
  const adds: ChangeRequestItem[] = [];
  for (const item of items) {
    if (item.operation === "Add") {
      adds.push(item);
      continue;
    }
    const row = liveById[item.targetTable].get(item.targetId);
    if (!row) {
      drop.push(item);
      continue;
    }
    const baseRow = pickPlanLayerFields(item.targetTable, row);
    if (item.operation === "Delete") {
      keep.push({ ...item, baseRow });
      continue;
    }
    const changed = diffFields(
      item.baseRow ?? {},
      item.payload ?? {},
      NO_IGNORED_FIELDS
    );
    const payload = { ...baseRow };
    for (const field of Object.keys(changed ?? {})) {
      payload[field] = item.payload?.[field] ?? null;
    }
    if (diffFields(baseRow, payload, NO_IGNORED_FIELDS)) {
      keep.push({ ...item, payload, baseRow });
    } else {
      drop.push(item);
    }
  }

  // An Add hangs from a live element or from another kept Add.
  let addedIds = new Set(
    adds
      .filter((item) => item.targetTable === "projectElement")
      .map((item) => item.targetId)
  );
  let remaining = adds;
  let changed = true;
  while (changed) {
    changed = false;
    const next: ChangeRequestItem[] = [];
    for (const item of remaining) {
      const parents = planRowParentIds(item.targetTable, item.payload ?? {});
      const missing = parents.some(
        (id) => !addedIds.has(id) && !liveById.projectElement.has(id)
      );
      if (missing) {
        drop.push(item);
        changed = true;
      } else {
        next.push(item);
      }
    }
    remaining = next;
    addedIds = new Set(
      remaining
        .filter((item) => item.targetTable === "projectElement")
        .map((item) => item.targetId)
    );
  }
  return { keep: [...keep, ...remaining], drop };
}

export const projectChangeRequestValidator = z.object({
  title: z.string().trim().min(1, { message: "Title is required" }),
  reason: optionalTiptapDoc
});

export const projectChangeRequestIntents = [
  "submit",
  "approve",
  "reject",
  "cancel",
  "reopen"
] as const;

export type ProjectChangeRequestIntent =
  (typeof projectChangeRequestIntents)[number];

/** The statuses each intent starts from. */
export const projectChangeRequestIntentFrom: Record<
  ProjectChangeRequestIntent,
  readonly ProjectChangeRequestStatus[]
> = {
  submit: ["Draft"],
  approve: ["In Review"],
  reject: ["In Review"],
  cancel: ["Draft", "In Review"],
  // An Approved change request whose apply hit a conflict reopens too.
  reopen: ["Rejected", "Approved"]
};

/** The change requests the Elements page can open: they still take edits or a decision. */
export const openChangeRequestStatuses = [
  "Draft",
  "In Review",
  "Approved"
] as const satisfies readonly ProjectChangeRequestStatus[];

export const projectChangeRequestStatusValidator = z.object({
  intent: z.enum(projectChangeRequestIntents, { error: "Unknown action" }),
  notes: zfd.text(z.string().trim().optional())
});

export const projectChangeRequestCommentValidator = z.object({
  comment: z.string().trim().min(1, { message: "Comment is required" }),
  targetTable: zfd.text(z.enum(projectPlanTables).optional()),
  targetId: zfd.text(z.string().optional()),
  field: zfd.text(z.string().optional())
});

// isProjectPlanLocked lives in @carbon/database/project-plan so the issue sync
// can share it.
export { isProjectPlanLocked } from "@carbon/database/project-plan";

/** The refusal a plan-layer write gets on a locked plan. */
export function projectPlanLockedMessage(milestoneName: string) {
  return `The plan is locked after ${milestoneName}. Open a change request to change it.`;
}

// ---------------------------------------------------------------------------
// Government Contracting 5a reports
// ---------------------------------------------------------------------------

/** The CSV reports of Projects → Reports, by URL key. */
export const projectReportKeys = [
  "late-entries",
  "missing-time",
  "labor-distribution",
  "labor-transfers",
  "timesheet-audit",
  "cost-by-clin",
  // Government Contracting 5d: R&D tax, by tax year.
  "rd-section-174a",
  "rd-form-6765-g"
] as const;

export type ProjectReportKey = (typeof projectReportKeys)[number];

export function isProjectReportKey(value: string): value is ProjectReportKey {
  return (projectReportKeys as readonly string[]).includes(value);
}

/**
 * The modules a user must be able to view to run each report. The report
 * page, its CSV and the Reports list all read this one map.
 */
export const projectReportPermissions: Record<
  ProjectReportKey,
  { view: string[] }
> = {
  "late-entries": { view: ["projects"] },
  "missing-time": { view: ["projects"] },
  "labor-transfers": { view: ["projects"] },
  "timesheet-audit": { view: ["projects"] },
  "labor-distribution": { view: ["projects", "people"] },
  "cost-by-clin": { view: ["sales"] },
  "rd-section-174a": { view: ["projects", "accounting"] },
  "rd-form-6765-g": { view: ["projects", "accounting"] }
};

/**
 * The Missing Time report's actions: take an employee out of the report
 * (`timesheetRequired` off) or back in, or remind the selected employees.
 */
export const missingTimeActionValidator = z.discriminatedUnion("intent", [
  z.object({
    intent: z.enum(["exclude", "include"]),
    employeeId: z.string().min(1)
  }),
  z.object({
    intent: z.literal("remind"),
    employeeIds: zfd.repeatableOfType(z.string().min(1)),
    startDate: z.string().refine(isCalendarDate),
    endDate: z.string().refine(isCalendarDate)
  })
]);

/** True for a valid `YYYY-MM-DD` date. */
function isCalendarDate(value: string) {
  try {
    return parseDate(value).toString() === value;
  } catch {
    return false;
  }
}

/** A report row's charge number: the element's id, else the project's. */
export function reportChargeNumber(row: {
  projectIdentifier: string | null;
  elementReadableId: string | null;
}): string {
  return row.elementReadableId ?? row.projectIdentifier ?? "";
}

/** One group of `projectLedger` Labor rows: employee × project × element. */
export type LaborDistributionLaborRow = {
  employeeId: string | null;
  employeeName: string | null;
  projectId: string;
  projectIdentifier: string | null;
  projectName: string | null;
  costObjective: ProjectCostObjective | null;
  projectElementId: string | null;
  elementReadableId: string | null;
  elementName: string | null;
  hours: number;
  amount: number;
  unallowableAmount: number;
};

export type LaborDistributionInput = {
  labor: LaborDistributionLaborRow[];
  /** Closed timecard hours per employee in the period. */
  timecards: {
    employeeId: string;
    employeeName: string | null;
    hours: number;
  }[];
  /** Imported payroll totals per employee, `periodEnd` in the period. */
  payroll: {
    employeeId: string;
    employeeName: string | null;
    grossWages: number;
    hoursPaid: number;
  }[];
};

export type LaborDistributionColumns = {
  hours: number;
  direct: number;
  indirect: number;
  unclassified: number;
  unallowable: number;
  total: number;
};

export type LaborDistributionEmployee = {
  employeeId: string | null;
  employeeName: string | null;
  lines: (LaborDistributionColumns & {
    chargeNumber: string;
    projectName: string | null;
    elementName: string | null;
    costObjective: ProjectCostObjective | null;
  })[];
  total: LaborDistributionColumns & {
    timecardHours: number;
    /** Labor hours less timecard hours. */
    hoursDifference: number;
    /** Null when no payroll total is imported for the period. */
    grossWages: number | null;
    /** Labor dollars less gross wages; null with no payroll. */
    dollarsDifference: number | null;
    note: string | null;
  };
};

export const NO_PAYROLL_IMPORTED = "No payroll imported";

const DIRECT_OBJECTIVES: readonly ProjectCostObjective[] = [
  "Direct",
  "Commercial"
];

/**
 * The labor distribution of one period (DFARS criterion 10). Each line puts
 * its allowable dollars in one column by the project's cost objective:
 * Direct (Direct, Commercial), Indirect (Indirect, IR&D, B&P) or
 * Unclassified (none). Unallowable dollars of any project go to Unallowable.
 * Per employee, the total reconciles hours to timecards and dollars to the
 * imported payroll totals.
 */
export function buildLaborDistribution(
  input: LaborDistributionInput
): LaborDistributionEmployee[] {
  const employees = new Map<string, LaborDistributionEmployee>();
  const keyOf = (employeeId: string | null) => employeeId ?? "";
  const employeeFor = (employeeId: string | null, name: string | null) => {
    const key = keyOf(employeeId);
    let employee = employees.get(key);
    if (!employee) {
      employee = {
        employeeId,
        employeeName: name,
        lines: [],
        total: {
          hours: 0,
          direct: 0,
          indirect: 0,
          unclassified: 0,
          unallowable: 0,
          total: 0,
          timecardHours: 0,
          hoursDifference: 0,
          grossWages: null,
          dollarsDifference: null,
          note: null
        }
      };
      employees.set(key, employee);
    }
    if (!employee.employeeName && name) employee.employeeName = name;
    return employee;
  };

  for (const row of input.labor) {
    const employee = employeeFor(row.employeeId, row.employeeName);
    const unallowable = Number(row.unallowableAmount);
    const allowable = Number(row.amount) - unallowable;
    const objective = row.costObjective;
    const line = {
      chargeNumber: reportChargeNumber(row),
      projectName: row.projectName,
      elementName: row.elementName,
      costObjective: objective,
      hours: round(Number(row.hours)),
      direct:
        objective && DIRECT_OBJECTIVES.includes(objective)
          ? round(allowable)
          : 0,
      indirect:
        objective && !DIRECT_OBJECTIVES.includes(objective)
          ? round(allowable)
          : 0,
      unclassified: objective ? 0 : round(allowable),
      unallowable: round(unallowable),
      total: round(Number(row.amount))
    };
    employee.lines.push(line);
    const total = employee.total;
    total.hours += line.hours;
    total.direct += line.direct;
    total.indirect += line.indirect;
    total.unclassified += line.unclassified;
    total.unallowable += line.unallowable;
    total.total += line.total;
  }

  for (const row of input.timecards) {
    employeeFor(row.employeeId, row.employeeName).total.timecardHours += Number(
      row.hours
    );
  }
  for (const row of input.payroll) {
    const total = employeeFor(row.employeeId, row.employeeName).total;
    total.grossWages = (total.grossWages ?? 0) + Number(row.grossWages);
  }

  const result = [...employees.values()];
  for (const { employeeId, total } of result) {
    total.hours = round(total.hours);
    total.direct = round(total.direct);
    total.indirect = round(total.indirect);
    total.unclassified = round(total.unclassified);
    total.unallowable = round(total.unallowable);
    total.total = round(total.total);
    total.timecardHours = round(total.timecardHours);
    total.hoursDifference = round(total.hours - total.timecardHours);
    if (total.grossWages === null) {
      // Labor with no employee (a job's machine labor) has no payroll.
      total.note = employeeId ? NO_PAYROLL_IMPORTED : null;
    } else {
      total.grossWages = round(total.grossWages);
      total.dollarsDifference = round(total.total - total.grossWages);
    }
  }
  return result.sort((a, b) =>
    (a.employeeName ?? "￿").localeCompare(b.employeeName ?? "￿")
  );
}

// --- R&D tax reports (Government Contracting 5d) -------------------------------

/**
 * One `projectLedger` row of a business component's subtree in the tax year
 * (`getRdLedgerRows`): the work country (decision D3), the research role and
 * whether the row is funded research (decision D10).
 */
export type RdLedgerRow = {
  componentId: string;
  costType: ProjectCostType;
  documentType: string;
  amount: number;
  employeeId: string | null;
  quantity: number;
  countryCode: string | null;
  rdActivityRole: RdActivityRole | null;
  costObjective: Enums["projectCostObjective"] | null;
  funded: boolean;
};

/** A business component (`getRdComponents`). */
export type RdComponent = {
  id: string;
  readableId: string;
  name: string;
  rdComponentType: string | null;
  rdSoftwareType: string | null;
};

/** One employee's year (`getRdEmployeeYear`). */
export type RdEmployeeYear = {
  employeeId: string;
  employeeName: string | null;
  /** Posted timesheet hours in the tax year, on every project. */
  totalHours: number;
  /** Σ imported gross wages; null when no payroll row is in the year. */
  grossWages: number | null;
  /** Σ Labor ledger amount in the tax year. */
  laborAmount: number;
  isOfficer: boolean;
};

export type Section174ARow = {
  componentId: string;
  readableId: string;
  name: string;
  domestic: number;
  foreign: number;
  unknown: number;
  /** Burden rows, shown for review; not in `total`. */
  burden: number;
  /** The part of domestic, foreign and unknown that is funded research. */
  funded: number;
  total: number;
  isTotal: boolean;
};

/**
 * The §174A R&E rows: per business component, its ledger cost split by work
 * country (Domestic, Foreign, Unknown). Burden rows go to a Burden column for
 * review and stay out of the total. Funded research is not excluded (D6):
 * "Of which funded" shows it. A last row holds the totals.
 */
export function buildSection174ARows(
  rows: RdLedgerRow[],
  components: RdComponent[]
): Section174ARow[] {
  const byComponent = new Map<string, Section174ARow>(
    components.map((component) => [
      component.id,
      {
        componentId: component.id,
        readableId: component.readableId,
        name: component.name,
        domestic: 0,
        foreign: 0,
        unknown: 0,
        burden: 0,
        funded: 0,
        total: 0,
        isTotal: false
      }
    ])
  );

  for (const row of rows) {
    const line = byComponent.get(row.componentId);
    if (!line) continue;
    const amount = Number(row.amount);
    if (row.costType === "Burden") {
      line.burden += amount;
      continue;
    }
    const country = workCountryClass(row.countryCode);
    if (country === "Domestic") line.domestic += amount;
    else if (country === "Foreign") line.foreign += amount;
    else line.unknown += amount;
    if (row.funded) line.funded += amount;
  }

  const lines = [...byComponent.values()].map((line) => ({
    ...line,
    domestic: round(line.domestic),
    foreign: round(line.foreign),
    unknown: round(line.unknown),
    burden: round(line.burden),
    funded: round(line.funded),
    total: round(line.domestic + line.foreign + line.unknown)
  }));
  const sum = (
    field: "domestic" | "foreign" | "unknown" | "burden" | "funded"
  ) => round(lines.reduce((total, line) => total + line[field], 0));

  return [
    ...lines,
    {
      componentId: "",
      readableId: "",
      name: "Total",
      domestic: sum("domestic"),
      foreign: sum("foreign"),
      unknown: sum("unknown"),
      burden: sum("burden"),
      funded: sum("funded"),
      total: round(sum("domestic") + sum("foreign") + sum("unknown")),
      isTotal: true
    }
  ];
}

/** The report keys that run for a tax year. */
export const rdTaxReportKeys = ["rd-section-174a", "rd-form-6765-g"] as const;

export function isRdTaxReportKey(
  value: string
): value is (typeof rdTaxReportKeys)[number] {
  return (rdTaxReportKeys as readonly string[]).includes(value);
}

/** The month number (1–12) of a `month` enum name; January when unknown. */
export function monthNumber(month: string | null | undefined): number {
  const index = months.findIndex((name) => name === month);
  return index < 0 ? 1 : index + 1;
}

/**
 * The tax year that holds `today` (`YYYY-MM-DD`): named by the calendar year
 * in which it starts (decision D9).
 */
export function taxYearOf(today: string, taxStartMonth: number): number {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month >= taxStartMonth ? year : year - 1;
}

/**
 * The inputs of the Form 6765 Section G rows (`section6765Rows`):
 * 1. Qualified hours: Timesheet rows with a role other than Not Qualified,
 *    not funded, in a Domestic country.
 * 2. Wages: the employee's imported gross wages, else the Labor ledger
 *    amount (decision D4), counted in `estimatedEmployeeCount`.
 * 3. Supplies: Material rows; contract research: Outside Processing and
 *    Purchased Service rows; both not funded and Domestic. Computer rental
 *    is 0 (decision D7).
 * A component with no QRE at all is left out. `unknownCountryHours` is the
 * qualified, unfunded time that has no work country (decision D2).
 */
export function buildSection6765Input(
  rows: RdLedgerRow[],
  employees: RdEmployeeYear[],
  components: RdComponent[]
): {
  components: Section6765Input[];
  officerWages: number;
  estimatedEmployeeCount: number;
  unknownCountryHours: number;
} {
  const componentIds = new Set(components.map((component) => component.id));
  const qualifiedByEmployee = new Map<string, QualifiedHours[]>();
  const supplies = new Map<string, number>();
  const contractResearch = new Map<string, number>();
  let unknownCountryHours = 0;

  for (const row of rows) {
    if (!componentIds.has(row.componentId) || row.funded) continue;
    const country = workCountryClass(row.countryCode);
    if (row.documentType === "Timesheet" && row.costType === "Labor") {
      const role = row.rdActivityRole;
      if (!role || role === "Not Qualified" || !row.employeeId) continue;
      const hours = Number(row.quantity);
      if (country === "Unknown") {
        unknownCountryHours += hours;
        continue;
      }
      if (country !== "Domestic") continue;
      const qualified = qualifiedByEmployee.get(row.employeeId) ?? [];
      const existing = qualified.find(
        (q) => q.componentId === row.componentId && q.role === role
      );
      if (existing) existing.hours += hours;
      else qualified.push({ componentId: row.componentId, role, hours });
      qualifiedByEmployee.set(row.employeeId, qualified);
      continue;
    }
    if (country !== "Domestic") continue;
    if (row.costType === "Material") {
      supplies.set(
        row.componentId,
        (supplies.get(row.componentId) ?? 0) + Number(row.amount)
      );
    } else if (
      row.costType === "Outside Processing" ||
      row.costType === "Purchased Service"
    ) {
      contractResearch.set(
        row.componentId,
        (contractResearch.get(row.componentId) ?? 0) + Number(row.amount)
      );
    }
  }

  let estimatedEmployeeCount = 0;
  const wageInput = employees
    .filter((employee) => qualifiedByEmployee.has(employee.employeeId))
    .map((employee) => {
      const estimated = employee.grossWages === null;
      if (estimated) estimatedEmployeeCount += 1;
      return {
        employeeId: employee.employeeId,
        wages: Number(
          estimated ? employee.laborAmount : (employee.grossWages ?? 0)
        ),
        totalHours: Number(employee.totalHours),
        isOfficer: employee.isOfficer,
        qualified: qualifiedByEmployee.get(employee.employeeId) ?? []
      };
    });
  const wages = wageQres(wageInput);

  const inputs = components
    .map((component): Section6765Input => {
      const componentWages = wages.byComponent[component.id];
      return {
        componentId: component.id,
        name: `${component.readableId} ${component.name}`,
        componentType: component.rdComponentType,
        softwareType: component.rdSoftwareType,
        research: componentWages?.research ?? 0,
        supervision: componentWages?.supervision ?? 0,
        support: componentWages?.support ?? 0,
        supplies: round(supplies.get(component.id) ?? 0),
        computerRental: 0,
        contractResearch: round(contractResearch.get(component.id) ?? 0)
      };
    })
    .filter(
      (input) =>
        input.research !== 0 ||
        input.supervision !== 0 ||
        input.support !== 0 ||
        input.supplies !== 0 ||
        input.contractResearch !== 0
    );

  return {
    components: inputs,
    officerWages: wages.officerWages,
    estimatedEmployeeCount,
    unknownCountryHours: round(unknownCountryHours)
  };
}

export type ElementWbsCode = {
  code: string;
  /** The code is stored on the element, not derived from the tree. */
  pinned: boolean;
  /** Another element has the same code. */
  duplicate: boolean;
};

/** Each numbered element's WBS code, for the Plan page and the element page. */
export function elementWbsCodes(
  nodes: readonly WbsNode[]
): Record<string, ElementWbsCode> {
  const { codes, duplicates } = computeWbsCodes(nodes);
  const pinned = new Set(
    nodes.filter((node) => node.wbsCode).map((node) => node.id)
  );
  return Object.fromEntries(
    [...codes].map(([id, code]) => [
      id,
      { code, pinned: pinned.has(id), duplicate: duplicates.has(code) }
    ])
  );
}

// --- WBS CSV (Phase A of the WBS interop spec) ---------------------------------

export const WBS_CSV_COLUMNS = [
  "Element ID",
  "WBS Code",
  "Parent WBS Code",
  "Level",
  "Type",
  "Name",
  "Start",
  "Target",
  "Budget",
  "Predecessors"
] as const;

/** An element as the WBS export, the import and the MSPDI export read it. */
export type WbsElement = {
  id: string;
  readableId: string;
  parentId: string | null;
  type: ProjectElementType;
  name: string;
  sortOrder: number;
  sequence: number;
  wbsCode: string | null;
  startDate: string | null;
  targetDate: string | null;
  budget: number | null;
};

/** A `precedes` link: `fromElementId` finishes before `toElementId` starts. */
export type WbsLink = { fromElementId: string; toElementId: string };

export type WbsTreeRow = {
  element: WbsElement;
  code: string;
  level: number;
  parentCode: string | null;
  hasChildren: boolean;
};

/**
 * The numbered elements in tree order (parents first, siblings by sort
 * order), each with its code and depth. Throws while 2 elements share a
 * code: an export with a repeated code cannot be read back.
 */
export function wbsTree(elements: readonly WbsElement[]): WbsTreeRow[] {
  const { codes, duplicates } = computeWbsCodes(
    elements.map((element) => ({
      ...element,
      sortOrder: Number(element.sortOrder)
    }))
  );
  if (duplicates.size > 0) {
    throw new Error(
      `WBS codes repeat: ${[...duplicates].join(", ")}. Change one of each pair first.`
    );
  }
  const children = new Map<string | null, WbsElement[]>();
  for (const element of elements) {
    if (!codes.has(element.id)) continue;
    const key =
      element.parentId && codes.has(element.parentId) ? element.parentId : null;
    const list = children.get(key);
    if (list) list.push(element);
    else children.set(key, [element]);
  }
  for (const list of children.values()) {
    list.sort(
      (a, b) =>
        Number(a.sortOrder) - Number(b.sortOrder) || a.sequence - b.sequence
    );
  }
  const rows: WbsTreeRow[] = [];
  const walk = (parentId: string | null, level: number) => {
    for (const element of children.get(parentId) ?? []) {
      rows.push({
        element,
        code: codes.get(element.id)!,
        level,
        parentCode: parentId ? (codes.get(parentId) ?? null) : null,
        hasChildren: (children.get(element.id)?.length ?? 0) > 0
      });
      walk(element.id, level + 1);
    }
  };
  walk(null, 1);
  return rows;
}

/** The WBS export: one record per numbered element, keyed by `WBS_CSV_COLUMNS`. */
export function toWbsCsvRows(
  elements: readonly WbsElement[],
  links: readonly WbsLink[]
): Record<(typeof WBS_CSV_COLUMNS)[number], string | number | null>[] {
  const tree = wbsTree(elements);
  const codeById = new Map(tree.map((row) => [row.element.id, row.code]));
  return tree.map((row) => ({
    "Element ID": row.element.readableId,
    "WBS Code": row.code,
    "Parent WBS Code": row.parentCode,
    Level: row.level,
    Type: row.element.type,
    Name: row.element.name,
    Start: row.element.startDate,
    Target: row.element.targetDate,
    Budget: row.element.budget,
    Predecessors:
      links
        .filter((link) => link.toElementId === row.element.id)
        .map((link) => codeById.get(link.fromElementId))
        .filter((code): code is string => Boolean(code))
        .join("; ") || null
  }));
}

/** A row of an import that creates an element. `key` is `new:<row>`. */
export type WbsCsvCreate = {
  key: string;
  row: number;
  parentKey: string | null;
  type: ProjectElementType;
  name: string;
  wbsCode: string | null;
  startDate: string | null;
  targetDate: string | null;
  budget: number | null;
};

/** A row of an import that updates an element: its values after the import. */
export type WbsCsvUpdate = {
  id: string;
  row: number;
  readableId: string;
  parentKey: string | null;
  parentChanged: boolean;
  type: ProjectElementType;
  name: string;
  wbsCode: string | null;
  startDate: string | null;
  targetDate: string | null;
  budget: number | null;
};

export type WbsCsvResult = {
  creates: WbsCsvCreate[];
  updates: WbsCsvUpdate[];
  /** New `precedes` links, by element id or `new:<row>` key. */
  links: { fromKey: string; toKey: string }[];
  errors: { row: number; message: string }[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const wbsImportTypes = projectElementTypes.filter(
  (type) => type !== "Parameter"
);

/**
 * Reads an uploaded WBS CSV against a project's elements. A row with an
 * `Element ID` updates that element; a row without one creates an element.
 * On an update a blank cell keeps the current value, and a code is pinned
 * only when it differs from the element's current code, so an export read
 * back changes nothing. Nothing is deleted. Pure: the import action and the
 * preview read the same result.
 */
export function readWbsCsv(
  input: readonly Record<string, string | undefined>[],
  elements: readonly WbsElement[],
  links: readonly WbsLink[]
): WbsCsvResult {
  const errors: WbsCsvResult["errors"] = [];
  const fail = (row: number, message: string) => errors.push({ row, message });
  const cell = (record: Record<string, string | undefined>, column: string) => {
    const value = record[column]?.trim();
    return value ? value : null;
  };

  const { codes } = computeWbsCodes(
    elements.map((element) => ({
      ...element,
      sortOrder: Number(element.sortOrder)
    }))
  );
  const byReadableId = new Map(
    elements.map((element) => [element.readableId, element])
  );
  const byId = new Map(elements.map((element) => [element.id, element]));

  type Parsed = {
    row: number;
    key: string;
    existing: WbsElement | null;
    code: string | null;
    parentCode: string | null;
    record: Record<string, string | undefined>;
  };
  const parsed: Parsed[] = [];
  const seenIds = new Set<string>();
  input.forEach((record, index) => {
    const row = index + 2; // the header is row 1
    const readableId = cell(record, "Element ID");
    const existing = readableId ? (byReadableId.get(readableId) ?? null) : null;
    if (readableId && !existing) {
      fail(row, `Element ID ${readableId} is not an element of this project`);
      return;
    }
    if (existing?.type === "Parameter") {
      fail(
        row,
        `${readableId} is a Parameter: Parameters are not part of the WBS`
      );
      return;
    }
    if (existing) {
      if (seenIds.has(existing.id)) {
        fail(row, `Element ID ${readableId} appears twice`);
        return;
      }
      seenIds.add(existing.id);
    }
    const code = cell(record, "WBS Code");
    if (code && !isValidWbsCode(code)) {
      fail(
        row,
        `WBS code ${code} is not valid: use 1 to 40 letters, digits, dots and dashes`
      );
      return;
    }
    parsed.push({
      row,
      key: existing ? existing.id : `new:${row}`,
      existing,
      code,
      parentCode: cell(record, "Parent WBS Code"),
      record
    });
  });

  // The code of every element after the import: the file's code where it
  // gives one, else the element's current code.
  const keyByCode = new Map<string, string>();
  const fileCodeKeys = new Set(parsed.filter((p) => p.code).map((p) => p.key));
  for (const element of elements) {
    const code = codes.get(element.id);
    if (code && !fileCodeKeys.has(element.id)) keyByCode.set(code, element.id);
  }
  for (const p of parsed) {
    if (!p.code) continue;
    const holder = keyByCode.get(p.code);
    if (holder && holder !== p.key) {
      const other = byId.get(holder);
      fail(
        p.row,
        `WBS code ${p.code} repeats${other ? ` (${other.readableId} has it)` : ""}`
      );
      continue;
    }
    keyByCode.set(p.code, p.key);
  }

  const creates: WbsCsvCreate[] = [];
  const updates: WbsCsvUpdate[] = [];
  const parentOf = new Map<string, string | null>(
    elements.map((element) => [element.id, element.parentId])
  );
  const typeOf = new Map<string, ProjectElementType>(
    elements.map((element) => [element.id, element.type])
  );

  for (const p of parsed) {
    const { record, row, existing } = p;
    let name = cell(record, "Name") ?? existing?.name ?? null;
    if (!name) {
      fail(row, "Every row needs a Name");
      continue;
    }
    // The CSV encoder strips a leading = + - @ from every cell, so
    // "+28V Power" exports as "28V Power": that is not a rename.
    if (existing && name !== existing.name) {
      if (stripCsvFormulaPrefix(existing.name) === name) name = existing.name;
    }
    const typeCell = cell(record, "Type");
    const type = (typeCell ?? existing?.type ?? "Task") as ProjectElementType;
    if (!(wbsImportTypes as readonly string[]).includes(type)) {
      fail(row, `Type ${type} is not one of ${wbsImportTypes.join(", ")}`);
      continue;
    }
    // A type decides an element's links and fields; the element page owns
    // that change, so an import never makes it.
    if (existing && type !== existing.type) {
      fail(
        row,
        `${existing.readableId} is a ${existing.type}: an import cannot change its type`
      );
      continue;
    }
    const date = (column: "Start" | "Target", current: string | null) => {
      const value = cell(record, column);
      if (value === null) return { value: existing ? current : null };
      if (!ISO_DATE.test(value))
        return { error: `${column} must be YYYY-MM-DD` };
      try {
        parseDate(value);
      } catch {
        return { error: `${column} ${value} is not a date` };
      }
      return { value };
    };
    const start = date("Start", existing?.startDate ?? null);
    const target = date("Target", existing?.targetDate ?? null);
    if ("error" in start || "error" in target) {
      fail(
        row,
        ("error" in start ? start.error : undefined) ??
          (target as { error: string }).error
      );
      continue;
    }
    if (start.value && target.value && target.value < start.value) {
      fail(row, "Target is before Start");
      continue;
    }
    const budgetCell = cell(record, "Budget");
    let budget = existing ? (existing.budget ?? null) : null;
    if (budgetCell !== null) {
      const value = Number(budgetCell.replace(/[$,\s]/g, ""));
      if (!Number.isFinite(value) || value < 0) {
        fail(row, `Budget ${budgetCell} must be a number of 0 or more`);
        continue;
      }
      budget = value;
    }

    let parentKey: string | null = existing ? existing.parentId : null;
    if (p.parentCode) {
      const key = keyByCode.get(p.parentCode);
      if (!key) {
        fail(
          row,
          `Parent WBS code ${p.parentCode} is not in the file or the project`
        );
        continue;
      }
      if (key === p.key) {
        fail(row, "An element cannot be its own parent");
        continue;
      }
      parentKey = key;
    }

    parentOf.set(p.key, parentKey);
    typeOf.set(p.key, type);
    if (existing) {
      const currentCode = codes.get(existing.id) ?? null;
      // Pin only a code that differs from the current one.
      const wbsCode =
        p.code && p.code !== currentCode ? p.code : existing.wbsCode;
      const changed =
        parentKey !== existing.parentId ||
        type !== existing.type ||
        name !== existing.name ||
        wbsCode !== existing.wbsCode ||
        start.value !== existing.startDate ||
        target.value !== existing.targetDate ||
        budget !== (existing.budget === null ? null : Number(existing.budget));
      // A row read back as it was exported is not an update.
      if (!changed) continue;
      updates.push({
        id: existing.id,
        row,
        readableId: existing.readableId,
        parentKey,
        parentChanged: parentKey !== existing.parentId,
        type,
        name,
        wbsCode,
        startDate: start.value,
        targetDate: target.value,
        budget
      });
    } else {
      creates.push({
        key: p.key,
        row,
        parentKey,
        type,
        name,
        wbsCode: p.code,
        startDate: start.value,
        targetDate: target.value,
        budget
      });
    }
  }

  // No element may end up under itself: a move into its own subtree, or new
  // rows that name each other as parents.
  const placed = [
    ...updates
      .filter((update) => update.parentChanged)
      .map((update) => ({
        key: update.id,
        row: update.row,
        parentKey: update.parentKey,
        label: update.readableId
      })),
    ...creates.map((create) => ({
      key: create.key,
      row: create.row,
      parentKey: create.parentKey,
      label: create.name
    }))
  ];
  for (const item of placed) {
    const seen = new Set<string>([item.key]);
    let current = item.parentKey;
    while (current) {
      if (seen.has(current)) {
        fail(item.row, `${item.label} cannot sit under its own subtree`);
        break;
      }
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
    const parentType = item.parentKey ? typeOf.get(item.parentKey) : null;
    if (parentType === "Parameter") {
      fail(item.row, "A Parameter can only have Parameters as children");
    }
  }

  // Predecessors: new finish-to-start links into the row's element.
  const existingLinks = new Set(
    links.map((link) => `${link.fromElementId}>${link.toElementId}`)
  );
  const newLinks: WbsCsvResult["links"] = [];
  for (const p of parsed) {
    const value = cell(p.record, "Predecessors");
    if (!value) continue;
    for (const part of value.split(/[;,]/)) {
      const code = part.trim().replace(/FS$/i, "").trim();
      if (!code) continue;
      const fromKey = keyByCode.get(code);
      if (!fromKey) {
        fail(p.row, `Predecessor ${code} is not in the file or the project`);
        continue;
      }
      if (fromKey === p.key) {
        fail(p.row, "An element cannot precede itself");
        continue;
      }
      const id = `${fromKey}>${p.key}`;
      if (existingLinks.has(id)) continue;
      existingLinks.add(id);
      newLinks.push({ fromKey, toKey: p.key });
    }
  }

  // The precedes links must not form a loop.
  const next = new Map<string, string[]>();
  for (const id of existingLinks) {
    const [from, to] = id.split(">") as [string, string];
    next.set(from, [...(next.get(from) ?? []), to]);
  }
  for (const link of newLinks) {
    const stack = [link.toKey];
    const seen = new Set<string>();
    let loops = false;
    while (stack.length > 0 && !loops) {
      const current = stack.pop()!;
      if (current === link.fromKey) loops = true;
      if (seen.has(current)) continue;
      seen.add(current);
      stack.push(...(next.get(current) ?? []));
    }
    if (loops) {
      const row = parsed.find((p) => p.key === link.toKey)?.row ?? 0;
      fail(row, "The predecessors make a loop");
    }
  }

  errors.sort((a, b) => a.row - b.row);
  return { creates, updates, links: newLinks, errors };
}

// --- MS Project XML (MSPDI) export ----------------------------------------------

/** MSPDI writes currency in hundredths: $200.00 is 20000. */
const MSPDI_COST_FACTOR = 100;
const MSPDI_COST_SCALE = 0;
const MSPDI_HOURS_PER_DAY = 8;
/** MS Project field ids of the task Text1–Text3 fields (MPXJ `MPPTaskField`). */
const MSPDI_TEXT1 = 188743731;
const MSPDI_TEXT2 = 188743734;
const MSPDI_TEXT3 = 188743737;

export type MspdiInput = {
  project: { name: string; identifier: string; currencyCode: string };
  elements: readonly WbsElement[];
  links: readonly WbsLink[];
  /** Elements flagged `isControlAccount`. */
  controlAccountIds: ReadonlySet<string>;
  /** Elements with an earned value technique. */
  workPackageIds: ReadonlySet<string>;
  /** The latest baseline's dates and budgets by element id, if any. */
  baseline: ReadonlyMap<
    string,
    {
      startDate: string | null;
      targetDate: string | null;
      budget: number | null;
    }
  > | null;
  /** The project start when no element has a date (`YYYY-MM-DD`). */
  today: string;
};

/** Control characters XML 1.0 forbids even escaped: one makes the file unreadable. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const XML_INVALID_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const xmlEscape = (value: string) =>
  value
    .replace(XML_INVALID_CHARACTERS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/** Working days Monday to Friday from `start` to `end`, both included; at least 1. */
function workingDays(start: string, end: string): number {
  let day = parseDate(start);
  const last = parseDate(end);
  let count = 0;
  while (day.compare(last) <= 0) {
    const weekday = getDayOfWeek(day, "en-US");
    if (weekday !== 0 && weekday !== 6) count += 1;
    day = day.add({ days: 1 });
  }
  return Math.max(1, count);
}

const mspdiCost = (amount: number) =>
  round(amount * MSPDI_COST_FACTOR, MSPDI_COST_SCALE);

/**
 * A project's WBS as a Microsoft Project XML (MSPDI) file. MS Project,
 * Primavera P6 and Deltek Cobra import it. The children of each element are
 * written in the order of the MSPDI schema (`xsd:sequence`). A leaf carries
 * its budget as a fixed cost and a Start No Earlier Than constraint, so
 * Project keeps Carbon's dates unless a link pushes them later. Text1 holds
 * the readable id, Text2 the control account's code, Text3 "Y" on a work
 * package. Throws while 2 elements share a code.
 */
export function buildMspdiXml(input: MspdiInput): string {
  const tree = wbsTree(input.elements);
  const codeById = new Map(tree.map((row) => [row.element.id, row.code]));
  const parentById = new Map(
    input.elements.map((element) => [element.id, element.parentId])
  );
  const controlAccountCode = (id: string) => {
    let current: string | null = id;
    while (current) {
      if (input.controlAccountIds.has(current))
        return codeById.get(current) ?? "";
      current = parentById.get(current) ?? null;
    }
    return "";
  };

  const starts = tree
    .map((row) => row.element.startDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  const projectStart = starts[0] ?? input.today;

  const lines: string[] = [];
  const add = (depth: number, text: string) =>
    lines.push(`${"  ".repeat(depth)}${text}`);
  const tag = (depth: number, name: string, value: string | number) =>
    add(
      depth,
      `<${name}>${typeof value === "string" ? xmlEscape(value) : value}</${name}>`
    );

  lines.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  add(0, '<Project xmlns="http://schemas.microsoft.com/project">');
  tag(1, "SaveVersion", 14);
  tag(1, "Name", `${input.project.identifier} ${input.project.name}`);
  tag(1, "ScheduleFromStart", 1);
  tag(1, "StartDate", `${projectStart}T08:00:00`);
  tag(1, "CurrencyCode", input.project.currencyCode);
  tag(1, "CalendarUID", 1);
  tag(1, "DefaultStartTime", "08:00:00");
  tag(1, "DefaultFinishTime", "17:00:00");
  tag(1, "MinutesPerDay", MSPDI_HOURS_PER_DAY * 60);
  tag(1, "MinutesPerWeek", MSPDI_HOURS_PER_DAY * 60 * 5);
  tag(1, "DaysPerMonth", 20);

  add(1, "<ExtendedAttributes>");
  for (const [fieldId, fieldName, alias] of [
    [MSPDI_TEXT1, "Text1", "Carbon Element ID"],
    [MSPDI_TEXT2, "Text2", "Control Account"],
    [MSPDI_TEXT3, "Text3", "Work Package"]
  ] as const) {
    add(2, "<ExtendedAttribute>");
    tag(3, "FieldID", fieldId);
    tag(3, "FieldName", fieldName);
    tag(3, "Alias", alias);
    add(2, "</ExtendedAttribute>");
  }
  add(1, "</ExtendedAttributes>");

  add(1, "<Calendars>");
  add(2, "<Calendar>");
  tag(3, "UID", 1);
  tag(3, "Name", "Standard");
  tag(3, "IsBaseCalendar", 1);
  tag(3, "BaseCalendarUID", -1);
  add(3, "<WeekDays>");
  for (let dayType = 1; dayType <= 7; dayType++) {
    const working = dayType !== 1 && dayType !== 7;
    add(4, "<WeekDay>");
    tag(5, "DayType", dayType);
    tag(5, "DayWorking", working ? 1 : 0);
    if (working) {
      add(5, "<WorkingTimes>");
      for (const [from, to] of [
        ["08:00:00", "12:00:00"],
        ["13:00:00", "17:00:00"]
      ]) {
        add(6, "<WorkingTime>");
        tag(7, "FromTime", from);
        tag(7, "ToTime", to);
        add(6, "</WorkingTime>");
      }
      add(5, "</WorkingTimes>");
    }
    add(4, "</WeekDay>");
  }
  add(3, "</WeekDays>");
  add(2, "</Calendar>");
  add(1, "</Calendars>");

  // The outline number is the row's position (1, 1.1, 1.2), whatever its
  // pinned WBS code; Project rebuilds it from OutlineLevel and the row order.
  const outlineById = new Map<string, string>();
  const childCount = new Map<string | null, number>();
  for (const row of tree) {
    const parent =
      row.element.parentId && codeById.has(row.element.parentId)
        ? row.element.parentId
        : null;
    const position = (childCount.get(parent) ?? 0) + 1;
    childCount.set(parent, position);
    outlineById.set(
      row.element.id,
      parent ? `${outlineById.get(parent)}.${position}` : String(position)
    );
  }

  add(1, "<Tasks>");
  tree.forEach((row, index) => {
    const { element } = row;
    const start = element.startDate ?? projectStart;
    const finish =
      element.targetDate && element.targetDate >= start
        ? element.targetDate
        : start;
    const hours = workingDays(start, finish) * MSPDI_HOURS_PER_DAY;
    const isLeaf = !row.hasChildren;
    add(2, "<Task>");
    tag(3, "UID", element.sequence);
    tag(3, "ID", index + 1);
    tag(3, "Name", element.name);
    tag(3, "Active", 1);
    tag(3, "Manual", 0);
    tag(3, "WBS", row.code);
    tag(3, "OutlineNumber", outlineById.get(element.id) ?? row.code);
    tag(3, "OutlineLevel", row.level);
    tag(3, "Start", `${start}T08:00:00`);
    tag(3, "Finish", `${finish}T17:00:00`);
    tag(3, "Duration", `PT${hours}H0M0S`);
    tag(3, "DurationFormat", 7);
    // An undated element gets Project's own default, one estimated day
    // ("1 day?"): a zero duration would draw it as a milestone.
    if (!element.startDate && !element.targetDate) tag(3, "Estimated", 1);
    tag(3, "Milestone", 0);
    tag(3, "Summary", isLeaf ? 0 : 1);
    if (isLeaf && element.budget !== null) {
      tag(3, "FixedCost", mspdiCost(element.budget));
      tag(3, "FixedCostAccrual", 2);
    }
    if (isLeaf && element.startDate) {
      tag(3, "ConstraintType", 4);
      tag(3, "ConstraintDate", `${element.startDate}T08:00:00`);
    }
    for (const link of input.links) {
      if (link.toElementId !== element.id) continue;
      const predecessor = input.elements.find(
        (other) => other.id === link.fromElementId
      );
      if (!predecessor || !codeById.has(predecessor.id)) continue;
      add(3, "<PredecessorLink>");
      tag(4, "PredecessorUID", predecessor.sequence);
      tag(4, "Type", 1);
      tag(4, "LinkLag", 0);
      tag(4, "LagFormat", 7);
      add(3, "</PredecessorLink>");
    }
    for (const [fieldId, value] of [
      [MSPDI_TEXT1, element.readableId],
      [MSPDI_TEXT2, controlAccountCode(element.id)],
      [MSPDI_TEXT3, input.workPackageIds.has(element.id) ? "Y" : ""]
    ] as const) {
      if (!value) continue;
      add(3, "<ExtendedAttribute>");
      tag(4, "FieldID", fieldId);
      tag(4, "Value", value);
      add(3, "</ExtendedAttribute>");
    }
    const planned = input.baseline?.get(element.id);
    if (planned?.startDate) {
      const plannedFinish =
        planned.targetDate && planned.targetDate >= planned.startDate
          ? planned.targetDate
          : planned.startDate;
      add(3, "<Baseline>");
      tag(4, "Number", 0);
      tag(4, "Start", `${planned.startDate}T08:00:00`);
      tag(4, "Finish", `${plannedFinish}T17:00:00`);
      tag(
        4,
        "Duration",
        `PT${workingDays(planned.startDate, plannedFinish) * MSPDI_HOURS_PER_DAY}H0M0S`
      );
      tag(4, "DurationFormat", 7);
      if (isLeaf && planned.budget !== null) {
        tag(4, "Cost", mspdiCost(planned.budget));
      }
      add(3, "</Baseline>");
    }
    add(2, "</Task>");
  });
  add(1, "</Tasks>");
  add(0, "</Project>");
  return `${lines.join("\n")}\n`;
}
