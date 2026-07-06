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
  "trackedEntities",
  "inboundInspections"
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

export const inspectionDocumentValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: zfd.text(z.string().optional()),
  partId: z.string().min(1, { message: "Part is required" }),
  drawingNumber: zfd.text(z.string().optional()),
  pdfUrl: zfd.text(z.string().optional()),
  annotations: zfd.text(z.string().optional()),
  features: zfd.text(z.string().optional())
});

export const balloonFeatureValidator = z.object({
  id: zfd.text(z.string().optional()),
  inspectionDocumentId: z.string().min(1, { message: "Diagram is required" }),
  balloonNumber: zfd.numeric(z.number().min(1)),
  description: z.string().min(1, { message: "Description is required" }),
  nominalValue: zfd.numeric(z.number().optional()),
  tolerancePlus: zfd.numeric(z.number().optional()),
  toleranceMinus: zfd.numeric(z.number().optional()),
  unitOfMeasureCode: zfd.text(z.string().optional())
});

export const balloonCreateFromPayloadItemValidator = z.object({
  pageNumber: z.number(),
  regionX: z.number(),
  regionY: z.number(),
  regionWidth: z.number(),
  regionHeight: z.number(),
  label: z.string().min(1),
  xCoordinate: z.number(),
  yCoordinate: z.number(),
  nominalValue: z.string().nullable().optional(),
  tolerancePlus: z.string().nullable().optional(),
  toleranceMinus: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  description: z.string().nullable().optional()
});

export const balloonUpdateItemValidator = z.object({
  id: z.string().min(1),
  pageNumber: z.number().optional(),
  regionX: z.number().optional(),
  regionY: z.number().optional(),
  regionWidth: z.number().optional(),
  regionHeight: z.number().optional(),
  label: z.string().optional(),
  xCoordinate: z.number().optional(),
  yCoordinate: z.number().optional(),
  nominalValue: z.string().nullable().optional(),
  tolerancePlus: z.string().nullable().optional(),
  toleranceMinus: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  description: z.string().nullable().optional()
});

export const balloonDeleteValidator = z.object({
  ids: z.array(z.string().min(1))
});

const normalizedCoordinateValidator = z.number().min(0).max(1);
const normalizedSizeValidator = z.number().gt(0).max(1);
const pageNumberValidator = z.number().int().min(1);

export const balloonAnchorCreateItemValidator = z
  .object({
    pageNumber: pageNumberValidator,
    regionX: normalizedCoordinateValidator,
    regionY: normalizedCoordinateValidator,
    regionWidth: normalizedSizeValidator,
    regionHeight: normalizedSizeValidator
  })
  .strict();

export const balloonCreateItemWithOverlayValidator = z
  .object({
    pageNumber: pageNumberValidator,
    regionX: normalizedCoordinateValidator,
    regionY: normalizedCoordinateValidator,
    regionWidth: normalizedSizeValidator,
    regionHeight: normalizedSizeValidator,
    label: z.string().min(1),
    xCoordinate: normalizedCoordinateValidator,
    yCoordinate: normalizedCoordinateValidator,
    nominalValue: z.string().nullable().optional(),
    tolerancePlus: z.string().nullable().optional(),
    toleranceMinus: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    type: z.enum(procedureStepType).optional(),
    data: z.record(z.unknown()).optional()
  })
  .strict();

export const balloonCreateItemsValidator = z.array(
  z.union([
    balloonCreateItemWithOverlayValidator,
    balloonAnchorCreateItemValidator
  ])
);

export const balloonUpdateItemsValidator = z.array(
  balloonUpdateItemValidator.extend({
    pageNumber: pageNumberValidator.optional(),
    regionX: normalizedCoordinateValidator.optional(),
    regionY: normalizedCoordinateValidator.optional(),
    regionWidth: normalizedSizeValidator.optional(),
    regionHeight: normalizedSizeValidator.optional(),
    xCoordinate: normalizedCoordinateValidator.optional(),
    yCoordinate: normalizedCoordinateValidator.optional(),
    data: z.record(z.unknown()).optional()
  })
);

export const balloonDeleteIdsValidator = z.array(z.string().min(1));

