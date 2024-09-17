import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  methodItemType,
  methodOperationOrders,
  methodType,
  operationTypes,
  standardFactorType,
} from "../shared";

export const deadlineTypes = [
  "ASAP",
  "Hard Deadline",
  "Soft Deadline",
  "No Deadline",
] as const;

export const jobStatus = [
  "Draft",
  "Ready",
  "In Progress",
  "Paused",
  "Completed",
  "Cancelled",
] as const;

export const jobValidator = z
  .object({
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
    unitOfMeasureCode: z
      .string()
      .min(1, { message: "Unit of measure is required" }),
    modelUploadId: zfd.text(z.string().optional()),
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

export const jobOperationValidator = z
  .object({
    id: zfd.text(z.string().optional()),
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
    processId: z.string().min(20, { message: "Process is required" }),
    workCenterId: zfd.text(z.string().optional()),
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
  })
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
export const jobMaterialValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    jobMakeMethodId: z.string().min(20, { message: "Make method is required" }),
    order: zfd.numeric(z.number().min(0)),
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
    itemReadableId: z.string().min(1, { message: "Item ID is required" }),
    description: z.string().min(1, { message: "Description is required" }),
    quoteOperationId: zfd.text(z.string().optional()),
    quantity: zfd.numeric(z.number().min(0)),
    unitCost: zfd.numeric(z.number().min(0)),
    unitOfMeasureCode: z
      .string()
      .min(1, { message: "Unit of Measure is required" }),
  })
  .refine(
    (data) => {
      if (data.itemType === "Part") {
        return !!data.itemReadableId;
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
        return !!data.itemReadableId;
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
      if (data.itemType === "Fixture") {
        return !!data.itemReadableId;
      }
      return true;
    },
    {
      message: "Fixture ID is required",
      path: ["itemId"],
    }
  )
  .refine(
    (data) => {
      if (data.itemType === "Tool") {
        return !!data.itemReadableId;
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
        return !!data.itemReadableId;
      }
      return true;
    },
    {
      message: "Consumable ID is required",
      path: ["itemId"],
    }
  )
  .refine(
    (data) => {
      if (data.itemType === "Service") {
        return !!data.itemReadableId;
      }
      return true;
    },
    {
      message: "Service ID is required",
      path: ["itemId"],
    }
  );

export const getJobMethodValidator = z.object({
  sourceId: z.string().min(1, { message: "Source ID is required" }),
  targetId: z.string().min(1, { message: "Please select a source method" }),
});

export const getJobMaterialMethodValidator = z.object({
  jobMaterialId: z.string().min(1, { message: "Quote Material is required" }),
  itemId: z.string().min(1, { message: "Please select a source method" }),
});
