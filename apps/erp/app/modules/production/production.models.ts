import type { Database } from "@carbon/database";
import { textToTiptap } from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  methodItemType,
  methodOperationOrders,
  methodType,
  operationTypes,
  procedureStepType,
  standardFactorType
} from "../shared";
import type {
  ItemOrderStatus,
  JobOrderStatusCategory,
  JobStatus,
  PurchaseOrderStatus
} from "./types";

export const KPIs = [
  {
    key: "utilization",
    label: "Work Center Utilization",
    emptyMessage: "No work center utilization data within range"
  },
  {
    key: "estimatesVsActuals",
    label: "Estimates vs Actuals",
    emptyMessage: "No completed jobs within range"
  },
  {
    key: "completionTime",
    label: "Completion Time",
    emptyMessage: "No completed jobs within range"
  }
] as const;

export const deadlineTypes = [
  "ASAP",
  "Hard Deadline",
  "Soft Deadline",
  "No Deadline"
] as const;

// A due date only applies to the two dated deadline types; ASAP / No Deadline
// ignore it. Single source for both the validators below and the job form UI.
export function deadlineRequiresDueDate(
  deadlineType: string | null | undefined
): boolean {
  return deadlineType === "Hard Deadline" || deadlineType === "Soft Deadline";
}

export const jobStatus = [
  "Draft",
  "Planned",
  "Ready",
  "In Progress",
  "Paused",
  "Completed",
  "Closed",
  "Cancelled",
  "Overdue", // deprecated
  "Due Today" // deprecated
] as const;

export const JOB_LOCKED_STATUSES = [
  "Completed",
  "Closed",
  "Cancelled"
] as const;

export function isJobLocked(status: string | null | undefined): boolean {
  return JOB_LOCKED_STATUSES.includes(
    status as (typeof JOB_LOCKED_STATUSES)[number]
  );
}

/**
 * A Queued assemblyPlanJob older than this never got picked up by the worker
 * (pickup normally takes seconds) — treat it as dead rather than blocking the
 * UI and re-runs forever. Processing rows are alive regardless of age: large
 * models legitimately plan for many minutes, and the worker's onFailure flips
 * them to Failed.
 */
const ASSEMBLY_PLAN_QUEUED_STALE_MS = 2 * 60 * 1000;
// A Processing row with no live worker behind it (worker crash, or the dev
// Inngest server — which keeps runs in memory — restarting mid-run) would
// otherwise read as "running" forever: the UI spins and the re-run guard
// blocks recovery. The worker's own budget is ~30 min of waiting plus
// retries, so anything past this is an orphan.
const ASSEMBLY_PLAN_PROCESSING_STALE_MS = 45 * 60 * 1000;

/** Whether a motion-planning run is live (drives badges, polling, re-run guards). */
export function isAssemblyPlanRunning(
  job: { status: string; createdAt: string } | null | undefined
): boolean {
  if (!job) return false;
  const age = Date.now() - new Date(job.createdAt).getTime();
  if (job.status === "Processing") {
    return age < ASSEMBLY_PLAN_PROCESSING_STALE_MS;
  }
  return job.status === "Queued" && age < ASSEMBLY_PLAN_QUEUED_STALE_MS;
}

export const jobOperationStatus = [
  "Todo",
  "Ready",
  "Waiting",
  "In Progress",
  "Paused",
  "Done",
  "Canceled"
] as const;

export const maintenanceDispatchPriority = [
  "Low",
  "Medium",
  "High",
  "Critical"
] as const;

export const maintenanceDispatchStatus = [
  "Open",
  "Assigned",
  "In Progress",
  "Completed",
  "Cancelled"
] as const;

export const maintenanceFrequency = [
  "Daily",
  "Weekly",
  "Monthly",
  "Quarterly",
  "Annual"
] as const;

export const maintenanceSeverity = [
  "Preventive",
  "Operator Performed",
  "Support Required",
  "OEM Required"
] as const;

export const maintenanceSource = [
  "Scheduled",
  "Reactive",
  "Non-Conformance"
] as const;

export const oeeImpact = ["Down", "Planned", "Impact", "No Impact"] as const;

export const procedureStatus = ["Draft", "Active", "Archived"] as const;

const baseJobValidator = z.object({
  id: zfd.text(z.string().optional()),
  jobId: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item is required" }),
  customerId: zfd.text(z.string().optional()),
  dueDate: zfd.text(z.string().optional()),
  deadlineType: z.enum(deadlineTypes, {
    errorMap: () => ({ message: "Deadline type is required" })
  }),
  locationId: z.string().min(1, { message: "Location is required" }),
  quantity: zfd.numeric(z.number().min(0)),
  scrapQuantity: zfd.numeric(z.number().min(0)),
  startDate: zfd.text(z.string().optional()),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of measure is required" }),
  modelUploadId: zfd.text(z.string().optional()),
  configuration: z.any().optional()
});

