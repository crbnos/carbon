import { TRANSACTION_SURFACES } from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";
import {
  methodItemType,
  methodOperationOrders,
  methodType,
  operationTypes,
  sourcingType,
  standardFactorType
} from "../shared";

export const batchPropertyDataTypes = [
  "text",
  "numeric",
  "boolean",
  "list",
  "date"
] as const;

export const configurationParameterDataTypes = [
  "text",
  "numeric",
  "boolean",
  "list",
  "material"
] as const;

export const itemTrackingTypes = [
  "Inventory",
  "Non-Inventory",
  "Serial",
  "Batch"
] as const;

export const ItemTrackingType = {
  Inventory: "Inventory",
  NonInventory: "Non-Inventory",
  Serial: "Serial",
  Batch: "Batch"
} as const satisfies Record<string, (typeof itemTrackingTypes)[number]>;

export const itemCostingMethods = [
  "Standard",
  "Average",
  "FIFO",
  "LIFO"
] as const;

export const itemReorderingPolicies = [
  "Manual Reorder",
  "Demand-Based Reorder",
  "Fixed Reorder Quantity",
  "Maximum Quantity"
] as const;

export const itemReplenishmentSystems = [
  "Buy",
  "Make",
  "Buy and Make"
] as const;

export const shelfLifeModes = [
  "NotManaged",
  "Fixed Duration",
  "Calculated",
  "Set on Receipt"
] as const;

export const shelfLifeTriggerTimings = ["Before", "After"] as const;

export const partManufacturingPolicies = [
  "Make to Stock",
  "Make to Order"
] as const;

export const serviceType = ["Internal", "External"] as const;

export const supplierPartPriceSourceTypes = [
  "Quote",
  "Purchase Order",
  "Manual Entry"
] as const;

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
      message: "Replenishment system is required"
    })
  }),
  defaultMethodType: z.enum(methodType, {
    errorMap: (issue, ctx) => ({
      message: "Default method is required"
    })
  }),
  itemTrackingType: z.enum(itemTrackingTypes, {
    errorMap: (issue, ctx) => ({
      message: "Part type is required"
    })
  }),
  postingGroupId: zfd.text(z.string().optional()),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of Measure is required" }),
  unitCost: zfd.numeric(z.number().nonnegative().optional()),
  // Default storage unit (form-only; persisted to pickMethod via
  // upsertItemDefaultPickMethod). Can point at any level of the
  // storageUnit hierarchy since storageUnit nests via parentId. The
  // locationId is derived server-side from storageUnit.locationId -
  // the form itself does not capture a location.
  defaultStorageUnitId: zfd.text(z.string().optional()),
  // Shelf life. The UI Select only surfaces "Fixed Duration" / "Calculated";
  // clearing it (X button) submits an empty string, which we preprocess to
  // the sentinel "NotManaged" so the server deletes any existing
  // itemShelfLife row. Truly absent fields (non-form callers like MCP that
  // don't set shelfLifeMode at all) remain undefined, which the upsert
  // helper treats as a no-op.
  shelfLifeMode: z.preprocess(
    (v) => (v === "" ? "NotManaged" : v),
    z.enum(shelfLifeModes).optional()
  ),
  shelfLifeDays: zfd.numeric(z.number().positive().optional()),
  shelfLifeTriggerProcessId: zfd.text(z.string().optional()),
  // Whether the clock starts when the trigger process begins ('Before') or
  // completes ('After'). Only meaningful with Fixed Duration + a trigger
  // process; ignored otherwise. Defaults to 'After' to preserve legacy
  // behavior on items that pre-date this column.
  shelfLifeTriggerTiming: z.enum(shelfLifeTriggerTimings).optional(),
  // Fixed Duration + Make items only: when true, the produced expiry is
  // capped by the earliest input expiry — the output cannot outlast its
  // raw materials. Falls back to today + days when no input has a date.
  // Mirrors the inventory-settings "Calculate from BOM" copy.
  shelfLifeCalculateFromBom: zfd.checkbox(),
  requiresInspection: zfd.checkbox().optional()
});

