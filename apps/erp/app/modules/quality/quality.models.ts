import type { Database } from "@carbon/database";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { procedureStepType } from "../shared/shared.models";
import {
  inspectionLevels,
  inspectionSeverities,
  samplingPlanTypes,
  samplingStandards,
  standardAqlValues
} from "./samplingStandards";

export {
  inspectionLevels,
  inspectionSeverities,
  samplingPlanTypes,
  samplingStandards,
  standardAqlValues
};

export const disposition = [
  // "Conditional Acceptance",
  // "Deviation Accepted",
  // "Hold",
  // "No Action Required",
  "Pending",
  // "Quarantine",
  // "Repair",
  "Return to Supplier",
  "Rework",
  "Scrap",
  "Use As Is"
] as const;

export const gaugeStatus = ["Active", "Inactive"] as const;
export const gaugeCalibrationStatus = [
  "Pending",
  "In-Calibration",
  "Out-of-Calibration"
] as const;

export const gaugeRole = ["Master", "Standard"] as const;

export const nonConformanceApprovalRequirement = ["MRB"] as const;

export const nonConformanceSource = ["Internal", "External"] as const;

export const nonConformanceStatus = [
  "Registered",
  "In Progress",
  "Closed"
] as const;

export function isIssueLocked(status: string | null | undefined): boolean {
  return status === "Closed";
}

export const nonConformanceTaskStatus = [
  "Pending",
  "In Progress",
  "Completed",
  "Skipped"
] as const;

export const nonConformancePriority = [
  "Low",
  "Medium",
  "High",
  "Critical"
] as const;

export const nonConformanceAssociationType = [
  "items",
  "customers",
  "suppliers",
  "jobOperations",
  "purchaseOrderLines",
  "salesOrderLines",
  "shipmentLines",
  "receiptLines",
  "salesReturnOrderLines",
  "purchaseReturnOrderLines",
  "trackedEntities",
  "inspections"
] as const;

export const qualityDocumentStatus = ["Draft", "Active", "Archived"] as const;

export const riskSource = [
  "Customer",
  "General",
  "Item",
  "Job",
  "Quote Line",
  "Supplier",
  "Work Center"
] as const;

export const riskStatus = [
  "Open",
  "In Review",
  "Mitigating",
  "Closed",
  "Accepted"
] as const;

export const riskRegisterType = ["Risk", "Opportunity"] as const;

export const gaugeValidator = z.object({
  id: zfd.text(z.string().optional()),
  gaugeId: zfd.text(z.string().optional()),
  supplierId: zfd.text(z.string().optional()),
  modelNumber: zfd.text(z.string().optional()),
  serialNumber: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  dateAcquired: zfd.text(z.string().optional()),
  gaugeTypeId: z.string().min(1, { message: "Type is required" }),
  // gaugeCalibrationStatus: z.enum(gaugeCalibrationStatus),
  // gaugeStatus: z.enum(gaugeStatus),
  gaugeRole: z.enum(gaugeRole),
  lastCalibrationDate: zfd.text(z.string().optional()),
  nextCalibrationDate: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  storageUnitId: zfd.text(z.string().optional()),
  calibrationIntervalInMonths: zfd.numeric(
    z.number().min(1, {
      message: "Calibration interval is required"
    })
  )
});

export const calibrationAttempt = z.object({
  reference: zfd.numeric(z.number()),
  actual: zfd.numeric(z.number())
});

export const gaugeCalibrationRecordValidator = z.object({
  id: z.string().min(1, { message: "ID is required" }),
  gaugeId: z.string().min(1, { message: "Gauge is required" }),
  supplierId: zfd.text(z.string().optional()),
  dateCalibrated: z.string().min(1, { message: "Date is required" }),
  requiresAction: zfd.checkbox(),
  requiresAdjustment: zfd.checkbox(),
  requiresRepair: zfd.checkbox(),
  temperature: zfd.numeric(z.number().min(-200).max(500).optional()),
  humidity: zfd.numeric(z.number().min(0).max(1).optional()),
  approvedBy: zfd.text(z.string().optional()),
  measurementStandard: zfd.text(z.string().optional()),
  calibrationAttempts: zfd.repeatableOfType(calibrationAttempt),
  notes: z
    .string()
    .optional()
    .transform((val) => {
      try {
        return val ? JSON.parse(val) : {};
        // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
      } catch (e) {
        return {};
      }
    })
});

