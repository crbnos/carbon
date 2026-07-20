import type { PostgrestError } from "@supabase/supabase-js";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { nonConformancePriority } from "../quality/quality.models";
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

// Maps an edit of ONE of the three interlocked item-level fields
// (replenishmentSystem, defaultMethodType, sourcingType) to the columns that must
// change together on the item, plus the values to mirror down to method materials.
// Pure — no DB access — so the interlock rule lives in ONE place, shared by the
// inline item-update route (x+/items+/update.tsx) and the change-order attributes
// editor. Keeping them in sync via a hand-copied mapping is exactly the drift this
// avoids.
export function deriveItemMethodUpdate(
  field: "replenishmentSystem" | "defaultMethodType" | "sourcingType",
  value: string
): {
  itemUpdate: {
    replenishmentSystem?: (typeof itemReplenishmentSystems)[number];
    defaultMethodType?: (typeof methodType)[number];
    sourcingType?: (typeof sourcingType)[number];
  };
  cascade: {
    sourcingType?: (typeof sourcingType)[number];
    methodType?: (typeof methodType)[number];
  };
} {
  switch (field) {
    case "replenishmentSystem": {
      const replenishmentSystem =
        value as (typeof itemReplenishmentSystems)[number];
      // Picking a concrete replenishment system pins the default method type.
      if (value !== "Buy and Make") {
        const defaultMethodType: (typeof methodType)[number] =
          value === "Make"
            ? "Make to Order"
            : value === "Buy"
              ? "Purchase to Order"
              : "Pull from Inventory";
        return {
          itemUpdate: { replenishmentSystem, defaultMethodType },
          cascade: { methodType: defaultMethodType }
        };
      }
      return { itemUpdate: { replenishmentSystem }, cascade: {} };
    }
    case "defaultMethodType": {
      const defaultMethodType = value as (typeof methodType)[number];
      // A concrete method type pins the replenishment system to match.
      if (value !== "Pull from Inventory") {
        const replenishmentSystem: (typeof itemReplenishmentSystems)[number] =
          value === "Make to Order"
            ? "Make"
            : value === "Purchase to Order"
              ? "Buy"
              : "Buy and Make";
        return {
          itemUpdate: { defaultMethodType, replenishmentSystem },
          cascade: { methodType: defaultMethodType }
        };
      }
      return {
        itemUpdate: { defaultMethodType },
        cascade: { methodType: defaultMethodType }
      };
    }
    case "sourcingType": {
      const sourcingTypeValue = value as (typeof sourcingType)[number];
      // Sourcing drives method type: Drop Ship → Purchase to Order, Ship from
      // Inventory → Pull from Inventory, Specified → leave method type as-is.
      const derivedMethodType: (typeof methodType)[number] | undefined =
        value === "Drop Ship"
          ? "Purchase to Order"
          : value === "Ship from Inventory"
            ? "Pull from Inventory"
            : undefined;
      return {
        itemUpdate: {
          sourcingType: sourcingTypeValue,
          ...(derivedMethodType ? { defaultMethodType: derivedMethodType } : {})
        },
        cascade: {
          sourcingType: sourcingTypeValue,
          methodType: derivedMethodType
        }
      };
    }
  }
}

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

// Services are Buy or Make only — never "Buy and Make", and never stocked
// ("Pull from Inventory" is not a valid method for a Non-Inventory item).
export const serviceReplenishmentSystems = ["Buy", "Make"] as const;

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
  // Manufacturer Part Number — the manufacturer's catalog number for a
  // purchased item. Only surfaced/edited for Buy items in the Properties panel.
  mpn: zfd.text(z.string().optional()),
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

export const supersessionModes = [
  "Consume First",
  "Prefer New",
  "Stock Only",
  "No Stock"
] as const;

export type SupersessionMode = (typeof supersessionModes)[number];

// Single source of truth for how each supersession mode is presented — the same
// color + description is reused everywhere the mode shows up (the item
// supersession picker, the item lifecycle badge, and the change-order cutover),
// so they never drift.
export const supersessionModeMeta: Record<
  SupersessionMode,
  { color: "green" | "blue" | "orange" | "red"; description: string }
> = {
  "Consume First": {
    color: "green",
    description: "Use remaining stock before switching to the successor"
  },
  "Prefer New": {
    color: "blue",
    description: "Default to the successor; old part as fallback only"
  },
  "Stock Only": {
    color: "orange",
    description: "Hold a minimum reserve for service; no production use"
  },
  "No Stock": {
    color: "red",
    description: "Fully obsolete — do not plan or stock"
  }
};