export const bulkJobValidator = z
  .object({
    itemId: z.string().min(1, { message: "Item is required" }),
    totalQuantity: zfd.numeric(z.number().min(0)),
    quantityPerJob: zfd.numeric(z.number().min(0)),
    scrapQuantityPerJob: zfd.numeric(z.number().min(0)),
    unitOfMeasureCode: z
      .string()
      .min(1, { message: "Unit of measure is required" }),
    deadlineType: z.enum(deadlineTypes, {
      errorMap: () => ({ message: "Deadline type is required" })
    }),
    dueDateOfFirstJob: zfd.text(z.string().optional()),
    dueDateOfLastJob: zfd.text(z.string().optional()),
    locationId: z.string().min(1, { message: "Location is required" }),
    customerId: zfd.text(z.string().optional()),
    modelUploadId: zfd.text(z.string().optional()),
    configuration: z.any().optional()
  })
  .refine(
    (data) => {
      if (data.dueDateOfFirstJob && data.dueDateOfLastJob) {
        return data.dueDateOfFirstJob <= data.dueDateOfLastJob;
      }
      return true;
    },
    {
      message: "Due date of first job must be before due date of last job",
      path: ["dueDateOfLastJob"]
    }
  )
  .refine(
    (data) => {
      if (deadlineRequiresDueDate(data.deadlineType)) {
        return !!data.dueDateOfFirstJob;
      }
      return true;
    },
    {
      message: "Due date of first job is required for hard and soft deadlines",
      path: ["dueDateOfFirstJob"]
    }
  )
  .refine(
    (data) => {
      if (deadlineRequiresDueDate(data.deadlineType)) {
        return !!data.dueDateOfLastJob;
      }
      return true;
    },
    {
      message: "Due date of last job is required for hard and soft deadlines",
      path: ["dueDateOfLastJob"]
    }
  );

export const jobValidator = baseJobValidator.refine(
  (data) => {
    if (deadlineRequiresDueDate(data.deadlineType) && !data.dueDate) {
      return false;
    }
    return true;
  },
  {
    message: "Due date is required",
    path: ["dueDate"]
  }
);

export const leftoverAction = ["ship", "receive", "split", "discard"] as const;
export type LeftoverAction = (typeof leftoverAction)[number];

export const jobCompleteValidator = z.object({
  quantityComplete: zfd.numeric(z.number().min(0)),
  salesOrderId: zfd.text(z.string().optional()),
  salesOrderLineId: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  storageUnitId: zfd.text(z.string().optional()),
  // Leftover handling fields - for when quantityComplete > job.quantity
  leftoverAction: zfd.text(z.enum(leftoverAction).optional()),
  leftoverShipQuantity: zfd.numeric(z.number().min(0).optional()),
  leftoverReceiveQuantity: zfd.numeric(z.number().min(0).optional())
});

export const salesOrderToJobValidator = baseJobValidator
  .extend({
    quoteId: zfd.text(z.string().optional()),
    quoteLineId: zfd.text(z.string().optional()),
    salesOrderId: zfd.text(z.string()),
    salesOrderLineId: zfd.text(z.string())
  })
  .refine(
    (data) => {
      if (deadlineRequiresDueDate(data.deadlineType) && !data.dueDate) {
        return false;
      }
      return true;
    },
    {
      message: "Due date is required",
      path: ["dueDate"]
    }
  );

export const baseJobOperationValidator = z.object({
  id: z.string().min(1, { message: "Operation ID is required" }),
  jobMakeMethodId: z
    .string()
    .min(1, { message: "Quote Make Method is required" }),
  order: zfd.numeric(z.number().min(0)),
  operationOrder: z.enum(methodOperationOrders, {
    errorMap: (issue, ctx) => ({
      message: "Operation order is required"
    })
  }),
  operationType: z.enum(operationTypes, {
    errorMap: (issue, ctx) => ({
      message: "Operation type is required"
    })
  }),
  processId: z.string().min(1, { message: "Process is required" }),
  procedureId: zfd.text(z.string().optional()),
  description: zfd.text(
    z.string().min(0, { message: "Description is required" })
  ),
  setupUnit: z
    .enum(standardFactorType, {
      errorMap: () => ({ message: "Setup unit is required" })
    })
    .optional(),
  setupTime: zfd.numeric(z.number().min(0).optional()),
  laborUnit: z
    .enum(standardFactorType, {
      errorMap: () => ({ message: "Labor unit is required" })
    })
    .optional(),
  laborTime: zfd.numeric(z.number().min(0).optional()),
  machineUnit: z
    .enum(standardFactorType, {
      errorMap: () => ({ message: "Machine unit is required" })
    })
    .optional(),
  machineTime: zfd.numeric(z.number().min(0).optional()),
  machineRate: zfd.numeric(z.number().min(0).optional()),
  overheadRate: zfd.numeric(z.number().min(0).optional()),
  laborRate: zfd.numeric(z.number().min(0).optional()),
  operationSupplierProcessId: zfd.text(z.string().optional()),
  operationMinimumCost: zfd.numeric(z.number().min(0).optional()),
  operationUnitCost: zfd.numeric(z.number().min(0).optional()),
  operationLeadTime: zfd.numeric(z.number().min(0).optional())
});