// Common storage / shelf-life refines. Shared across all item-type
// validators. Default Storage Unit is optional for every type - users can
// set it later via the pickMethod UI once they know where the item lives.
const applyStorageAndShelfLifeRefines = <T extends z.AnyZodObject>(
  schema: T
) => {
  const refined: z.ZodEffects<z.ZodTypeAny, z.infer<T>, z.input<T>> = schema
    .refine(
      (data: z.infer<T>) =>
        data.shelfLifeDays === undefined ||
        data.shelfLifeMode === "Fixed Duration",
      {
        message:
          "Shelf-life days can only be set when shelf-life management is Fixed Duration",
        path: ["shelfLifeDays"]
      }
    )
    .refine(
      (data: z.infer<T>) =>
        data.shelfLifeMode !== "Fixed Duration" ||
        data.shelfLifeDays !== undefined,
      {
        message:
          "Shelf-life days is required when shelf-life management is Fixed Duration",
        path: ["shelfLifeDays"]
      }
    )
    .refine(
      (data: z.infer<T>) =>
        !data.shelfLifeTriggerProcessId ||
        data.shelfLifeMode === "Fixed Duration",
      {
        message:
          "Trigger process can only be set when shelf-life management is Fixed Duration",
        path: ["shelfLifeTriggerProcessId"]
      }
    )
    .refine(
      (data: z.infer<T>) =>
        !data.shelfLifeMode ||
        data.shelfLifeMode === "NotManaged" ||
        data.itemTrackingType === "Serial" ||
        data.itemTrackingType === "Batch",
      {
        message:
          "Shelf-life can only be managed on items tracked by Serial or Batch - there's no per-unit record to set the expiry on otherwise",
        path: ["shelfLifeMode"]
      }
    )
    .refine(
      (data: z.infer<T>) =>
        data.shelfLifeMode !== "Calculated" ||
        data.replenishmentSystem !== "Buy",
      {
        message:
          "Component minimum shelf-life requires a BoM - only Make or Buy and Make items qualify",
        path: ["shelfLifeMode"]
      }
    )
    .refine(
      (data: z.infer<T>) =>
        data.shelfLifeMode !== "Set on Receipt" ||
        data.replenishmentSystem !== "Make",
      {
        message:
          "Set on receipt applies at goods-in - only Buy or Buy and Make items qualify",
        path: ["shelfLifeMode"]
      }
    )
    .refine(
      (data: z.infer<T>) =>
        !data.shelfLifeCalculateFromBom ||
        data.shelfLifeMode === "Fixed Duration",
      {
        message: "Calculate from BOM only applies to Fixed Duration shelf life",
        path: ["shelfLifeCalculateFromBom"]
      }
    )
    .refine(
      (data: z.infer<T>) =>
        !data.shelfLifeCalculateFromBom || data.replenishmentSystem !== "Buy",
      {
        message:
          "Calculate from BOM requires a BoM - only Make or Buy and Make items qualify",
        path: ["shelfLifeCalculateFromBom"]
      }
    ) as z.ZodEffects<z.ZodTypeAny, z.infer<T>, z.input<T>>;

  return refined;
};

export const configurationParameterGroupValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});

export const configurationParameterGroupOrderValidator = z.object({
  id: z.string().min(1, { message: "ID is required" }),
  sortOrder: zfd.numeric(z.number().min(0))
});

export const configurationParameterOrderValidator = z.object({
  id: z.string().min(1, { message: "ID is required" }),
  sortOrder: zfd.numeric(z.number().min(0)),
  configurationParameterGroupId: zfd.text(z.string().nullable())
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
    materialFormFilterId: zfd.text(z.string().optional())
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
      return data.key?.match(/^[a-zA-Z0-9]+(_[a-zA-Z0-9]+)*$/);
    },
    { message: "Key must be lowercase and underscore separated" }
  );

export const configurationRuleValidator = z.object({
  field: z.string().min(1, { message: "Field is required" }),
  code: z.string().min(1, { message: "Code is required" })
});

export const consumableValidator = applyStorageAndShelfLifeRefines(
  itemValidator.merge(
    z.object({
      id: z.string().min(1, { message: "Consumable ID is required" }).max(255),
      unitOfMeasureCode: z
        .string()
        .min(1, { message: "Unit of Measure is required" })
    })
  )
);

export const customerPartValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item ID is required" }),
  customerId: z.string().min(1, { message: "Customer is required" }),
  customerPartId: z.string(),
  customerPartRevision: zfd.text(z.string().optional())
});

export const getMethodValidator = z.object({
  targetId: z.string().min(1, { message: "Please select a target method" }),
  sourceId: z.string().min(1, { message: "Please select a source method" }),
  billOfMaterial: zfd.checkbox(),
  billOfProcess: zfd.checkbox(),
  parameters: zfd.checkbox(),
  tools: zfd.checkbox(),
  steps: zfd.checkbox(),
  workInstructions: zfd.checkbox()
});