export const itemSupersessionValidator = z
  .object({
    itemId: z.string().min(1, { message: "Item ID is required" }),
    // Absent mode = no supersession; saving without a mode clears it.
    supersessionMode: zfd.text(z.enum(supersessionModes).optional()),
    successorItemId: zfd.text(z.string().optional()),
    discontinuationDate: zfd.text(z.string().optional()),
    successorEffectivityDate: zfd.text(z.string().optional()),
    // How many of the successor replace one old part (1 old = N new).
    conversionFactor: zfd.numeric(z.number().positive().optional()),
    // The minimum service-stock floor is per-location (stored on itemPlanning).
    locationId: zfd.text(z.string().optional()),
    minimumReserveQuantity: zfd.numeric(z.number().min(0).optional())
  })
  .refine(
    (data) => (data.supersessionMode ? !!data.discontinuationDate : true),
    {
      message: "Discontinuation date is required",
      path: ["discontinuationDate"]
    }
  )
  .refine(
    (data) =>
      data.supersessionMode && data.supersessionMode !== "No Stock"
        ? !!data.successorItemId
        : true,
    {
      message: "Successor part is required",
      path: ["successorItemId"]
    }
  )
  .refine((data) => data.successorItemId !== data.itemId, {
    message: "A part cannot be its own successor",
    path: ["successorItemId"]
  })
  .refine(
    (data) =>
      data.successorEffectivityDate && data.discontinuationDate
        ? data.successorEffectivityDate >= data.discontinuationDate
        : true,
    {
      message:
        "Successor effectivity date must be on or after the discontinuation date",
      path: ["successorEffectivityDate"]
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

// Tracked-entity pick order surfaced on the item's per-location Inventory
// card. 'Default' = the picker's smart order (expiring soonest, then oldest).
// Mirrors "pickMethodSortMethod" Postgres enum.
export const pickMethodSortMethods = [
  "Default",
  "FEFO",
  "FIFO",
  "LIFO"
] as const;

export const pickMethodValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  defaultStorageUnitId: zfd.text(z.string().optional()),
  sortMethod: z.enum(pickMethodSortMethods).optional()
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
      revision: z.string().min(1, { message: "Revision is required" }),
      unitOfMeasureCode: z
        .string()
        .min(1, { message: "Unit of Measure is required" }),
      replenishmentSystem: z.enum(serviceReplenishmentSystems, {
        errorMap: (issue, ctx) => ({
          message: "Replenishment system is required"
        })
      }),
      // Services can never be shipped, received, or stocked
      itemTrackingType: z.literal("Non-Inventory")
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
  orderMultiple: zfd.numeric(z.number().min(1)).optional(),
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

export const itemRevisionStatus = [
  "Design",
  "Prototype",
  "Production",
  "Obsolete"
] as const;

// companySettings.plmReleaseControl
export const plmReleaseControl = ["off", "warn", "enforce"] as const;

// Error shape returned by the change order service functions: either a real
// Supabase PostgrestError or a hand-built message (sequence/lookup failures that
// don't originate from a query). One alias so callers get a consistent contract.
export type ChangeOrderError = PostgrestError | { message: string };

// =============================================================================
// Change Orders — validators, enums, and the stage state machine.
//
// A sub-area of the Items module, modeled on Quality. The header evolves the
// existing `changeOrder` table. v2: a CO's per-affected-item edits live on a
// REAL CO-owned Draft make method (no staged mirror tables); the change type
// drives the release action. Validators here cover the header, affected items +
// change type, cutover, manual supersession, and freeform actions.
// =============================================================================

// changeOrder.type — the legacy category enum on the header. Retained (the
// column still exists); the primary "Category" is `changeOrderTypeId` (a row in
// the changeOrderType lookup, reseeded to Design improvement / Obsolescence /
// Cost reduction).
export const changeOrderType = [
  "Engineering",
  "Manufacturing",
  "Documentation"
] as const;

// V1 stage flow (forward, one step at a time). Broadcast on Start /
// Implementation / Done; silent on Draft / Engineering Complete. "Cancelled" is
// the off-ramp: a CO can be closed from any open stage and reopened to Draft.
export const changeOrderStatus = [
  "Draft",
  "Start",
  "Engineering Complete",
  "Implementation",
  "Done",
  "Cancelled"
] as const;

// The forward progress stages only (excludes the "Cancelled" off-ramp). Drives
// the read-only status-flow progress bar so a cancelled CO doesn't render as a
// sixth step.
export const changeOrderStageFlow: (typeof changeOrderStatus)[number][] = [
  "Draft",
  "Start",
  "Engineering Complete",
  "Implementation",
  "Done"
];

export const changeOrderTaskStatus = [
  "Pending",
  "In Progress",
  "Completed",
  "Skipped"
] as const;

// v2 per-affected-item change type. Drives the release action + which editing
// surface is shown. Two axes — is there a predecessor, and same part number?
//   Version          = new method version on the SAME item (BoM/BoP, no supersession)
//   Revision         = new revision item, same #, new rev (BoM/BoP + attrs, auto
//                      old-rev→new-rev supersession)
//   Replacement Part = new P/N derived from + auto-superseding the affected part
//                      (BoM/BoP + attrs) — the 1:1 replacement, renamed from the old
//                      "New Part"
//   New Part         = net-new part, NO predecessor, NO supersession — introduced by
//                      the CO (Make or Buy). Used to introduce a part under change
//                      control, incl. the consolidated "1" in an N→1 assembly BOM
//                      change.
// BoM/BoP is editable on ANY change type for a manufactured (non-Buy) draft; only
// Version's extra editing scope differs (no attributes/docs/cutover surface).
export const changeOrderChangeTypes = [
  "Version",
  "Revision",
  "Replacement Part",
  "New Part"
] as const;
export type ChangeOrderChangeType = (typeof changeOrderChangeTypes)[number];

// changeOrder.priority reuses quality's nonConformancePriority DB enum.
export const changeOrderPriority = nonConformancePriority;

// -----------------------------------------------------------------------------
// Stage state machine (G8 — one place). Forward, single step, plus the Cancel /
// Reopen off-ramp. This map only encodes the allowed shape of a transition.
// IMPORTANT: the forward stage is always index 0 — the header's "Advance" action
// reads `transitions[status][0]`, so "Cancelled" must never be first.
// -----------------------------------------------------------------------------
export const changeOrderStatusTransitions: Record<
  (typeof changeOrderStatus)[number],
  (typeof changeOrderStatus)[number][]
> = {
  Draft: ["Start", "Cancelled"],
  Start: ["Engineering Complete", "Cancelled"],
  "Engineering Complete": ["Implementation", "Cancelled"],
  Implementation: ["Done", "Cancelled"],
  Done: [],
  // Reopen a closed CO back to Draft (fully editable). Done stays terminal.
  Cancelled: ["Draft"]
};

export function isAllowedChangeOrderTransition(
  from: string | null | undefined,
  to: string | null | undefined
): boolean {
  if (!from || !to || from === to) return false;
  const allowed =
    changeOrderStatusTransitions[from as (typeof changeOrderStatus)[number]];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

// The stages that broadcast a team notification on entry.
export const changeOrderBroadcastStages: (typeof changeOrderStatus)[number][] =
  ["Start", "Implementation", "Done"];

// "Open" = every stage before the record is closed at Done. Used by the item
// open-CO alert and the single-open-CO guard.
export const changeOrderOpenStatuses: (typeof changeOrderStatus)[number][] = [
  "Draft",
  "Start",
  "Engineering Complete",
  "Implementation"
];

// Locked once closed — Done (released, part of the audit trail) or Cancelled
// (abandoned). Reopen a Cancelled CO to Draft to edit it again.
export function isChangeOrderLocked(
  status: string | null | undefined
): boolean {
  return status === "Done" || status === "Cancelled";
}

// Content (reason/description/products/BOM changes/actions) is editable until
// the CO is closed.
export function canEditChangeOrder(status: string | null | undefined): boolean {
  return !isChangeOrderLocked(status);
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------
export const changeOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  reasonForChange: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  type: z.enum(changeOrderType).optional(),
  priority: z.enum(nonConformancePriority).optional(),
  changeOrderTypeId: zfd.text(z.string().optional()),
  nonConformanceId: zfd.text(z.string().optional()),
  openDate: z.string().min(1, { message: "Open date is required" }),
  dueDate: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional()),
  // Optional affected Parts/Tools to attach at create time — each is added as a
  // Version affected item (Buy items coerced to Revision service-side). More can
  // be added later on the CO detail. Only consumed by the create action.
  affectedItemIds: zfd.repeatableOfType(z.string()).optional()
});

// Status transition (used by the $id.status route). fromStatus drives a
// compare-and-swap so a stale/concurrent transition is rejected.
export const changeOrderStatusValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  fromStatus: z.enum(changeOrderStatus),
  status: z.enum(changeOrderStatus),
  assignee: zfd.text(z.string().optional())
});