export const jobOperationValidator = baseJobOperationValidator
  .merge(
    z.object({
      workCenterId: zfd.text(z.string().optional())
    })
  )
  .refine(
    (data) => {
      if (data.operationType === "Outside") {
        return Number.isFinite(data.operationMinimumCost);
      }
      return true;
    },
    {
      message: "Minimum is required",
      path: ["operationMinimumCost"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Outside") {
        return Number.isFinite(data.operationUnitCost);
      }
      return true;
    },
    {
      message: "Unit cost is required",
      path: ["operationUnitCost"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Outside") {
        return Number.isFinite(data.operationLeadTime);
      }
      return true;
    },
    {
      message: "Lead time is required",
      path: ["operationLeadTime"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return !!data.setupUnit;
      }
      return true;
    },
    {
      message: "Setup unit is required",
      path: ["setupUnit"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return !!data.laborUnit;
      }
      return true;
    },
    {
      message: "Labor unit is required",
      path: ["laborUnit"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return !!data.laborUnit;
      }
      return true;
    },
    {
      message: "Machine unit is required",
      path: ["machineUnit"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.setupTime);
      }
      return true;
    },
    {
      message: "Setup time is required",
      path: ["setupTime"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.laborTime);
      }
      return true;
    },
    {
      message: "Labor time is required",
      path: ["laborTime"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.machineTime);
      }
      return true;
    },
    {
      message: "Machine time is required",
      path: ["machineTime"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.machineRate);
      }
      return true;
    },
    {
      message: "Machine rate is required",
      path: ["machineRate"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.overheadRate);
      }
      return true;
    },
    {
      message: "Overhead rate is required",
      path: ["overheadRate"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.laborRate);
      }
      return true;
    },
    {
      message: "Labor rate is required",
      path: ["laborRate"]
    }
  );

export const jobOperationValidatorForReleasedJob = baseJobOperationValidator
  .merge(
    z.object({
      workCenterId: zfd.text(z.string().optional())
    })
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return !!data.workCenterId;
      }
      return true;
    },
    {
      message: "Work center is required",
      path: ["workCenterId"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Outside") {
        return Number.isFinite(data.operationMinimumCost);
      }
      return true;
    },
    {
      message: "Minimum is required",
      path: ["operationMinimumCost"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Outside") {
        return Number.isFinite(data.operationUnitCost);
      }
      return true;
    },
    {
      message: "Unit cost is required",
      path: ["operationUnitCost"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Outside") {
        return Number.isFinite(data.operationLeadTime);
      }
      return true;
    },
    {
      message: "Lead time is required",
      path: ["operationLeadTime"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Outside") {
        return !!data.operationSupplierProcessId;
      }
      return true;
    },
    {
      message: "Supplier is required",
      path: ["operationSupplierProcessId"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return !!data.setupUnit;
      }
      return true;
    },
    {
      message: "Setup unit is required",
      path: ["setupUnit"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return !!data.laborUnit;
      }
      return true;
    },
    {
      message: "Labor unit is required",
      path: ["laborUnit"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return !!data.laborUnit;
      }
      return true;
    },
    {
      message: "Machine unit is required",
      path: ["machineUnit"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.setupTime);
      }
      return true;
    },
    {
      message: "Setup time is required",
      path: ["setupTime"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.laborTime);
      }
      return true;
    },
    {
      message: "Labor time is required",
      path: ["laborTime"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.machineTime);
      }
      return true;
    },
    {
      message: "Machine time is required",
      path: ["machineTime"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.machineRate);
      }
      return true;
    },
    {
      message: "Machine rate is required",
      path: ["machineRate"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.overheadRate);
      }
      return true;
    },
    {
      message: "Overhead rate is required",
      path: ["overheadRate"]
    }
  )
  .refine(
    (data) => {
      if (data.operationType === "Inside") {
        return Number.isFinite(data.laborRate);
      }
      return true;
    },
    {
      message: "Labor rate is required",
      path: ["laborRate"]
    }
  );

