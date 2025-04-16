import type { Database } from "@carbon/database";
import type {
  getNonConformance,
  getNonConformanceActionTasks,
  getNonConformanceApprovalTasks,
  getNonConformanceInvestigationTasks,
  getNonConformanceReviewers,
  getNonConformanceTypes,
  getNonConformanceWorkflow,
} from "./quality.service";

export type NonConformanceStatus =
  Database["public"]["Enums"]["nonConformanceStatus"];

export type NonConformance = NonNullable<
  Awaited<ReturnType<typeof getNonConformance>>["data"]
>;

export type NonConformanceType = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceTypes>>["data"]
>[number];

export type NonConformanceWorkflow = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceWorkflow>>["data"]
>;

export type NonConformanceInvestigationTask = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceInvestigationTasks>>["data"]
>[number];

export type NonConformanceActionTask = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceActionTasks>>["data"]
>[number];

export type NonConformanceApprovalTask = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceApprovalTasks>>["data"]
>[number];

export type NonConformanceReviewer = NonNullable<
  Awaited<ReturnType<typeof getNonConformanceReviewers>>["data"]
>[number];