export const gaugeTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" })
});

export const issueAssociationValidator = z
  .object({
    type: z.enum(nonConformanceAssociationType),
    id: z.string(),
    lineId: zfd.text(z.string().optional()),
    quantity: zfd.numeric(z.number().min(0).optional())
  })
  .refine(
    (data) => {
      // For types other than items, customer, supplier, trackedEntity, or
      // inspection, lineId is required
      if (
        ![
          "items",
          "customers",
          "suppliers",
          "trackedEntities",
          "inspections"
        ].includes(data.type) &&
        !data.lineId
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Line ID is required"
    }
  );

export const issueValidator = z.object({
  id: zfd.text(z.string().optional()),
  nonConformanceId: zfd.text(z.string().optional()),
  priority: z.enum(nonConformancePriority),
  source: z.enum(nonConformanceSource),
  name: z.string().trim().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().optional()),
  requiredActionIds: z.array(z.string()).optional(),
  approvalRequirements: z
    .array(z.enum(nonConformanceApprovalRequirement))
    .optional(),
  locationId: z.string().min(1, { message: "Location is required" }),
  nonConformanceWorkflowId: zfd.text(z.string().optional()),
  nonConformanceTypeId: z.string().min(1, { message: "Type is required" }),
  openDate: z.string().min(1, { message: "Open date is required" }),
  dueDate: zfd.text(z.string().optional()),
  closeDate: zfd.text(z.string().optional()),
  quantity: zfd.numeric(z.number().optional()),
  items: z.array(z.string()).optional(),
  jobOperationId: z.string().optional(),
  customerId: z.string().optional(),
  salesOrderLineId: z.string().optional(),
  operationSupplierProcessId: z.string().optional()
});

export const nonConformanceReviewerValidator = z.object({
  title: z.string().min(1, { message: "Title is required" })
});

export const issueTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" })
});

export const issueWorkflowValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  content: z
    .string()
    .min(1, { message: "Content is required" })
    .transform((val) => {
      try {
        return JSON.parse(val);
        // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
      } catch (e) {
        return {};
      }
    }),
  priority: z.enum(nonConformancePriority),
  source: z.enum(nonConformanceSource),
  requiredActionIds: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return [];
      try {
        return JSON.parse(val) as string[];
        // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
      } catch (e) {
        return [];
      }
    }),
  approvalRequirements: z
    .array(z.enum(nonConformanceApprovalRequirement))
    .optional()
});

const entityAssignmentItem = z.object({
  trackedEntityId: z.string().min(1, { message: "Tracked entity is required" }),
  quantity: z
    .number({ error: "Quantity is required" })
    .positive({ message: "Quantity must be greater than zero" })
});

const entityAssignmentsFromForm = z
  .string()
  .optional()
  .transform((val) => {
    if (!val) return undefined;
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : undefined;
      // biome-ignore lint/correctness/noUnusedVariables: required by try/catch
    } catch (e) {
      return undefined;
    }
  })
  .pipe(z.array(entityAssignmentItem).optional());

export const splitIssueItemValidator = z
  .object({
    id: z.string().min(1, { message: "Id is required" }),
    itemId: z.string().min(1, { message: "Item is required" }),
    splitQuantity: zfd.numeric(
      z
        .number({ error: "Split quantity is required" })
        .positive({ message: "Split quantity must be greater than zero" })
        .optional()
    ),
    entityAssignments: entityAssignmentsFromForm
  })
  .refine(
    (data) =>
      (data.entityAssignments && data.entityAssignments.length > 0) ||
      (typeof data.splitQuantity === "number" && data.splitQuantity > 0),
    {
      message: "Either splitQuantity or entityAssignments is required",
      path: ["splitQuantity"]
    }
  );

