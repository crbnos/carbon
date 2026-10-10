// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type {
  getProjectBaselines,
  getProjectBorrows,
  getProjectChangeRequests,
  getProjectStockTransfer,
  getProjectStockTransferLines,
  getProjects,
  getStockOwnerProjects
} from "./projects.service";

type Tables = Database["public"]["Tables"];

export type Project = Tables["project"]["Row"];
export type ProjectListItem = NonNullable<
  Awaited<ReturnType<typeof getProjects>>["data"]
>[number];
export type ProjectState = Tables["projectState"]["Row"];
export type ProjectLabel = Tables["projectLabel"]["Row"];
export type ProjectMilestone = Tables["projectMilestone"]["Row"];
export type ProjectElement = Tables["projectElement"]["Row"];
export type ProjectElementLink = Tables["projectElementLink"]["Row"];
export type ProjectElementLabel = Tables["projectElementLabel"]["Row"];
export type ProjectElementComment = Tables["projectElementComment"]["Row"];
export type ProjectElementMaterial = Tables["projectElementMaterial"]["Row"];
export type ProjectElementLabor = Tables["projectElementLabor"]["Row"];
export type ProjectElementCost = Tables["projectElementCost"]["Row"];
export type LaborCategory = Tables["laborCategory"]["Row"];
export type LaborCategoryRate = Tables["laborCategoryRate"]["Row"];
export type TimesheetEntry = Tables["timesheetEntry"]["Row"];
export type ProjectLedgerEntry = Tables["projectLedger"]["Row"];
export type ProjectBaseline = Tables["projectBaseline"]["Row"];
export type ProjectBaselineListItem = NonNullable<
  Awaited<ReturnType<typeof getProjectBaselines>>["data"]
>[number];
export type ProjectChangeRequest = Tables["projectChangeRequest"]["Row"];
export type ProjectChangeRequestListItem = NonNullable<
  Awaited<ReturnType<typeof getProjectChangeRequests>>["data"]
>[number];
export type ProjectChangeRequestComment =
  Tables["projectChangeRequestComment"]["Row"];
export type ProjectStockTransfer = NonNullable<
  Awaited<ReturnType<typeof getProjectStockTransfer>>["data"]
>;
export type ProjectStockTransferLine = NonNullable<
  Awaited<ReturnType<typeof getProjectStockTransferLines>>["data"]
>[number];
export type ProjectBorrow = NonNullable<
  Awaited<ReturnType<typeof getProjectBorrows>>["data"]
>[number];
export type StockOwnerProject = NonNullable<
  Awaited<ReturnType<typeof getStockOwnerProjects>>["data"]
>[number];
