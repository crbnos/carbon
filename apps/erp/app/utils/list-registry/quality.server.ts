// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  GAUGE_CALIBRATION_RECORDS_PAGING,
  GAUGE_TYPES_PAGING,
  GAUGES_PAGING,
  getGaugeCalibrationRecords,
  getGauges,
  getGaugeTypes,
  getInspectionPlanParts,
  getInspections,
  getIssues,
  getIssueTypes,
  getIssueWorkflows,
  getQualityActions,
  getQualityDocuments,
  getRequiredActions,
  getRisks,
  INSPECTION_PLAN_PARTS_PAGING,
  INSPECTIONS_PAGING,
  ISSUE_TYPES_PAGING,
  ISSUE_WORKFLOWS_PAGING,
  ISSUES_PAGING,
  QUALITY_ACTIONS_PAGING,
  QUALITY_DOCUMENTS_PAGING,
  REQUIRED_ACTIONS_PAGING,
  RISKS_PAGING
} from "~/modules/quality/quality.service";
import type { ListDefinition } from "./index.server";
import { searchList } from "./index.server";

// The quality loaders do not bypass RLS, so their lists keep the RLS client
// and `role: "employee"`.

export const issuesList = searchList({
  key: "issues",
  permission: { view: "quality", role: "employee" },
  paging: ISSUES_PAGING,
  service: getIssues
});

export const qualityActionsList = searchList({
  key: "quality-actions",
  permission: { view: "quality", role: "employee" },
  paging: QUALITY_ACTIONS_PAGING,
  service: getQualityActions
});

export const gaugeCalibrationRecordsList = searchList({
  key: "gauge-calibration-records",
  permission: { view: "quality", role: "employee" },
  paging: GAUGE_CALIBRATION_RECORDS_PAGING,
  service: getGaugeCalibrationRecords
});

export const qualityDocumentsList = searchList({
  key: "quality-documents",
  permission: { view: "quality", role: "employee" },
  paging: QUALITY_DOCUMENTS_PAGING,
  service: getQualityDocuments
});

export const gaugesList = searchList({
  key: "gauges",
  permission: { view: "quality", role: "employee" },
  paging: GAUGES_PAGING,
  service: getGauges
});

export const gaugeTypesList = searchList({
  key: "gauge-types",
  permission: { view: "quality", role: "employee" },
  paging: GAUGE_TYPES_PAGING,
  service: getGaugeTypes
});

export const inspectionPlansList = searchList({
  key: "inspection-plans",
  permission: { view: "quality", role: "employee" },
  paging: INSPECTION_PLAN_PARTS_PAGING,
  service: getInspectionPlanParts,
  // The column joins the plans' names; the view's `planNames` is for search.
  exportValues: {
    planNames: (row) => row.plans.map((plan) => plan.name).join(", ")
  }
});

export const inspectionsList = searchList({
  key: "inspections",
  permission: { view: "quality", role: "employee" },
  paging: INSPECTIONS_PAGING,
  service: getInspections,
  params: { status: "status", source: "source" }
});

export const issueTypesList = searchList({
  key: "issue-types",
  permission: { view: "quality", role: "employee" },
  paging: ISSUE_TYPES_PAGING,
  service: getIssueTypes
});

export const issueWorkflowsList = searchList({
  key: "issue-workflows",
  permission: { view: "quality", role: "employee" },
  paging: ISSUE_WORKFLOWS_PAGING,
  service: getIssueWorkflows
});

export const requiredActionsList = searchList({
  key: "required-actions",
  permission: { view: "quality", role: "employee" },
  paging: REQUIRED_ACTIONS_PAGING,
  service: getRequiredActions
});

export const risksList = searchList({
  key: "risks",
  permission: { view: "quality", role: "employee" },
  paging: RISKS_PAGING,
  service: getRisks
});

export const qualityLists: Record<string, ListDefinition> = {
  [issuesList.key]: issuesList,
  [qualityActionsList.key]: qualityActionsList,
  [gaugeCalibrationRecordsList.key]: gaugeCalibrationRecordsList,
  [qualityDocumentsList.key]: qualityDocumentsList,
  [gaugesList.key]: gaugesList,
  [gaugeTypesList.key]: gaugeTypesList,
  [inspectionPlansList.key]: inspectionPlansList,
  [inspectionsList.key]: inspectionsList,
  [issueTypesList.key]: issueTypesList,
  [issueWorkflowsList.key]: issueWorkflowsList,
  [requiredActionsList.key]: requiredActionsList,
  [risksList.key]: risksList
};