export const makeMethodVersionValidator = z.object({
  copyFromId: z.string().min(1, { message: "Please select a source method" }),
  activeVersionId: zfd.text(z.string().optional()),
  version: zfd.numeric(z.number().min(0, { message: "Please enter a version" }))
});

export const materialValidator = applyStorageAndShelfLifeRefines(
  itemValidator.merge(
    z.object({
      id: z.string().min(1, { message: "Material ID is required" }).max(255),
      materialSubstanceId: zfd.text(z.string().optional()),
      materialFormId: zfd.text(z.string().optional()),
      materialTypeId: zfd.text(z.string().optional()),
      finishId: zfd.text(z.string().optional()),
      gradeId: zfd.text(z.string().optional()),
      dimensionId: zfd.text(z.string().optional()),
      sizes: z.array(z.string()).optional()
    })
  )
);

export const materialValidatorWithGeneratedIds = z.object({
  id: z.string().min(1, { message: "" }),
  materialSubstanceId: z.string().min(1, { message: "Substance is required" }),
  materialFormId: z.string().min(1, { message: "Shape is required" }),
  materialTypeId: zfd.text(z.string().optional()),
  finishId: zfd.text(z.string().optional()),
  gradeId: zfd.text(z.string().optional()),
  dimensionId: zfd.text(z.string().optional()),
  sizes: z.array(z.string()).optional()
});

export const methodMaterialValidator = z.object({
  id: z.string().min(1, { message: "Material ID is required" }),
  makeMethodId: z.string().min(1, { message: "Make method is required" }),
  order: zfd.numeric(z.number().min(0)),
  itemType: z.enum(methodItemType, {
    errorMap: (issue, ctx) => ({
      message: "Item type is required"
    })
  }),
  kit: zfd.text(z.string().optional()).transform((value) => value === "true"),
  methodType: z.enum(methodType, {
    errorMap: (issue, ctx) => ({
      message: "Method type is required"
    })
  }),
  sourcingType: z.enum(sourcingType, {
    errorMap: (issue, ctx) => ({
      message: "Sourcing type is required"
    })
  }),
  itemId: z.string().optional(),
  methodOperationId: zfd.text(z.string().optional()),
  // description: z.string().min(1, { message: "Description is required" }),
  quantity: zfd.numeric(z.number().min(0)),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of Measure is required" }),
  storageUnitIds: z.string().transform((val) => {
    try {
      return JSON.parse(val) as Record<string, string>;
    } catch {
      return {};
    }
  })
});

export const methodOperationValidator = z
  .object({
    id: z.string().min(1, { message: "Operation ID is required" }),
    makeMethodId: z.string().min(0, { message: "Make method is required" }),
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
    workCenterId: zfd.text(z.string().optional()),
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
    operationSupplierProcessId: zfd.text(z.string().optional()),
    operationMinimumCost: zfd.numeric(z.number().min(0).optional()),
    operationUnitCost: zfd.numeric(z.number().min(0).optional()),
    operationLeadTime: zfd.numeric(z.number().min(0).optional())
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
  );

export const itemCostValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  itemPostingGroupId: zfd.text(z.string().optional()),
  costingMethod: z.enum(itemCostingMethods, {
    errorMap: () => ({
      message: "Costing method is required"
    })
  }),
  // standardCost: zfd.numeric(z.number().min(0)),
  unitCost: zfd.numeric(z.number().min(0))
  // costIsAdjusted: zfd.checkbox(),
});

export const itemManufacturingValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  // manufacturingBlocked: zfd.checkbox(),
  requiresConfiguration: zfd.checkbox().optional(),
  lotSize: zfd.numeric(z.number().min(0)),
  scrapPercentage: zfd.numeric(z.number().min(0)),
  leadTime: zfd.numeric(z.number().min(0))
});

export const itemPostingGroupValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(255),
  description: z.string().optional()
});

export const itemPlanningValidator = z
  .object({
    itemId: z.string().min(1, { message: "Item ID is required" }),
    locationId: z.string().min(1, { message: "Location is required" }),
    reorderingPolicy: z.enum(itemReorderingPolicies, {
      errorMap: (issue, ctx) => ({
        message: "Reordering policy is required"
      })
    }),
    demandAccumulationPeriod: zfd.numeric(z.number().min(1).optional()),
    demandAccumulationSafetyStock: zfd.numeric(z.number().min(0).optional()),
    reorderPoint: zfd.numeric(z.number().min(0).optional()).optional(),
    reorderQuantity: zfd.numeric(z.number().min(0)).optional(),
    maximumInventoryQuantity: zfd.numeric(z.number().min(0)).optional(),
    minimumOrderQuantity: zfd.numeric(z.number().min(0)).optional(),
    maximumOrderQuantity: zfd.numeric(z.number().min(0)).optional(),
    orderMultiple: zfd.numeric(z.number().min(1)).optional()
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
      path: ["maximumInventoryQuantity"]
    }
  )
  .refine(
    (data) => {
      if (data.reorderingPolicy === "Fixed Reorder Quantity") {
        return data.reorderQuantity && data.reorderQuantity > 0;
      }
      return true;
    },
    {
      message: "Reorder quantity must be greater than 0",
      path: ["reorderQuantity"]
    }
  );