export const assignIssueItemEntitiesValidator = z.object({
  nonConformanceItemId: z.string().min(1, { message: "Id is required" }),
  targetItemId: z.string().min(1, { message: "Target row is required" }),
  entityAssignments: entityAssignmentsFromForm.pipe(
    z
      .array(entityAssignmentItem)
      .min(1, { message: "Select at least one tracked entity" })
  )
});

export const qualityDocumentValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  version: zfd.numeric(z.number().min(0)),
  content: zfd.text(z.string().optional()),
  copyFromId: zfd.text(z.string().optional())
});

export const qualityDocumentStepValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    qualityDocumentId: z
      .string()
      .min(1, { message: "Quality document is required" }),
    name: z.string().trim().min(1, { message: "Name is required" }),
    description: zfd.text(z.string().optional()),
    type: z.enum(procedureStepType, {
      error: "Type is required"
    }),
    unitOfMeasureCode: zfd.text(z.string().optional()),
    minValue: zfd.numeric(z.number().min(0).optional()),
    maxValue: zfd.numeric(z.number().min(0).optional()),
    listValues: z.array(z.string()).optional(),
    sortOrder: zfd.numeric(z.number().min(0).optional())
  })
  .refine(
    (data) => {
      if (data.type === "Measurement") {
        return !!data.unitOfMeasureCode;
      }
      return true;
    },
    {
      message: "Unit of measure is required",
      path: ["unitOfMeasureCode"]
    }
  )
  .refine(
    (data) => {
      if (data.type === "List") {
        return (
          !!data.listValues &&
          data.listValues.length > 0 &&
          data.listValues.every((option) => option.trim() !== "")
        );
      }
      return true;
    },
    {
      message: "List options are required",
      path: ["listOptions"]
    }
  )
  .refine(
    (data) => {
      if (data.minValue != null && data.maxValue != null) {
        return data.maxValue >= data.minValue;
      }
      return true;
    },
    {
      message: "Maximum value must be greater than or equal to minimum value",
      path: ["maxValue"]
    }
  );

export const requiredActionValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  active: zfd.checkbox()
});

export const qualityDocumentApprovalValidator = z.object({
  approvalRequestId: z
    .string()
    .min(1, { message: "Approval request is required" }),
  decision: z.enum(["Approved", "Rejected"]),
  notes: zfd.text(z.string().optional())
});

export const QualityKPIs = [
  { key: "weeklyTracking", label: "Issue Trend" },
  { key: "statusDistribution", label: "Status Distribution" },
  { key: "paretoByType", label: "Pareto by Type" },
  { key: "ncrsByType", label: "NCRs by Type" },
  { key: "sourceAnalysis", label: "Source Analysis" },
  { key: "supplierQuality", label: "Supplier Quality" },
  { key: "weeksOpen", label: "Weeks Open" }
] as const;

export const riskRegisterValidator = z.object({
  id: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  itemId: zfd.text(z.string().optional()),
  likelihood: z.string().min(1, { message: "Likelihood is required" }),
  notes: z
    .string()
    .optional()
    .transform((val) => {
      try {
        return val ? JSON.parse(val) : {};
        // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
      } catch (e) {
        return {};
      }
    }),
  severity: z.string().min(1, { message: "Severity is required" }),
  source: z.enum(riskSource),
  sourceId: zfd.text(z.string().optional()),
  status: z.enum(riskStatus),
  title: z.string().min(1, { message: "Title is required" }),
  type: z.enum(riskRegisterType)
});

export const inspectionStatusType = [
  "Pending",
  "In Progress",
  "Passed",
  "Failed",
  "Partial"
] as const;

export const inspectionSampleStatusType = [
  "Pending",
  "Passed",
  "Failed"
] as const;

export const inspectionValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  status: z.enum(["Passed", "Failed"], {
    error: "Status is required"
  }),
  notes: zfd.text(z.string().optional())
});