// =============================================================================
// Top-to-bottom change content (v2) — affected items + per-item change type +
// cutover + manual supersession. The user selects affected parts first; each
// part's edits live on a REAL CO-owned Draft make method edited via the normal
// BillOfMaterial/BillOfProcess/PartProperties editors (no staged mirror tables).
// All validators are flat objects (no discriminated unions / heavy generics) to
// stay clear of TS2589 when threaded through @carbon/form's `validator()`.
// =============================================================================

// Affected item — the part the user selects to change. Adding one creates a
// CO-owned Draft make method per the change type (service side).
export const changeOrderAffectedItemValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  changeType: z.enum(changeOrderChangeTypes).default("Version"),
  // Optional revision label for a Revision change (e.g. "A"). Blank → the next
  // revision is auto-computed server-side (createChangeOrderDraftMethod).
  revision: zfd.text(z.string().optional())
});

// Add-affected-item path for a net-new "New Part" (no existing itemId): the CO
// mints a brand-new inactive Part and adds it as a New Part affected item. Always
// a Part (no Part/Tool choice in the modal).
export const changeOrderNewPartValidator = z.object({
  changeOrderId: z.string().min(1, { message: "Change order is required" }),
  // The route branches on this raw FormData value; also seeds the change-type
  // Select so it reads "New Part" after the form remounts (see AffectedItemForm).
  changeType: z.enum(changeOrderChangeTypes).default("New Part"),
  readableId: z.string().min(1, { message: "Part number is required" }),
  name: z.string().min(1, { message: "Name is required" }),
  replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]).default("Make"),
  itemTrackingType: z.enum(itemTrackingTypes).default("Inventory")
});