export const itemPurchasingValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  preferredSupplierId: zfd.text(z.string().optional()),
  conversionFactor: zfd.numeric(z.number().min(0)),
  leadTime: zfd.numeric(z.number().min(0)),
  purchasingUnitOfMeasureCode: zfd.text(z.string().optional())
  // purchasingBlocked: zfd.checkbox(),
});

export const itemUnitSalePriceValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  unitSalePrice: zfd.numeric(z.number().min(0))
  // currencyCode: z.string().min(1, { message: "Currency is required" }),
  // salesUnitOfMeasureCode: z
  //   .string()
  //   .min(1, { message: "Unit of Measure is required" }),
  // salesBlocked: zfd.checkbox(),
  // priceIncludesTax: zfd.checkbox(),
  // allowInvoiceDiscount: zfd.checkbox(),
});

export const materialDimensionValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(255),
  materialFormId: z.string().min(1, { message: "Shape is required" })
});

export const materialFinishValidator = z.object({
  id: zfd.text(z.string().optional()),
  materialSubstanceId: z.string().min(1, { message: "Substance is required" }),
  name: z.string().min(1, { message: "Name is required" }).max(255)
});

export const materialFormValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(255),
  code: z.string().min(1, { message: "Code is required" }).max(10)
});

export const materialGradeValidator = z.object({
  id: zfd.text(z.string().optional()),
  materialSubstanceId: z.string().min(1, { message: "Substance is required" }),
  name: z.string().min(1, { message: "Name is required" }).max(255)
});

export const materialSubstanceValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(255),
  code: z.string().min(1, { message: "Code is required" }).max(10)
});

export const materialTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  materialSubstanceId: z.string().min(1, { message: "Substance is required" }),
  materialFormId: z.string().min(1, { message: "Shape is required" }),
  name: z.string().min(1, { message: "Name is required" }).max(255),
  code: z.string().min(1, { message: "Code is required" }).max(10)
});

export const partValidator = applyStorageAndShelfLifeRefines(
  itemValidator.merge(
    z.object({
      id: z.string().min(1, { message: "Part ID is required" }).max(255),
      revision: z.string().min(1, { message: "Revision is required" }),
      modelUploadId: zfd.text(z.string().optional()),
      lotSize: zfd.numeric(z.number().min(0).optional())
    })
  )
);

export const pickMethodValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  defaultStorageUnitId: zfd.text(z.string().optional())
});

// pickMethod form + shelf-life policy in one submit. Shelf-life itself is
// item-level (stored on itemShelfLife keyed by itemId), not per-location,
// but we surface the controls on the per-location "Inventory" card so
// users editing the item's stocking defaults can also manage its shelf-
// life policy without navigating elsewhere. The server-side action is
// responsible for routing each subset of fields to its own upsert helper.
//
// Note: this validator does NOT reference itemTrackingType (pickMethod
// doesn't carry it). The UI gates visibility of the shelf-life fields on
// tracking type via a prop, and the itemValidator chain already enforces
// the Serial-or-Batch prerequisite at item creation. If a caller somehow
// posts shelfLifeMode on an item without Serial/Batch tracking, the
// itemShelfLife table's CHECK constraints still stand - but it's easier
// UX to not render the fields at all in that case.
export const pickMethodWithShelfLifeValidator = pickMethodValidator
  .merge(
    z.object({
      shelfLifeMode: z.preprocess(
        (v) => (v === "" ? "NotManaged" : v),
        z.enum(shelfLifeModes).optional()
      ),
      shelfLifeDays: zfd.numeric(z.number().positive().optional()),
      shelfLifeTriggerProcessId: zfd.text(z.string().optional()),
      shelfLifeTriggerTiming: z.enum(shelfLifeTriggerTimings).optional(),
      shelfLifeCalculateFromBom: zfd.checkbox()
    })
  )
  .refine(
    (data) =>
      data.shelfLifeDays === undefined ||
      data.shelfLifeMode === "Fixed Duration",
    {
      message:
        "Shelf-life days can only be set when shelf-life management is Fixed Duration",
      path: ["shelfLifeDays"]
    }
  )
  .refine(
    (data) =>
      data.shelfLifeMode !== "Fixed Duration" ||
      data.shelfLifeDays !== undefined,
    {
      message:
        "Shelf-life days is required when shelf-life management is Fixed Duration",
      path: ["shelfLifeDays"]
    }
  )
  .refine(
    (data) =>
      !data.shelfLifeTriggerProcessId ||
      data.shelfLifeMode === "Fixed Duration",
    {
      message:
        "Trigger process can only be set when shelf-life management is Fixed Duration",
      path: ["shelfLifeTriggerProcessId"]
    }
  )
  .refine(
    (data) =>
      !data.shelfLifeCalculateFromBom ||
      data.shelfLifeMode === "Fixed Duration",
    {
      message: "Calculate from BOM only applies to Fixed Duration shelf life",
      path: ["shelfLifeCalculateFromBom"]
    }
  );

