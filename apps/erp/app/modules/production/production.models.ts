import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  methodItemType,
  methodOperationOrders,
  methodType,
  operationTypes,
  procedureAttributeType,
  standardFactorType,
} from "../shared";

export const KPIs = [
  {
    key: "utilization",
    label: "Work Center Utilization",
    emptyMessage: "No work center utilization data within range",
  },
  {
    key: "estimatesVsActuals",
    label: "Estimates vs Actuals",
    emptyMessage: "No completed jobs within range",
  },
  {
    key: "completionTime",
    label: "Completion Time",
    emptyMessage: "No completed jobs within range",
  },
] as const;

export const deadlineTypes = [
  "ASAP",
  "Hard Deadline",
  "Soft Deadline",
  "No Deadline",
] as const;

export const jobStatus = [
  "Draft",
  "Planned",
  "Ready",
  "In Progress",
  "Paused",
  "Completed",
  "Cancelled",
  "Overdue", // deprecated
  "Due Today", // deprecated
] as const;

export const jobOperationStatus = [
  "Todo",
  "Ready",
  "Waiting",
  "In Progress",
  "Paused",
  "Done",
  "Canceled",
] as const;

export const procedureStatus = ["Draft", "Active", "Archived"] as const;

const baseJobValidator = z.object({
  id: zfd.text(z.string().optional()),
  jobId: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item is required" }),
  customerId: zfd.text(z.string().optional()),
  dueDate: zfd.text(z.string().optional()),
  deadlineType: z.enum(deadlineTypes, {
    errorMap: () => ({ message: "Deadline type is required" }),
  }),
  locationId: z.string().min(1, { message: "Location is required" }),
  quantity: zfd.numeric(z.number().min(0)),
  scrapQuantity: zfd.numeric(z.number().min(0)),
  startDate: zfd.text(z.string().optional()),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of measure is required" }),
  modelUploadId: zfd.text(z.string().optional()),
  configuration: z.any().optional(),
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
      errorMap: () => ({ message: "Deadline type is required" }),
    }),
    dueDateOfFirstJob: zfd.text(z.string().optional()),
    dueDateOfLastJob: zfd.text(z.string().optional()),
    locationId: z.string().min(1, { message: "Location is required" }),
    customerId: zfd.text(z.string().optional()),
    modelUploadId: zfd.text(z.string().optional()),
    configuration: z.any().optional(),
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
      path: ["dueDateOfLastJob"],
    }
  )
  .refine(
    (data) => {
      if (["Hard Deadline", "Soft Deadline"].includes(data.deadlineType)) {
        return !!data.dueDateOfFirstJob;
      }
      return true;
    },
    {
      message: "Due date of first job is required for hard and soft deadlines",
      path: ["dueDateOfFirstJob"],
    }
  )
  .refine(
    (data) => {
      if (["Hard Deadline", "Soft Deadline"].includes(data.deadlineType)) {
        return !!data.dueDateOfLastJob;
      }
      return true;
    },
    {
      message: "Due date of last job is required for hard and soft deadlines",
      path: ["dueDateOfLastJob"],
    }
  );

export const jobValidator = baseJobValidator.refine(
  (data) => {
    if (
      ["Hard Deadline", "Soft Deadline"].includes(data.deadlineType) &&
      !data.dueDate
    ) {
      return false;
    }
    return true;
  },
  {
    message: "Due date is required",
    path: ["dueDate"],
  }
);

export const jobCompleteValidator = z.object({
  quantityComplete: zfd.numeric(z.number().min(0)),
  salesOrderId: zfd.text(z.string().optional()),
  salesOrderLineId: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  shelfId: zfd.text(z.string().optional()),
});

export const salesOrderToJobValidator = baseJobValidator
  .extend({
    quoteId: zfd.text(z.string().optional()),
    quoteLineId: zfd.text(z.string().optional()),
    salesOrderId: zfd.text(z.string()),
    salesOrderLineId: zfd.text(z.string()),
  })
  .refine(
    (data) => {
      if (
        ["Hard Deadline", "Soft Deadline"].includes(data.deadlineType) &&
        !data.dueDate
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Due date is required",
      path: ["dueDate"],
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
      message: "Operation order is required",
    }),
  }),
  operationType: z.enum(operationTypes, {
    errorMap: (issue, ctx) => ({
      message: "Operation type is required",
    }),
  }),
  processId: z.string().min(1, { message: "Process is required" }),
  procedureId: zfd.text(z.string().optional()),
  description: zfd.text(
    z.string().min(0, { message: "Description is required" })
  ),
  setupUnit: z
    .enum(standardFactorType, {
      errorMap: () => ({ message: "Setup unit is required" }),
    })
    .optional(),
  setupTime: zfd.numeric(z.number().min(0).optional()),
  laborUnit: z
    .enum(standardFactorType, {
      errorMap: () => ({ message: "Labor unit is required" }),
    })
    .optional(),
  laborTime: zfd.numeric(z.number().min(0).optional()),
  machineUnit: z
    .enum(standardFactorType, {
      errorMap: () => ({ message: "Machine unit is required" }),
    })
    .optional(),
  machineTime: zfd.numeric(z.number().min(0).optional()),
  machineRate: zfd.numeric(z.number().min(0).optional()),
  overheadRate: zfd.numeric(z.number().min(0).optional()),
  laborRate: zfd.numeric(z.number().min(0).optional()),
  operationSupplierProcessId: zfd.text(z.string().optional()),
  operationMinimumCost: zfd.numeric(z.number().min(0).optional()),
  operationUnitCost: zfd.numeric(z.number().min(0).optional()),
  operationLeadTime: zfd.numeric(z.number().min(0).optional()),
});