export const inspectionSaveFeatureCreateItemValidator = z
  .object({
    tempId: z.string().min(1),
    pageNumber: pageNumberValidator,
    label: z.string().min(1),
    description: z.string().nullable().optional(),
    nominalValue: z.string().nullable().optional(),
    tolerancePlus: z.string().nullable().optional(),
    toleranceMinus: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    type: z.enum(procedureStepType).optional()
  })
  .strict();

export const inspectionSaveFeatureUpdateItemValidator = z
  .object({
    id: z.string().min(1),
    pageNumber: pageNumberValidator.optional(),
    label: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    nominalValue: z.string().nullable().optional(),
    tolerancePlus: z.string().nullable().optional(),
    toleranceMinus: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    type: z.enum(procedureStepType).optional()
  })
  .strict();

export const inspectionSaveFeaturesPayloadValidator = z
  .object({
    create: z.array(inspectionSaveFeatureCreateItemValidator).default([]),
    update: z.array(inspectionSaveFeatureUpdateItemValidator).default([]),
    delete: z.array(z.string().min(1)).default([])
  })
  .strict();

export const inspectionSaveBalloonGeometryCreateItemValidator = z
  .object({
    tempInspectionFeatureId: z.string().min(1).optional(),
    inspectionFeatureId: z.string().min(1).optional(),
    tempBalloonAnchorId: z.string().min(1).optional(),
    pageNumber: pageNumberValidator,
    regionX: normalizedCoordinateValidator,
    regionY: normalizedCoordinateValidator,
    regionWidth: normalizedSizeValidator,
    regionHeight: normalizedSizeValidator,
    xCoordinate: normalizedCoordinateValidator,
    yCoordinate: normalizedCoordinateValidator
  })
  .strict()
  .refine(
    (data) =>
      Boolean(data.tempInspectionFeatureId) ||
      Boolean(data.inspectionFeatureId),
    { message: "tempInspectionFeatureId or inspectionFeatureId is required" }
  );

export const inspectionSaveBalloonGeometryUpdateItemValidator = z
  .object({
    id: z.string().min(1),
    pageNumber: pageNumberValidator.optional(),
    regionX: normalizedCoordinateValidator.optional(),
    regionY: normalizedCoordinateValidator.optional(),
    regionWidth: normalizedSizeValidator.optional(),
    regionHeight: normalizedSizeValidator.optional(),
    xCoordinate: normalizedCoordinateValidator.optional(),
    yCoordinate: normalizedCoordinateValidator.optional()
  })
  .strict();

export const inspectionSaveBalloonsGeometryPayloadValidator = z
  .object({
    create: z
      .array(inspectionSaveBalloonGeometryCreateItemValidator)
      .default([]),
    update: z
      .array(inspectionSaveBalloonGeometryUpdateItemValidator)
      .default([]),
    delete: z.array(z.string().min(1)).default([])
  })
  .strict();

/** @deprecated Legacy combined payload; use features + balloons geometry split. */
export const inspectionSaveBalloonCreateItemValidator = z
  .object({
    tempBalloonAnchorId: z.string().min(1),
    label: z.string().min(1),
    xCoordinate: normalizedCoordinateValidator,
    yCoordinate: normalizedCoordinateValidator,
    nominalValue: z.string().nullable().optional(),
    tolerancePlus: z.string().nullable().optional(),
    toleranceMinus: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    type: z.enum(procedureStepType).optional()
  })
  .strict();

/** @deprecated Legacy combined payload. */
export const inspectionSaveBalloonUpdateItemValidator = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    xCoordinate: normalizedCoordinateValidator.optional(),
    yCoordinate: normalizedCoordinateValidator.optional(),
    nominalValue: z.string().nullable().optional(),
    tolerancePlus: z.string().nullable().optional(),
    toleranceMinus: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    type: z.enum(procedureStepType).optional()
  })
  .strict();

/** @deprecated Legacy combined payload. */
export const inspectionSaveBalloonsPayloadValidator = z
  .object({
    create: z.array(inspectionSaveBalloonCreateItemValidator).default([]),
    update: z.array(inspectionSaveBalloonUpdateItemValidator).default([]),
    delete: z.array(z.string().min(1)).default([])
  })
  .strict();