export const inspectionSampleValidator = z.object({
  inspectionId: z.string().min(1, { message: "Inspection is required" }),
  // Optional: update an existing sample in place (the grid's "Overall result"
  // row re-toggles an anonymous non-serial column). Serial parts upsert by the
  // tracked entity instead, so they don't need it.
  sampleId: zfd.text(z.string().optional()),
  // Optional: serial parts scan a discrete tracked entity; batch / inventory /
  // non-inventory parts record pass/fail without one.
  trackedEntityId: zfd.text(z.string().optional()),
  // "Pending" registers a sample without a verdict (identify-only scan when an
  // inspection document drives per-feature measurements).
  status: z.enum(["Pending", "Passed", "Failed"], {
    error: "Status is required"
  }),
  notes: zfd.text(z.string().optional())
});

export const inspectionDispositionValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  decision: z.enum(["Accept", "Reject", "Partial"], {
    error: "Decision is required"
  }),
  notes: zfd.text(z.string().optional())
});

export const inspectionSourceDocuments = [
  "Receipt",
  "Job Operation",
  "First Article"
] as const satisfies readonly Database["public"]["Enums"]["inspectionSourceDocument"][];

export const inspectionDocumentUsages = [
  "Receipt",
  "First Article"
] as const satisfies readonly Database["public"]["Enums"]["inspectionDocumentUsage"][];

export const itemInspectionDocumentAssignmentValidator = z.object({
  itemId: z.string().min(1, { message: "Item is required" }),
  usage: z.enum(inspectionDocumentUsages, {
    error: "Usage is required"
  }),
  // Empty clears the slot.
  inspectionDocumentId: zfd.text(z.string().optional())
});

export const inspectionMeasurementValidator = z.object({
  inspectionId: z.string().min(1, { message: "Inspection is required" }),
  // Absent = create an anonymous sample (non-serial grid columns).
  sampleId: zfd.text(z.string().optional()),
  inspectionFeatureId: z.string().min(1, { message: "Feature is required" }),
  // Numeric string for Measurement features; empty clears the reading.
  value: zfd.text(z.string().optional()),
  // Attribute (non-numeric) features toggle pass/fail instead of a value.
  passed: zfd.text(z.enum(["true", "false"]).optional()),
  notes: zfd.text(z.string().optional())
});

export const certificateTypes = [
  "Material",
  "Special Process",
  "Functional Test",
  "Other"
] as const satisfies readonly Database["public"]["Enums"]["certificateType"][];

export const firstArticleInspectionStatuses = [
  "Draft",
  "Verified",
  "Approved"
] as const satisfies readonly Database["public"]["Enums"]["firstArticleInspectionStatus"][];

export const firstArticleInspectionScopes = [
  "Full",
  "Partial"
] as const satisfies readonly Database["public"]["Enums"]["firstArticleInspectionScope"][];

export const firstArticleInspectionTypes = [
  "Detail",
  "Assembly"
] as const satisfies readonly Database["public"]["Enums"]["firstArticleInspectionType"][];

export const firstArticleInspectionReasons = [
  "New Part",
  "Design Change",
  "Manufacturing Source Change",
  "Process Change",
  "Inspection Method Change",
  "Tooling Change",
  "Material Change",
  "Location Change",
  "NC Program Change",
  "Natural or Man-made Event",
  "Production Lapse",
  "Corrective Action",
  "Other"
] as const satisfies readonly Database["public"]["Enums"]["firstArticleInspectionReason"][];

export const customerApprovalVerifications = [
  "Yes",
  "No",
  "N/A"
] as const satisfies readonly Database["public"]["Enums"]["customerApprovalVerification"][];

