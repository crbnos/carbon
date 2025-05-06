import type { Database } from "@carbon/database";
import type { nonConformanceAssociationType } from "./quality.models";
import type {
  getGaugeCalibrationRecords,
  getGauges,
  getGaugeTypes,
  getNonConformance,
  getNonConformanceActionTasks,
  getNonConformanceApprovalTasks,
  getNonConformanceInvestigationTasks,
  getNonConformanceReviewers,
  getNonConformanceTypes,
  getNonConformanceWorkflow,
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

export type NonConformanceAssociationKey =
  (typeof nonConformanceAssociationType)[number];

export type NonConformanceAssociationNode = {
  key: NonConformanceAssociationKey;
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