export const jobOperationValidator = baseJobOperationValidator
  .merge(
    z.object({
      workCenterId: zfd.text(z.string().optional()),
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
      path: ["operationMinimumCost"],
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
      path: ["operationUnitCost"],
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
      path: ["operationLeadTime"],
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
      path: ["setupUnit"],
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
      path: ["laborUnit"],
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
      path: ["machineUnit"],
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
      path: ["setupTime"],
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
      path: ["laborTime"],
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
      path: ["machineTime"],
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
      path: ["machineRate"],
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
      path: ["overheadRate"],
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
      path: ["laborRate"],
    }
  );

export const jobOperationValidatorForReleasedJob = baseJobOperationValidator
  .merge(
    z.object({
      workCenterId: zfd.text(z.string().optional()),
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
      path: ["workCenterId"],
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
      path: ["operationMinimumCost"],
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
      path: ["operationUnitCost"],
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
      path: ["operationLeadTime"],
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
      path: ["operationSupplierProcessId"],
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
      path: ["setupUnit"],
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
      path: ["laborUnit"],
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
      path: ["machineUnit"],
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
      path: ["setupTime"],
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
      path: ["laborTime"],
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
      path: ["machineTime"],
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
      path: ["machineRate"],
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
      path: ["overheadRate"],
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
      path: ["laborRate"],
    }
  );

const baseMaterialValidator = z.object({
  id: zfd.text(z.string().optional()),
  description: z.string().min(1, { message: "Description is required" }),
  jobMakeMethodId: z.string().min(1, { message: "Make method is required" }),
  itemType: z.enum(methodItemType, {
    errorMap: (issue, ctx) => ({
      message: "Item type is required",
    }),
  }),
  methodType: z.enum(methodType, {
    errorMap: (issue, ctx) => ({
      message: "Method type is required",
    }),
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
});

export const jobMaterialValidator = baseMaterialValidator
  .extend({
    jobOperationId: zfd.text(z.string().optional()),
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
      path: ["itemId"],
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
      path: ["itemId"],
    }
  )
  .refine(
    (data) => {
      if (data.itemType === "Tool") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Tool ID is required",
      path: ["itemId"],
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
      path: ["itemId"],
    }
  );

export const jobMaterialValidatorForReleasedJob = baseMaterialValidator
  .extend({
    jobOperationId: z.string().min(1, { message: "Operation is required" }),
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
      path: ["itemId"],
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
      path: ["itemId"],
    }
  )
  .refine(
    (data) => {
      if (data.itemType === "Tool") {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Tool ID is required",
      path: ["itemId"],
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
      path: ["itemId"],
    }
  );

export const getJobMethodValidator = z.object({
  sourceId: z.string().min(1, { message: "Source ID is required" }),
  targetId: z.string().min(1, { message: "Please select a source method" }),
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
  copyFromId: zfd.text(z.string().optional()),
});

export const procedureAttributeValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    procedureId: z.string().min(1, { message: "Procedure is required" }),
    name: z.string().min(1, { message: "Name is required" }),
    description: zfd.text(z.string().optional()),
    type: z.enum(procedureAttributeType, {
      errorMap: () => ({ message: "Type is required" }),
    }),
    unitOfMeasureCode: zfd.text(z.string().optional()),
    minValue: zfd.numeric(z.number().min(0).optional()),
    maxValue: zfd.numeric(z.number().min(0).optional()),
    listValues: z.array(z.string()).optional(),
    sortOrder: zfd.numeric(z.number().min(0).optional()),
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
      path: ["unitOfMeasureCode"],
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
      path: ["listOptions"],
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
      path: ["maxValue"],
    }
  );

export const procedureParameterValidator = z.object({
  id: zfd.text(z.string().optional()),
  procedureId: z.string().min(1, { message: "Procedure is required" }),
  key: z.string().min(1, { message: "Key is required" }),
  value: z.string().min(1, { message: "Value is required" }),
});

export const procedureSyncValidator = z.object({
  operationId: z.string().min(1, { message: "Operation is required" }),
  procedureId: z.string().min(1, { message: "Procedure is required" }),
});

export const productionEventValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    jobOperationId: z.string().min(1, { message: "Operation is required" }),
    type: z.enum(["Labor", "Machine", "Setup"], {
      errorMap: () => ({ message: "Event type is required" }),
    }),
    employeeId: zfd.text(z.string().optional()),
    workCenterId: zfd.text(z.string().optional()),
    startTime: z.string().min(1, { message: "Start time is required" }),
    endTime: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional()),
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
      path: ["endTime"],
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
  isASAP: z.boolean().optional(),
});

export type ProductionOrder = z.infer<typeof productionOrderValidator>;

export const productionQuantityValidator = z.object({
  id: z.string().min(0, { message: "ID is required" }),
  jobOperationId: z.string().min(1, { message: "Operation is required" }),
  type: z.enum(["Rework", "Scrap", "Production"], {
    errorMap: () => ({ message: "Quantity type is required" }),
  }),
  scrapReasonId: zfd.text(z.string().optional()),
  notes: zfd.text(z.string().optional()),
  createdBy: zfd.text(z.string().optional()),
  quantity: zfd.numeric(z.number().min(0)),
});

export const scheduleOperationUpdateValidator = z.object({
  id: z.string().min(1, { message: "ID is required" }),
  columnId: z.string().min(1, { message: "Column is required" }),
  priority: zfd.numeric(z.number().min(0).optional()),
});

export const scrapReasonValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
});

export const demandForecastsValidator = z.object({
  itemId: z.string().min(1, { message: "Item is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  periods: z.array(z.string()).optional(),
  ...Object.fromEntries(
    Array.from({ length: 52 }, (_, i) => [
      `week${i}`,
      zfd.numeric(z.number().min(0).optional()),
    ])
  ),
});