const baseMaterialValidator = z.object({
  id: z.string().min(1, { message: "Material ID is required" }),
  description: z.string().min(1, { message: "Description is required" }),
  jobMakeMethodId: z.string().min(1, { message: "Make method is required" }),
  itemType: z.enum(methodItemType, {
    errorMap: (issue, ctx) => ({
      message: "Item type is required"
    })
  }),
  methodType: z.enum(methodType, {
    errorMap: (issue, ctx) => ({
      message: "Method type is required"
    })
  }),
  itemId: z.string().min(1, { message: "Item is required" }),
  kit: zfd.text(z.string().optional()).transform((value) => value === "true"),
  order: zfd.numeric(z.number().min(0)),
  quantity: zfd.numeric(z.number().min(0)),
  requiresBatchTracking: zfd.text(
    z.string().transform((val) => val === "true")
  ),
  requiresSerialTracking: zfd.text(
    z.string().transform((val) => val === "true")
  ),
  unitCost: zfd.numeric(z.number().min(0)),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of Measure is required" }),
  storageUnitId: zfd.text(z.string().optional())
});

export const jobMaterialValidator = baseMaterialValidator
  .extend({
    jobOperationId: zfd.text(z.string().optional())
  })
  .refine(
    (data) => {
      if (data.itemType === "Part") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Part ID is required",
      path: ["itemId"]
    }
  )
  .refine(
    (data) => {
      if (data.itemType === "Material") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Material ID is required",
      path: ["itemId"]
    }
  )
  .refine(
    (data) => {
      if (data.itemType === "Consumable") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Consumable ID is required",
      path: ["itemId"]
    }
  );

export const jobMaterialValidatorForReleasedJob = baseMaterialValidator
  .extend({
    jobOperationId: z.string().min(1, { message: "Operation is required" })
  })
  .refine(
    (data) => {
      if (data.itemType === "Part") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Part ID is required",
      path: ["itemId"]
    }
  )
  .refine(
    (data) => {
      if (data.itemType === "Material") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Material ID is required",
      path: ["itemId"]
    }
  )
  .refine(
    (data) => {
      if (data.itemType === "Consumable") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Consumable ID is required",
      path: ["itemId"]
    }
  );

export const getJobMethodValidator = z.object({
  sourceId: z.string().min(1, { message: "Source ID is required" }),
  targetId: z.string().min(1, { message: "Please select a source method" }),
  billOfMaterial: zfd.checkbox(),
  billOfProcess: zfd.checkbox(),
  parameters: zfd.checkbox(),
  tools: zfd.checkbox(),
  steps: zfd.checkbox(),
  workInstructions: zfd.checkbox()
});

// export const getJobMaterialMethodValidator = z.object({
//   jobMaterialId: z.string().min(1, { message: "Quote Material is required" }),
//   itemId: z.string().min(1, { message: "Please select a source method" }),
// });

export const procedureValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  version: zfd.numeric(z.number().min(0)),
  processId: zfd.text(z.string().optional()),
  content: zfd.text(z.string().optional()),
  copyFromId: zfd.text(z.string().optional())
});

export const procedureStepValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    procedureId: z.string().min(1, { message: "Procedure is required" }),
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

export const procedureParameterValidator = z.object({
  id: zfd.text(z.string().optional()),
  procedureId: z.string().min(1, { message: "Procedure is required" }),
  key: z.string().min(1, { message: "Key is required" }),
  value: z.string().min(1, { message: "Value is required" })
});

export const procedureSyncValidator = z.object({
  operationId: z.string().min(1, { message: "Operation is required" }),
  procedureId: z.string().min(1, { message: "Procedure is required" })
});

export const productionEventValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    jobOperationId: z.string().min(1, { message: "Operation is required" }),
    type: z.enum(["Labor", "Machine", "Setup"], {
      errorMap: () => ({ message: "Event type is required" })
    }),
    employeeId: zfd.text(z.string().optional()),
    workCenterId: zfd.text(z.string().optional()),
    startTime: z.string().min(1, { message: "Start time is required" }),
    endTime: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  })
  .refine(
    (data) => {
      if (data.endTime) {
        return new Date(data.startTime) < new Date(data.endTime);
      }
      return true;
    },
    {
      message: "Start time must be before end time",
      path: ["endTime"]
    }
  );