// Switch the change type on an existing affected item (rebuilds its CO-owned
// Draft make method for the new type — see updateChangeOrderAffectedItemChangeType).
export const changeOrderAffectedItemChangeTypeValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  changeType: z.enum(changeOrderChangeTypes)
});

// Per-item revision cutover config (Q3): existence of the oldRev→newRev
// supersession is automatic at release; the user only tunes mode + dates here.
export const changeOrderAffectedItemCutoverValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  supersessionMode: z.enum(supersessionModes),
  discontinuationDate: zfd.text(z.string().optional()),
  successorEffectivityDate: zfd.text(z.string().optional())
});

// Action task status transition (Start / Complete / Reopen). Actions are
// instantiated from templates (see changeOrderRequiredAction); there's no
// freeform-create validator.
export const changeOrderActionStatusValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  status: z.enum(changeOrderTaskStatus)
});

// Configurable default actions (changeOrderRequiredAction templates) — the
// per-company set a new change order is seeded from. Configured like Issue Types.
export const changeOrderRequiredActionValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  active: zfd.checkbox()
});

// -----------------------------------------------------------------------------
// Diff types (Q5 git-style) — one shape reused for the pre-release "tips"
// (staged-vs-live) and the post-release revision redline (oldRev-vs-newRev).
// -----------------------------------------------------------------------------
export type MethodDiffStatus = "added" | "removed" | "modified" | "unchanged";

export type MethodDiffEntry<T> = {
  status: MethodDiffStatus;
  before: T | null;
  after: T | null;
  // Field-level changes for a "modified" entry: { field: { before, after } }.
  changedFields?: Record<string, { before: unknown; after: unknown }>;
};

// One operation's child-level diff (steps / parameters / tools), each bucket
// classified added/removed/modified/unchanged. Defined here (not in
// changeOrder.diff.ts) so ChangeOrderItemDiff can carry the operation tree
// without a circular import; changeOrder.diff.ts re-exports these for its own
// callers.
export type OperationChildrenDiff = {
  steps: MethodDiffEntry<Record<string, unknown>>[];
  parameters: MethodDiffEntry<Record<string, unknown>>[];
  tools: MethodDiffEntry<Record<string, unknown>>[];
};

// An operation diff entry, optionally carrying its child-level diff. A superset
// of MethodDiffEntry, so consumers typed against the base entry keep working.
export type OperationDiffEntry = MethodDiffEntry<Record<string, unknown>> & {
  children?: OperationChildrenDiff;
};

export type ChangeOrderItemDiff = {
  affectedItemId: string;
  itemId: string;
  materials: MethodDiffEntry<Record<string, unknown>>[];
  // Operations carry the optional child (steps/parameters/tools) diff so the
  // read-only diff viewer can render the BOP as a tree.
  operations: OperationDiffEntry[];
  attributes: MethodDiffEntry<Record<string, unknown>>[];
  // Supplier parts on a Revision/New Part draft item. Drafts start with none
  // (the source's suppliers aren't copied), so these surface as `added` entries.
  supplierParts: MethodDiffEntry<Record<string, unknown>>[];
};

// -----------------------------------------------------------------------------
// Change Order Types (the "Category" lookup — configured like Issue Types)
// -----------------------------------------------------------------------------
export const changeOrderTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" })
});
