import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  methodItemType,
  methodOperationOrders,
  methodType,
  operationTypes,
  standardFactorType,
} from "../shared";

export const batchPropertyDataTypes = [
  "text",
  "numeric",
  "boolean",
  "list",
  "date",
] as const;

export const configurationParameterDataTypes = [
  "text",
  "numeric",
  "boolean",
  "list",
] as const;

export const itemTrackingTypes = [
  "Inventory",
  "Non-Inventory",
  "Serial",
  "Batch",
] as const;

export const itemCostingMethods = [
  "Standard",
  "Average",
  "FIFO",
  "LIFO",
] as const;

export const itemReorderingPolicies = [
  "Manual Reorder",
  "Demand-Based Reorder",
  "Fixed Reorder Quantity",
  "Maximum Quantity",
] as const;

export const itemReplenishmentSystems = [
  "Buy",
  "Make",
  "Buy and Make",
] as const;

export const partManufacturingPolicies = [
  "Make to Stock",
  "Make to Order",
] as const;

export const serviceType = ["Internal", "External"] as const;

export const itemValidator = z.object({
  id: z.string().min(1, { message: "Item ID is required" }).max(255),
  readableId: zfd.text(z.string().optional()),
  name: z
    .string()
    .min(1, { message: "Short description is required" })
    .max(255),
  description: zfd.text(z.string().optional()),
  replenishmentSystem: z.enum(itemReplenishmentSystems, {
    errorMap: (issue, ctx) => ({
      message: "Replenishment system is required",
    }),
  }),
  defaultMethodType: z.enum(methodType, {
    errorMap: (issue, ctx) => ({
      message: "Default method is required",
    }),
  }),
  itemTrackingType: z.enum(itemTrackingTypes, {
    errorMap: (issue, ctx) => ({
      message: "Part type is required",
    }),
  }),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of Measure is required" }),
  unitCost: zfd.numeric(z.number().nonnegative().optional()),
  active: zfd.checkbox(),
});

export const configurationParameterGroupValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
});

export const configurationParameterGroupOrderValidator = z.object({
  id: z.string().min(1, { message: "ID is required" }),
  sortOrder: zfd.numeric(z.number().min(0)),
});

export const configurationParameterOrderValidator = z.object({
  id: z.string().min(1, { message: "ID is required" }),
  sortOrder: zfd.numeric(z.number().min(0)),
  configurationParameterGroupId: zfd.text(z.string().nullable()),
});

export const configurationParameterValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    itemId: z.string().min(1, { message: "Item ID is required" }),
    key: zfd.text(z.string().optional()),
    label: z.string().min(1, { message: "Label is required" }),
    dataType: z.enum([...configurationParameterDataTypes, "date"]),
    listOptions: z.string().min(1).array().optional(),
    configurationParameterGroupId: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.dataType === "list") {
        return !!data.listOptions;
      }
      return true;
    },
    { message: "List options are required", path: ["listOptions"] }
  )
  .refine(
    (data) => {
      return data.label.match(/^[a-zA-Z0-9 ]+$/);
    },
    {
      message: "Only alphanumeric characters and spaces are allowed",
      path: ["label"],
    }
  )
  .refine(
    (data) => {
      return data.key?.match(/^[a-zA-Z0-9]+(_[a-zA-Z0-9]+)*$/);
    },
    { message: "Key must be lowercase and underscore separated" }
  );

export const configurationRuleValidator = z.object({
  field: z.string().min(1, { message: "Field is required" }),
  code: z.string().min(1, { message: "Code is required" }),
});

export const consumableValidator = itemValidator.merge(
  z.object({
    id: z.string().min(1, { message: "Consumable ID is required" }).max(255),
    unitOfMeasureCode: z
      .string()
      .min(1, { message: "Unit of Measure is required" }),
  })
);

export const customerPartValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item ID is required" }),
  customerId: z.string().min(36, { message: "Customer is required" }),
  customerPartId: z.string(),
  customerPartRevision: zfd.text(z.string().optional()),
});

export const getMethodValidator = z.object({
  targetId: z.string().min(1, { message: "Please select a target method" }),
  sourceId: z.string().min(1, { message: "Please select a source method" }),
});