export const inspectionSaveAnchorCreateItemValidator = z
  .object({
    tempId: z.string().min(1),
    pageNumber: pageNumberValidator,
    xCoordinate: normalizedCoordinateValidator,
    yCoordinate: normalizedCoordinateValidator,
    width: normalizedSizeValidator,
    height: normalizedSizeValidator
  })
  .strict();

export const inspectionSaveAnchorUpdateItemValidator = z
  .object({
    id: z.string().min(1),
    pageNumber: pageNumberValidator.optional(),
    xCoordinate: normalizedCoordinateValidator.optional(),
    yCoordinate: normalizedCoordinateValidator.optional(),
    width: normalizedSizeValidator.optional(),
    height: normalizedSizeValidator.optional()
  })
  .strict();

export const inspectionSaveAnchorsPayloadValidator = z
  .object({
    create: z.array(inspectionSaveAnchorCreateItemValidator).default([]),
    update: z.array(inspectionSaveAnchorUpdateItemValidator).default([]),
    delete: z.array(z.string().min(1)).default([])
  })
  .strict();

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
  name: z.string().min(1, { message: "Name is required" })
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
      // inboundInspection, lineId is required
      if (
        ![
          "items",
          "customers",
          "suppliers",
          "trackedEntities",
          "inboundInspections"
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
  name: z.string().min(1, { message: "Name is required" }),
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
  name: z.string().min(1, { message: "Name is required" })
});

export const issueWorkflowValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
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

export const itemQuantityValidator = z.object({
  quantity: zfd.numeric(z.number().min(0))
});

const entityAssignmentItem = z.object({
  trackedEntityId: z.string().min(1, { message: "Tracked entity is required" }),
  quantity: z
    .number({ invalid_type_error: "Quantity is required" })
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
        .number({ invalid_type_error: "Split quantity is required" })
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
  name: z.string().min(1, { message: "Name is required" }),
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
    name: z.string().min(1, { message: "Name is required" }),
    description: zfd.text(z.string().optional()),
    type: z.enum(procedureStepType, {
      errorMap: () => ({ message: "Type is required" })
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
  name: z.string().min(1, { message: "Name is required" }),
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

export const inboundInspectionStatus = [
  "Pending",
  "In Progress",
  "Passed",
  "Failed",
  "Partial"
] as const;

export const inboundInspectionSampleStatus = [
  "Pending",
  "Passed",
  "Failed"
] as const;

export const itemSamplingPlanValidator = z
  .object({
    itemId: z.string().min(1, { message: "Item is required" }),
    type: z.enum(samplingPlanTypes),
    sampleSize: zfd.numeric(z.number().int().positive().optional()),
    percentage: zfd.numeric(z.number().positive().max(100).optional()),
    aql: zfd.numeric(z.number().positive().optional()),
    inspectionLevel: z.enum(inspectionLevels).default("II"),
    severity: z.enum(inspectionSeverities).default("Normal")
  })
  .superRefine((value, ctx) => {
    if (value.type === "First" && !value.sampleSize) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sampleSize"],
        message: "Sample size is required for 'First N' plans"
      });
    }
    if (value.type === "Percentage" && !value.percentage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["percentage"],
        message: "Percentage is required for percentage plans"
      });
    }
    if (value.type === "AQL" && !value.aql) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["aql"],
        message: "AQL is required for AQL plans"
      });
    }
  });

export const inboundInspectionValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  status: z.enum(["Passed", "Failed"], {
    errorMap: () => ({ message: "Status is required" })
  }),
  notes: zfd.text(z.string().optional())
});

export const inboundInspectionSampleValidator = z.object({
  inspectionId: z.string().min(1, { message: "Inspection is required" }),
  trackedEntityId: z.string().min(1, { message: "Tracked entity is required" }),
  status: z.enum(["Passed", "Failed"], {
    errorMap: () => ({ message: "Status is required" })
  }),
  notes: zfd.text(z.string().optional())
});

export const inboundInspectionDispositionValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  decision: z.enum(["Accept", "Reject", "Partial"], {
    errorMap: () => ({ message: "Decision is required" })
  }),
  notes: zfd.text(z.string().optional())
});
