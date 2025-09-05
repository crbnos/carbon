import type { Database } from "@carbon/database";
import type { nonConformanceAssociationType } from "./quality.models";
import type {
  getGaugeCalibrationRecords,
  getGauges,
  getGaugeTypes,
  getInvestigationTypes,
  getIssueActionTasks,
  getIssueApprovalTasks,
  getIssueInvestigationTasks,
  getIssueReviewers,
  getIssues,
  getIssueTypes,
  getIssueWorkflow,
  getQualityActions,
  getRequiredActions,
} from "./quality.service";

export type Gauge = NonNullable<
  Awaited<ReturnType<typeof getGauges>>["data"]
>[number];

export type GaugeCalibrationRecord = NonNullable<
  Awaited<ReturnType<typeof getGaugeCalibrationRecords>>["data"]
>[number];

export type GaugeType = NonNullable<
  Awaited<ReturnType<typeof getGaugeTypes>>["data"]
>[number];

export type IssueAssociationKey =
  (typeof nonConformanceAssociationType)[number];

export type IssueAssociationNode = {
  key: IssueAssociationKey;
  name: string;
  pluralName: string;
  module: string;
  children: {
    id: string;
    documentId: string;
    documentReadableId: string;
    documentLineId: string;
    type: string;
  }[];
};

export type IssueStatus = Database["public"]["Enums"]["nonConformanceStatus"];

export type Issue = NonNullable<
  Awaited<ReturnType<typeof getIssues>>["data"]
>[number];

export type InvestigationType = NonNullable<
  Awaited<ReturnType<typeof getInvestigationTypes>>["data"]
>[number];

export type RequiredAction = NonNullable<
  Awaited<ReturnType<typeof getRequiredActions>>["data"]
>[number];

export type IssueType = NonNullable<
  Awaited<ReturnType<typeof getIssueTypes>>["data"]
>[number];

export type IssueWorkflow = NonNullable<
  Awaited<ReturnType<typeof getIssueWorkflow>>["data"]
>;

export type IssueInvestigationTask = NonNullable<
  Awaited<ReturnType<typeof getIssueInvestigationTasks>>["data"]
>[number];

export type IssueActionTask = NonNullable<
  Awaited<ReturnType<typeof getIssueActionTasks>>["data"]
>[number];

export type IssueApprovalTask = NonNullable<
  Awaited<ReturnType<typeof getIssueApprovalTasks>>["data"]
>[number];

export type IssueReviewer = NonNullable<
  Awaited<ReturnType<typeof getIssueReviewers>>["data"]
>[number];

export type QualityAction = NonNullable<
  Awaited<ReturnType<typeof getQualityActions>>["data"]
>[number];
