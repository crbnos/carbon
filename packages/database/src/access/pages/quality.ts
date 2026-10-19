// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Page } from "../registry";

export const QUALITY_PAGES = [
  {
    id: "quality.actions",
    label: "Actions",
    maxLevel: "View",
    tables: [],
    readers: [
      "nonConformanceActionTask",
      "nonConformance",
      "nonConformanceRequiredAction"
    ],
    paths: ["/x/quality/actions"]
  },
  {
    id: "quality.issues",
    label: "Issues",
    maxLevel: "Full",
    tables: [
      "nonConformance",
      "nonConformanceActionTask",
      "nonConformanceActionProcess",
      "nonConformanceApprovalTask",
      "nonConformanceCustomer",
      "nonConformanceInspection",
      "nonConformanceItem",
      "nonConformanceItemTrackedEntity",
      "nonConformanceJobOperation",
      "nonConformancePurchaseOrderLine",
      "nonConformancePurchaseReturnOrderLine",
      "nonConformanceReceiptLine",
      "nonConformanceReviewer",
      "nonConformanceSalesOrderLine",
      "nonConformanceSalesReturnOrderLine",
      "nonConformanceShipmentLine",
      "nonConformanceSupplier",
      "nonConformanceTrackedEntity"
    ],
    readers: ["nonConformanceRequiredAction"],
    paths: ["/x/quality/issues", "/x/issue/"]
  },
  {
    id: "quality.risks",
    label: "Risks",
    maxLevel: "Full",
    tables: ["riskRegister"],
    paths: ["/x/quality/risks"]
  },
  {
    id: "quality.gauges",
    label: "Gauges",
    maxLevel: "Full",
    tables: ["gauge"],
    paths: ["/x/quality/gauges"]
  },
  {
    id: "quality.records",
    label: "Records",
    maxLevel: "Full",
    tables: ["gaugeCalibrationRecord"],
    paths: ["/x/quality/calibrations"]
  },
  {
    id: "quality.inspections",
    label: "Inspections",
    maxLevel: "Full",
    tables: [
      "inspection",
      "inspectionHistory",
      "inspectionMeasurement",
      "inspectionSample"
    ],
    readers: ["inspectionSamplingPlan"],
    paths: ["/x/quality/inspections", "/x/inspection/"]
  },
  {
    id: "quality.inspectionPlans",
    label: "Inspection Plans",
    maxLevel: "Full",
    tables: [
      "inspectionDocument",
      "inspectionFeature",
      "inspectionSamplingPlan",
      "itemInspectionDocumentAssignment",
      "balloon"
    ],
    paths: ["/x/quality/inspection-plans", "/x/inspection-document/"]
  },
  {
    id: "quality.qualityDocuments",
    label: "Quality Documents",
    maxLevel: "Full",
    tables: ["qualityDocument", "qualityDocumentStep"],
    paths: ["/x/quality/documents", "/x/quality-document/"]
  },
  {
    id: "quality.actionTypes",
    label: "Action Types",
    maxLevel: "Full",
    tables: ["nonConformanceRequiredAction"],
    paths: ["/x/quality/required-actions"]
  },
  {
    id: "quality.gaugeTypes",
    label: "Gauge Types",
    maxLevel: "Full",
    tables: ["gaugeType"],
    paths: ["/x/quality/gauge-types"]
  },
  {
    id: "quality.issueTypes",
    label: "Issue Types",
    maxLevel: "Full",
    tables: ["nonConformanceType"],
    paths: ["/x/quality/issue-types"]
  },
  {
    id: "quality.issueWorkflows",
    label: "Issue Workflows",
    maxLevel: "Full",
    tables: ["nonConformanceWorkflow"],
    readers: ["nonConformanceRequiredAction"],
    paths: ["/x/quality/issue-workflows", "/x/issue-workflow/"]
  }
] as const satisfies readonly Page[];