export const productionOrderValidator = z.object({
  startDate: zfd.text(z.string().nullable()),
  dueDate: zfd.text(z.string().nullable()),
  periodId: z.string().min(1, { message: "Period is required" }),
  quantity: zfd.numeric(z.number().min(0)),
  existingId: zfd.text(z.string().optional()),
  existingQuantity: zfd.numeric(z.number().optional()),
  existingReadableId: zfd.text(z.string().optional()),
  existingStatus: zfd.text(z.string().optional()),
  isASAP: z.boolean().optional()
});

export type ProductionOrder = z.infer<typeof productionOrderValidator>;

export const productionQuantityValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    jobOperationId: z.string().min(1, { message: "Operation is required" }),
    type: z.enum(["Rework", "Scrap", "Production"], {
      errorMap: () => ({ message: "Quantity type is required" })
    }),
    scrapReasonId: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional()),
    createdBy: zfd.text(z.string().optional()),
    quantity: zfd.numeric(z.number().min(0))
  })
  .refine((data) => data.type !== "Scrap" || !!data.scrapReasonId, {
    message: "Scrap reason is required",
    path: ["scrapReasonId"]
  });

export const scheduleOperationUpdateValidator = z.object({
  id: z.string().min(1, { message: "ID is required" }),
  columnId: z.string().min(1, { message: "Column is required" }),
  priority: zfd.numeric(z.number().min(0).optional())
});

export const scheduleJobUpdateValidator = z.object({
  id: z.string().min(1, { message: "ID is required" }),
  columnId: z.string().min(1, { message: "Column is required" }),
  priority: zfd.numeric(z.number().min(0).optional())
});

export const scrapReasonValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});

export const failureModeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});

export const maintenanceDispatchValidator = z.object({
  id: zfd.text(z.string().optional()),
  status: z.enum(maintenanceDispatchStatus),
  priority: z.enum(maintenanceDispatchPriority),
  severity: z.enum(maintenanceSeverity).optional(),
  source: z.enum(maintenanceSource).optional(),
  oeeImpact: z.enum(oeeImpact).optional(),
  workCenterId: zfd.text(z.string().optional()),
  suspectedFailureModeId: zfd.text(z.string().optional()),
  plannedStartTime: zfd.text(z.string().optional()),
  plannedEndTime: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional()),
  content: zfd.text(z.string().optional())
});

export const maintenanceDispatchCommentValidator = z.object({
  id: zfd.text(z.string().optional()),
  maintenanceDispatchId: z.string().min(1, { message: "Dispatch is required" }),
  comment: z.string().min(1, { message: "Comment is required" })
});

export const maintenanceDispatchEventValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    maintenanceDispatchId: z
      .string()
      .min(1, { message: "Dispatch is required" }),
    employeeId: z.string().min(1, { message: "Employee is required" }),
    workCenterId: z.string().min(1, { message: "Work center is required" }),
    startTime: z.string().min(1, { message: "Start time is required" }),
    endTime: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  })
  .refine(
    (data) => {
      if (data.endTime) {
        return new Date(data.startTime) < new Date(data.endTime);
      }
      return true;
    },
    {
      message: "Start time must be before end time",
      path: ["endTime"]
    }
  );

export const maintenanceDispatchItemValidator = z.object({
  id: zfd.text(z.string().optional()),
  maintenanceDispatchId: z.string().min(1, { message: "Dispatch is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  quantity: zfd.numeric(z.number().min(1)),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of measure is required" }),
  unitCost: zfd.numeric(z.number().min(0).optional())
});

export const maintenanceDispatchWorkCenterValidator = z.object({
  id: zfd.text(z.string().optional()),
  maintenanceDispatchId: z.string().min(1, { message: "Dispatch is required" }),
  workCenterId: z.string().min(1, { message: "Work center is required" })
});

export const maintenanceScheduleValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: zfd.text(z.string().optional()),
  workCenterId: z.string().min(1, { message: "Work center is required" }),
  frequency: z.enum(maintenanceFrequency),
  priority: z.enum(maintenanceDispatchPriority),
  estimatedDuration: zfd.numeric(z.number().optional()),
  active: zfd.checkbox()
});

export const maintenanceScheduleItemValidator = z.object({
  id: zfd.text(z.string().optional()),
  maintenanceScheduleId: z.string().min(1, { message: "Schedule is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  quantity: zfd.numeric(z.number().min(1)),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of measure is required" })
});