export const makeMethodVersionValidator = z.object({
  copyFromId: z.string().min(1, { message: "Please select a source method" }),
  activeVersionId: zfd.text(z.string().optional()),
  version: zfd.numeric(
    z.number().min(0, { message: "Please enter a version" })
  ),
});

export const materialValidator = itemValidator.merge(
  z.object({
    id: z.string().min(1, { message: "Material ID is required" }).max(255),
    materialSubstanceId: zfd.text(z.string().optional()),
    materialFormId: zfd.text(z.string().optional()),
    finish: z.string().optional(),
    grade: z.string().optional(),
    dimensions: z.string().optional(),
  })
);

export const methodMaterialValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    makeMethodId: z.string().min(20, { message: "Make method is required" }),
    order: zfd.numeric(z.number().min(0)),
    itemType: z.enum(methodItemType, {
      errorMap: (issue, ctx) => ({
        message: "Item type is required",
      }),
    }),
    kit: zfd.text(z.string().optional()).transform((value) => value === "true"),
    methodType: z.enum(methodType, {
      errorMap: (issue, ctx) => ({
        message: "Method type is required",
      }),
    }),
    itemId: z.string().optional(),
    itemReadableId: z.string().optional(),
    methodOperationId: zfd.text(z.string().optional()),
    // description: z.string().min(1, { message: "Description is required" }),
    quantity: zfd.numeric(z.number().min(0)),
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
  // .refine(
  //   (data) => {
  //     if (data.itemType === "Fixture") {
  //       return !!data.itemReadableId;
  //     }
  //     return true;
  //   },
  //   {
  //     message: "Fixture ID is required",
  //     path: ["itemId"],
  //   }
  // )
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
  );
// .refine(
//   (data) => {
//     if (data.itemType === "Service") {
//       return !!data.itemReadableId;
//     }
//     return true;
//   },
//   {
//     message: "Service ID is required",
//     path: ["itemId"],
//   }
// );

export const methodOperationValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    makeMethodId: z.string().min(0, { message: "Make method is required" }),
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
    operationSupplierProcessId: zfd.text(z.string().optional()),
    operationMinimumCost: zfd.numeric(z.number().min(0).optional()),
    operationUnitCost: zfd.numeric(z.number().min(0).optional()),
    operationLeadTime: zfd.numeric(z.number().min(0).optional()),
  })
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
  );

export const itemCostValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  // itemPostingGroupId: zfd.text(z.string().optional()),
  // costingMethod: z.enum(itemCostingMethods, {
  //   errorMap: (issue, ctx) => ({
  //     message: "Costing method is required",
  //   }),
  // }),
  // standardCost: zfd.numeric(z.number().min(0)),
  unitCost: zfd.numeric(z.number().min(0)),
  // costIsAdjusted: zfd.checkbox(),
});

export const itemManufacturingValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  // manufacturingBlocked: zfd.checkbox(),
  requiresConfiguration: zfd.checkbox().optional(),
  lotSize: zfd.numeric(z.number().min(0)),
  scrapPercentage: zfd.numeric(z.number().min(0)),
  leadTime: zfd.numeric(z.number().min(0)),
});

export const itemPostingGroupValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(255),
  description: z.string().optional(),
});

export const itemPlanningValidator = z
  .object({
    itemId: z.string().min(1, { message: "Item ID is required" }),
    locationId: z.string().min(20, { message: "Location is required" }),
    reorderingPolicy: z.enum(itemReorderingPolicies, {
      errorMap: (issue, ctx) => ({
        message: "Reordering policy is required",
      }),
    }),
    demandAccumulationPeriod: zfd.numeric(z.number().min(0).optional()),
    demandAccumulationSafetyStock: zfd.numeric(z.number().min(0).optional()),
    reorderPoint: zfd.numeric(z.number().min(0).optional()).optional(),
    reorderQuantity: zfd.numeric(z.number().min(0)).optional(),
    maximumInventoryQuantity: zfd.numeric(z.number().min(0)).optional(),
    minimumOrderQuantity: zfd.numeric(z.number().min(0)).optional(),
    maximumOrderQuantity: zfd.numeric(z.number().min(0)).optional(),
    orderMultiple: zfd.numeric(z.number().min(1)).optional(),
    // critical: zfd.checkbox(),
  })
  .refine(
    (data) => {
      if (data.reorderingPolicy === "Maximum Quantity") {
        return (
          data.maximumInventoryQuantity &&
          data.reorderPoint &&
          data.maximumInventoryQuantity > data.reorderPoint
        );
      }
      return true;
    },
    {
      message: "Maximum inventory quantity must be greater than reorder point",
      path: ["maximumInventoryQuantity"],
    }
  );