// A certificate is evidence for exactly one thing: a received line (supplier
// cert) or a job operation (special process / functional test). The DB
// enforces the same rule (certificate_one_target).
export const certificateValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    type: z.enum(certificateTypes, {
      error: "Type is required"
    }),
    certificateNumber: z
      .string()
      .trim()
      .min(1, { message: "Certificate number is required" }),
    specification: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional()),
    supplierId: zfd.text(z.string().optional()),
    receiptLineId: zfd.text(z.string().optional()),
    jobOperationId: zfd.text(z.string().optional()),
    documentId: zfd.text(z.string().optional())
  })
  .refine((data) => !!data.receiptLineId !== !!data.jobOperationId, {
    message: "A certificate belongs to one receipt line or one job operation",
    path: ["receiptLineId"]
  });

export const complianceStatementValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  content: z.string().trim().min(1, { message: "Content is required" }),
  appliesToAllCustomers: zfd.checkbox(),
  active: zfd.checkbox(),
  customerIds: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional()
});

export const firstArticleInspectionCreateValidator = z
  .object({
    jobId: z.string().min(1, { message: "Job is required" }),
    jobMakeMethodId: z.string().min(1, { message: "Make method is required" }),
    scope: z.enum(firstArticleInspectionScopes, {
      error: "Scope is required"
    }),
    reason: z.enum(firstArticleInspectionReasons, {
      error: "Reason is required"
    }),
    baselineFirstArticleInspectionId: zfd.text(z.string().optional()),
    baselineReference: zfd.text(z.string().optional())
  })
  // A Partial (delta) FAI only re-verifies what changed, so it must point at
  // the full FAI it builds on — one in Carbon or an external reference.
  .refine(
    (data) =>
      data.scope !== "Partial" ||
      !!data.baselineFirstArticleInspectionId ||
      !!data.baselineReference,
    {
      message: "A partial first article needs a baseline",
      path: ["baselineFirstArticleInspectionId"]
    }
  );

export const firstArticleInspectionHeaderValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  // AS9102 Form 1
  partNumber: z.string().trim().min(1, { message: "Part number is required" }),
  partName: z.string().trim().min(1, { message: "Part name is required" }),
  partRevision: zfd.text(z.string().optional()),
  drawingNumber: zfd.text(z.string().optional()),
  drawingRevision: zfd.text(z.string().optional()),
  additionalChanges: zfd.text(z.string().optional()),
  manufacturingProcessReference: z
    .string()
    .trim()
    .min(1, { message: "Manufacturing process reference is required" }),
  organizationName: z
    .string()
    .trim()
    .min(1, { message: "Organization name is required" }),
  supplierCode: zfd.text(z.string().optional()),
  purchaseOrderNumber: zfd.text(z.string().optional()),
  scope: z.enum(firstArticleInspectionScopes, {
    error: "Scope is required"
  }),
  reason: z.enum(firstArticleInspectionReasons, {
    error: "Reason is required"
  }),
  baselineFirstArticleInspectionId: zfd.text(z.string().optional()),
  baselineReference: zfd.text(z.string().optional()),
  comments: zfd.text(z.string().optional())
});

// AS9102 Form 2 row: a material, special process or functional test.
export const firstArticleInspectionProductValidator = z.object({
  id: zfd.text(z.string().optional()),
  firstArticleInspectionId: z
    .string()
    .min(1, { message: "First article inspection is required" }),
  kind: z.enum(certificateTypes, {
    error: "Kind is required"
  }),
  name: z.string().trim().min(1, { message: "Name is required" }),
  specification: zfd.text(z.string().optional()),
  code: zfd.text(z.string().optional()),
  supplier: zfd.text(z.string().optional()),
  certificateNumber: zfd.text(z.string().optional()),
  certificateId: zfd.text(z.string().optional()),
  functionalTestProcedureNumber: zfd.text(z.string().optional()),
  acceptanceReportNumber: zfd.text(z.string().optional()),
  comments: zfd.text(z.string().optional()),
  customerApprovalVerification: z.enum(customerApprovalVerifications, {
    error: "Customer approval verification is required"
  })
});

export const firstArticleCustomerApprovalValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  customerApprovalName: zfd.text(z.string().optional()),
  customerApprovalDate: zfd.text(z.string().optional())
});