export const demandProjectionValidator = z.object({
  itemId: z.string().min(1, { message: "Item is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  periods: z.array(z.string()).optional(),
  ...Object.fromEntries(
    Array.from({ length: 52 }, (_, i) => [
      `week${i}`,
      zfd.numeric(z.number().min(0).optional())
    ])
  )
});

// --- Assembly Instructions ---------------------------------------------

export const assemblyInstructionStatuses = [
  "Draft",
  "Published",
  "Archived"
] as const;

export const planConfidences = ["high", "low", "manual"] as const;

export const assemblyStepStatuses = ["Todo", "Review", "Done"] as const;

export const assemblyRequirementTypes = [
  "Tool",
  "Fixture",
  "Consumable",
  "Note",
  "Media"
] as const;

export const assemblyNoteSeverities = ["Info", "Caution", "Warning"] as const;

const vector3 = z.tuple([z.number(), z.number(), z.number()]);
const quaternion = z.tuple([z.number(), z.number(), z.number(), z.number()]);

/**
 * Insertion motion of a step's parts. See
 * docs/specs/animated-work-instructions-contracts.md §4.
 */
export const motionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("linear"),
    direction: vector3,
    distance: z.number().positive()
  }),
  z.object({
    type: z.literal("L"),
    // 2+ segments: the tier-3 escape planner emits up to 3 (e.g. slide out
    // of a blind slot, lift, exit); the viewer interpolates any count
    segments: z
      .array(
        z.object({
          direction: vector3,
          distance: z.number().positive()
        })
      )
      .min(2)
  }),
  z.object({
    type: z.literal("helix"),
    axis: vector3,
    origin: vector3,
    pitch: z.number().positive(),
    turns: z.number().positive(),
    approach: z.number().nonnegative()
  }),
  z.object({
    type: z.literal("path"),
    keyframes: z
      .array(
        z.object({
          t: z.number().min(0).max(1),
          position: vector3,
          quaternion
        })
      )
      .min(2)
  }),
  z.object({ type: z.literal("none") })
]);

// A step camera is either a manual "Set view" pose (applied verbatim) or a
// planner-baked view-direction hint (mesh-precise sight lines; the viewer
// derives target/distance/frustum fit live at the real viewport aspect).
export const cameraSchema = z.union([
  z.object({
    position: vector3,
    target: vector3,
    fov: z.number().positive()
  }),
  z.object({
    source: z.literal("plan"),
    direction: vector3
  })
]);

export const fastenerSchema = z.object({
  spec: z.string().optional(),
  count: z.number().int().positive().optional(),
  torqueNm: z.number().positive().optional(),
  tool: z.string().optional()
});

/**
 * Planner flags persisted on assemblyInstructionStep.warnings (jsonb).
 * `flagged` marks steps whose parts have no proven collision-free path —
 * the viewer fades them in at the seated pose instead of animating a
 * fabricated motion. `blockedBy` records the obstructing nodeIds from
 * plan.json so the editor can name the blockers.
 */
export const stepPlanWarningsSchema = z.object({
  flagged: z.boolean().optional(),
  blockedBy: z.array(z.string()).optional(),
  /**
   * A part in this step will tip once placed (its center of mass falls outside
   * the support polygon of the parts below it) — likely needs a fixture or a
   * second hand. Diagnostic only; never blocks generation or playback.
   */
  needsSupport: z.boolean().optional()
});

const jsonField = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((raw) => {
    if (typeof raw !== "string") return raw;
    if (raw.trim() === "") return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }, schema);

export const assemblyInstructionValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  modelUploadId: z.string().min(1, { message: "Model is required" }),
  itemId: zfd.text(z.string().optional())
});

export type AssemblyModelState =
  | "converted" // GLB + graph artifacts exist — ready for the viewer
  | "processing" // conversion job is queued or running
  | "failed" // last conversion failed — retriable
  | "convertible" // STEP file present but never converted (lazy conversion)
  | "none"; // no model, or a format the geometry service can't convert

export function getAssemblyModelState(
  model: {
    modelPath: string | null;
    processingStatus: Database["public"]["Enums"]["modelProcessingStatus"];
    glbPath: string | null;
    graphPath: string | null;
  } | null
): AssemblyModelState {
  if (!model) return "none";
  if (
    model.processingStatus === "Success" &&
    model.glbPath &&
    model.graphPath
  ) {
    return "converted";
  }
  const isStep = [".step", ".stp"].some((ext) =>
    (model.modelPath ?? "").toLowerCase().endsWith(ext)
  );
  if (!isStep) return "none";
  if (
    model.processingStatus === "Queued" ||
    model.processingStatus === "Processing"
  ) {
    return "processing";
  }
  if (model.processingStatus === "Failed") return "failed";
  return "convertible";
}

/**
 * Creating an instruction starts from a made item; the instruction name and
 * model are derived server-side (the name from the item, the model from the
 * item's CAD files, converted lazily if needed). An explicit modelUploadId
 * (e.g. from the part details page) takes precedence.
 */
export const assemblyInstructionFromItemValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item is required" }),
  modelUploadId: zfd.text(z.string().optional())
});

export const assemblyInstructionStatusValidator = z.object({
  status: z.enum(assemblyInstructionStatuses)
});

/**
 * Optional tiptap-doc transform: same coercion as the shared
 * operationStepValidator description, but optional because "Add Step" posts
 * only assemblyInstructionId + motion. Returns `any` for the same reason —
 * the doc is consumed both as a DB Json value and as editor JSONContent.
 */
const optionalTiptapDescription = zfd
  .text(z.string().optional())
  .transform((val): any => {
    if (val === undefined || val === "") return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(val);
    } catch {
      parsed = val;
    }
    // Always store a tiptap doc object, never a scalar string (jsonb scalar
    // strings break method copies) and never silently drop content to {}.
    if (typeof parsed === "string") return textToTiptap(parsed);
    if (parsed && typeof parsed === "object") return parsed;
    return textToTiptap(String(val));
  });

export const assemblyInstructionStepValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    assemblyInstructionId: z.string().min(1),
    title: zfd.text(z.string().optional()),
    // Typed-step fields mirror jobOperationStep so steps can eventually be
    // copied into job operations
    type: zfd.text(z.enum(procedureStepType).optional()),
    description: optionalTiptapDescription,
    required: zfd.checkbox(),
    unitOfMeasureCode: zfd.text(z.string().optional()),
    minValue: zfd.numeric(z.number().min(0).optional()),
    maxValue: zfd.numeric(z.number().min(0).optional()),
    listValues: z.array(z.string()).optional(),
    componentNodeIds: jsonField(z.array(z.string()).optional()),
    motion: jsonField(motionSchema.optional()),
    camera: jsonField(cameraSchema.nullable().optional()),
    fastener: jsonField(fastenerSchema.nullable().optional()),
    durationSeconds: zfd.numeric(z.number().positive().optional())
  })
  .superRefine((data, ctx) => {
    if (data.type === "Measurement" && !data.unitOfMeasureCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unitOfMeasureCode"],
        message: "Unit of measure is required"
      });
    }
    if (
      data.type === "List" &&
      !(
        Array.isArray(data.listValues) &&
        data.listValues.length > 0 &&
        data.listValues.every((option) => option.trim() !== "")
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["listValues"],
        message: "List options are required"
      });
    }
    if (
      data.minValue != null &&
      data.maxValue != null &&
      data.maxValue < data.minValue
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxValue"],
        message: "Maximum value must be greater than or equal to minimum value"
      });
    }
  });

/**
 * Partial update for a step's viewer-authored motion path and/or camera pose,
 * saved directly from the 3D editor (drag autosave, "Set view" button) without
 * round-tripping the whole step form. `camera: null` clears it (auto-frame).
 */
export const assemblyInstructionStepMotionValidator = z.object({
  motion: jsonField(motionSchema.optional()),
  camera: jsonField(cameraSchema.nullable().optional())
});

/**
 * Partial update for a step's assigned components, saved directly from the
 * Details panel's Add/remove controls without round-tripping the whole step
 * form. An empty array is valid — a process-only step with no components.
 */
export const assemblyInstructionStepComponentsValidator = z.object({
  componentNodeIds: jsonField(z.array(z.string()))
});

export const assemblyStepComponentsReassignValidator = z
  .object({
    // Absent for "remove" (unassign from every step); required otherwise.
    targetStepId: z.string().optional(),
    componentNodeIds: jsonField(z.array(z.string()).min(1)),
    mode: z.enum(["move", "duplicate", "remove"])
  })
  .refine((v) => v.mode === "remove" || !!v.targetStepId, {
    message: "A target step is required",
    path: ["targetStepId"]
  });

export const assemblyInstructionStepStatusValidator = z.object({
  status: z.enum(assemblyStepStatuses)
});

export const assemblyInstructionStepOrderValidator = z.object({
  updates: z
    .array(
      z.object({
        id: z.string().min(1),
        sortOrder: z.number()
      })
    )
    .min(1)
});

/**
 * Bill-of-material parts consumed at a step. Stores itemId (not a
 * methodMaterial FK) so associations survive make-method re-versioning; the
 * UI picker is limited to items on the instruction item's make-method BOM.
 */
export const assemblyStepMaterialValidator = z.object({
  id: zfd.text(z.string().optional()),
  stepId: z.string().min(1),
  itemId: z.string().min(1, { message: "Item is required" }),
  quantity: zfd.numeric(z.number().min(0).optional()),
  sortOrder: zfd.numeric(z.number().min(0).optional())
});