export const revisionValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    type: z.enum(["Part", "Material", "Tool", "Consumable", "Service"]),
    copyFromId: zfd.text(z.string().optional()),
    revision: z.string().min(1, { message: "Revision is required" })
  })
  .refine(
    (data) => {
      return data.id || data.copyFromId;
    },
    { message: "Revision or copy from is required" }
  );

export const serviceValidator = applyStorageAndShelfLifeRefines(
  itemValidator.merge(
    z.object({
      id: z.string().min(1, { message: "Service ID is required" }).max(255),
      serviceType: z.enum(serviceType, {
        errorMap: (issue, ctx) => ({
          message: "Service type is required"
        })
      })
    })
  )
);

export const supplierPartValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item ID is required" }),
  supplierId: z.string().min(1, { message: "Supplier ID is required" }),
  supplierPartId: z.string().optional(),
  supplierUnitOfMeasureCode: zfd.text(z.string().optional()),
  minimumOrderQuantity: zfd.numeric(z.number().min(0)),
  conversionFactor: zfd.numeric(z.number().min(0)),
  unitPrice: zfd.numeric(z.number().min(0).optional())
});

export const toolValidator = applyStorageAndShelfLifeRefines(
  itemValidator.merge(
    z.object({
      id: z.string().min(1, { message: "Tool ID is required" }).max(255),
      revision: z.string().min(1, { message: "Revision is required" }),
      modelUploadId: zfd.text(z.string().optional()),
      unitOfMeasureCode: z
        .string()
        .min(1, { message: "Unit of Measure is required" }),
      lotSize: zfd.numeric(z.number().min(0).optional())
    })
  )
);

export const unitOfMeasureValidator = z.object({
  id: zfd.text(z.string().optional()),
  code: z.string().min(1, { message: "Code is required" }).max(10),
  name: z.string().min(1, { message: "Name is required" }).max(50)
});

export const itemRuleSeverities = ["error", "warn"] as const;

export const itemRuleOperators = [
  "eq",
  "neq",
  "in",
  "notIn",
  "isSet",
  "isNotSet",
  "gt",
  "lt"
] as const;

const itemRuleConditionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
  z.null()
]);

const itemRuleConditionSchema = z.object({
  field: z.string().min(1, { message: "Field is required" }),
  op: z.enum(itemRuleOperators),
  value: itemRuleConditionValueSchema.optional()
});

export const itemRuleMatchKinds = ["all", "any", "none"] as const;

export const itemRuleConditionAstSchema = z.object({
  kind: z.enum(itemRuleMatchKinds),
  conditions: z
    .array(itemRuleConditionSchema)
    .min(1, { message: "At least one condition is required" })
});

// conditionAst arrives as a JSON-encoded string in form data; pre-parse before validating.
const itemRuleConditionAstFormField = z.preprocess((raw) => {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}, itemRuleConditionAstSchema);

export const itemRuleValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(120),
  description: zfd.text(z.string().optional()),
  message: z.string().min(1, { message: "Message is required" }).max(500),
  severity: z.enum(itemRuleSeverities),
  active: zfd.checkbox(),
  surfaces: zfd
    .repeatableOfType(z.enum(TRANSACTION_SURFACES))
    .refine((arr) => arr.length >= 1, {
      message: "Pick at least one surface"
    }),
  conditionAst: itemRuleConditionAstFormField
});

export const itemRuleAssignmentValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  ruleId: z.string().min(1, { message: "Rule ID is required" })
});

export const itemRuleAcknowledgeValidator = zfd.checkbox();