export const itemPurchasingValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  preferredSupplierId: zfd.text(z.string().optional()),
  conversionFactor: zfd.numeric(z.number().min(0)),
  leadTime: zfd.numeric(z.number().min(0)),
  purchasingUnitOfMeasureCode: zfd.text(z.string().optional()),
  // purchasingBlocked: zfd.checkbox(),
});

export const itemUnitSalePriceValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  unitSalePrice: zfd.numeric(z.number().min(0)),
  currencyCode: z.string().min(1, { message: "Currency is required" }),
  salesUnitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of Measure is required" }),
  salesBlocked: zfd.checkbox(),
  priceIncludesTax: zfd.checkbox(),
  allowInvoiceDiscount: zfd.checkbox(),
});

export const materialDimensionValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(255),
  materialFormId: z.string().min(1, { message: "Shape is required" }),
});

export const materialFinishValidator = z.object({
  id: zfd.text(z.string().optional()),
  materialSubstanceId: z.string().min(1, { message: "Substance is required" }),
  name: z.string().min(1, { message: "Name is required" }).max(255),
});

export const materialFormValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(255),
});

export const materialGradeValidator = z.object({
  id: zfd.text(z.string().optional()),
  materialSubstanceId: z.string().min(1, { message: "Substance is required" }),
  name: z.string().min(1, { message: "Name is required" }).max(255),
});

export const materialSubstanceValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(255),
});

export const partValidator = itemValidator.merge(
  z.object({
    id: z.string().min(1, { message: "Part ID is required" }).max(255),
    modelUploadId: zfd.text(z.string().optional()),
    lotSize: zfd.numeric(z.number().min(0).optional()),
  })
);

export const pickMethodValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  locationId: z.string().min(20, { message: "Location is required" }),
  defaultShelfId: zfd.text(z.string().optional()),
});

export const revisionValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    type: z.enum(["Part", "Material", "Tool", "Consumable", "Service"]),
    copyFromId: zfd.text(z.string().optional()),
    revision: z.string().min(1, { message: "Revision is required" }),
  })
  .refine(
    (data) => {
      return data.id || data.copyFromId;
    },
    { message: "Revision or copy from is required" }
  );

export const serviceValidator = itemValidator.merge(
  z.object({
    id: z.string().min(1, { message: "Service ID is required" }).max(255),
    serviceType: z.enum(serviceType, {
      errorMap: (issue, ctx) => ({
        message: "Service type is required",
      }),
    }),
  })
);

export const supplierPartValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item ID is required" }),
  supplierId: z.string().min(36, { message: "Supplier ID is required" }),
  supplierPartId: z.string().optional(),
  supplierUnitOfMeasureCode: zfd.text(z.string().optional()),
  minimumOrderQuantity: zfd.numeric(z.number().min(0)),
  conversionFactor: zfd.numeric(z.number().min(0)),
  unitPrice: zfd.numeric(z.number().min(0)),
});

export const toolValidator = itemValidator.merge(
  z.object({
    id: z.string().min(1, { message: "Tool ID is required" }).max(255),
    modelUploadId: zfd.text(z.string().optional()),
    unitOfMeasureCode: z
      .string()
      .min(1, { message: "Unit of Measure is required" }),
    lotSize: zfd.numeric(z.number().min(0).optional()),
  })
);

export const unitOfMeasureValidator = z.object({
  id: zfd.text(z.string().optional()),
  code: z.string().min(1, { message: "Code is required" }).max(10),
  name: z.string().min(1, { message: "Name is required" }).max(50),
});