export const assemblyStepRequirementValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    stepId: z.string().min(1),
    type: z.enum(assemblyRequirementTypes),
    itemId: zfd.text(z.string().optional()),
    name: zfd.text(z.string().optional()),
    text: zfd.text(z.string().optional()),
    severity: zfd.text(z.enum(assemblyNoteSeverities).optional()),
    filePath: zfd.text(z.string().optional()),
    quantity: zfd.numeric(z.number().int().positive().optional())
  })
  .superRefine((data, ctx) => {
    if (data.type === "Note" && !data.text?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "Note text is required"
      });
    }
    if (data.type === "Media" && !data.filePath?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filePath"],
        message: "A file is required"
      });
    }
    if (
      ["Tool", "Fixture", "Consumable"].includes(data.type) &&
      !data.itemId?.trim() &&
      !data.name?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: "Pick a catalog item or enter a name"
      });
    }
  });

export const assemblyStandardNoteValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  content: z.string().min(1, { message: "Content is required" }),
  severity: z.enum(assemblyNoteSeverities)
});

// An assembly unit: model leaf nodes the planner treats as one rigid body — a
// user override on the automatic BOM-driven derivation. Scoped to the model
// upload so it survives instruction delete/recreate (like component mappings).
export const assemblyUnitValidator = z.object({
  id: zfd.text(z.string().optional()),
  modelUploadId: z.string().min(1),
  name: z.string().min(1, { message: "Name is required" }),
  componentNodeIds: jsonField(z.array(z.string()).min(1)),
  itemId: zfd.text(z.string().optional())
});

export type Motion = z.infer<typeof motionSchema>;
export type CameraPose = z.infer<typeof cameraSchema>;
export type Fastener = z.infer<typeof fastenerSchema>;

// Must match the demand window in get_job_quantity_on_hand and the scheduling
// sequence.
export const ACTIVE_JOB_STATUSES: Database["public"]["Enums"]["jobStatus"][] = [
  "Planned",
  "Ready",
  "In Progress",
  "Paused"
];

// Explicit list, not the complement of ACTIVE_JOB_STATUSES — active-but-late
// states like Overdue still surface indicators.
const JOB_STATUSES_WITHOUT_ORDER_STATUS = [
  "Draft",
  "Completed",
  "Cancelled",
  "Closed"
];

export function isJobOrderStatusHidden(
  jobStatus: string | null | undefined
): boolean {
  return !!jobStatus && JOB_STATUSES_WITHOUT_ORDER_STATUS.includes(jobStatus);
}

// Highest priority first. Draft, cancelled, closed and rejected are
// intentionally excluded — a dead PO isn't a real order.
export const PO_STATUS_PRIORITY: PurchaseOrderStatus[] = [
  "To Receive",
  "To Receive and Invoice",
  "Needs Approval",
  "To Review",
  "Planned",
  "To Invoice",
  "Completed"
];

// Highest priority first — picks the representative supply-job status when an
// item is produced by more than one active job. In-flight states outrank merely
// planned ones, mirroring PO_STATUS_PRIORITY.
export const JOB_SUPPLY_STATUS_PRIORITY: JobStatus[] = [
  "In Progress",
  "Paused",
  "Ready",
  "Planned"
];

// The single source of truth for order-status precedence. Both the status filter
// and JobOrderStatusBadge derive from this (the badge maps each category to its
// icon/label), so they can never disagree. Order of the checks below IS the
// precedence — keep the highest-priority indicator first.
export function getJobOrderStatusCategory(
  status: ItemOrderStatus | undefined
): JobOrderStatusCategory | null {
  // Already pulled into the job — procurement is moot, so this outranks all
  // other indicators (and hides any stale PO still attached to the item).
  if (status?.isIssued) return "issued";

  // A still-unmet, priority-adjusted shortfall outranks the supply indicators —
  // see JobOrderStatusBadge for why.
  if (status?.needsOrder) return "needsOrder";

  // Made-to-order with no job producing it yet — the make-side of needsOrder.
  if (status?.needsJob) return "needsJob";

  if (status?.coveredByOnHand) return "inStock";

  switch (status?.status) {
    case "Planned":
      return "planned";
    case "Needs Approval":
    case "To Review":
      return "awaitingApproval";
    case "To Receive":
    case "To Receive and Invoice": {
      const fraction =
        status.ordered > 0 ? status.received / status.ordered : 0;
      if (fraction < 1) {
        return status.received > 0 ? "received" : "onOrder";
      }
      break;
    }
  }

  if (status?.supplyJobStatus) return "plannedJob";
  return null;
}
