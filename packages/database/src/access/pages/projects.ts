// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const PROJECTS_PAGES = [
  {
    id: "projects.projects",
    label: "Projects",
    maxLevel: "Full",
    tables: [
      "project",
      "projectBaseline",
      "projectBorrow",
      "projectChangeRequest",
      "projectChangeRequestComment",
      "projectChangeRequestItem",
      "projectElement",
      "projectElementComment",
      "projectElementCost",
      "projectElementLabel",
      "projectElementLabor",
      "projectElementLink",
      "projectElementMaterial",
      "projectExpenseEntry",
      "projectLabel",
      "projectLedger",
      "projectMember",
      "projectMilestone",
      "projectPeg",
      "projectState",
      "projectStockTransfer",
      "projectStockTransferLine",
      "projectView",
      "earnedValuePeriod"
    ],
    // The project list is the module's root.
    paths: ["/x/projects", "/x/project/", "/x/project-stock-transfer/"]
  },
  {
    // Submitted time and the contract billable items to review.
    id: "projects.approvals",
    label: "Approvals",
    maxLevel: "Full",
    tables: [
      "timesheetEntry",
      "timesheetCertification",
      "timesheetEntryRevision",
      "projectBillableItem"
    ],
    paths: ["/x/projects/approvals", "/x/projects/billing"]
  },
  {
    id: "projects.reports",
    label: "Reports",
    maxLevel: "View",
    tables: [],
    paths: ["/x/projects/reports"]
  },
  {
    id: "projects.laborCategories",
    label: "Labor Categories",
    maxLevel: "Full",
    tables: ["laborCategory", "laborCategoryRate"],
    paths: ["/x/projects/labor-categories"]
  },
  {
    id: "projects.planningGroups",
    label: "Planning Groups",
    maxLevel: "Full",
    tables: ["planningGroup"],
    paths: ["/x/projects/planning-groups"]
  }
] as const satisfies readonly Page[];
