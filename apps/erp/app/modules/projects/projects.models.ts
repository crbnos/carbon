// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { methodType } from "../shared";

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
