import type { Database, Json } from "@carbon/database";
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
} from "../shared/shared.models";

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
    error: "Replenishment system is required"
  }),
  defaultMethodType: z.enum(methodType, {
    error: "Default method is required"
  }),
  itemTrackingType: z.enum(itemTrackingTypes, {
    error: "Part type is required"
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
  shelfLifeCalculateFromBom: zfd.checkbox()
});

// Common storage / shelf-life refines. Shared across all item-type
// validators. Default Storage Unit is optional for every type - users can
// set it later via the pickMethod UI once they know where the item lives.
const applyStorageAndShelfLifeRefines = <T extends z.ZodObject>(schema: T) => {
  const refined: z.ZodType<z.infer<T>, z.input<T>> = schema
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
    ) as unknown as z.ZodType<z.infer<T>, z.input<T>>;

  return refined;
};

export const configurationParameterGroupValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" })
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
    error: "Item type is required"
  }),
  kit: zfd.text(z.string().optional()).transform((value) => value === "true"),
  methodType: z.enum(methodType, {
    error: "Method type is required"
  }),
  sourcingType: z.enum(sourcingType, {
    error: "Sourcing type is required"
  }),
  itemId: z.string().optional(),
  methodOperationId: zfd.text(z.string().optional()),
  // description: z.string().min(1, { message: "Description is required" }),
  quantity: zfd.numeric(z.number().min(0)),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of Measure is required" }),
  // A location → storageUnitId map. The BoM web form submits it as a JSON string
  // (`<Hidden value={JSON.stringify(...)} />`); the MCP/API layer sends the object
  // map directly. `preprocess` accepts both — a string is JSON-parsed (a malformed
  // string stays a string and is REJECTED by the record below, never silently
  // stored) — and the input JSON Schema published to MCP is a clean object map.
  // `nullish` lets a caller omit it or send `null` to clear (the service applies
  // the create/update semantics: omitted → preserve on update / {} on create,
  // explicit null/{} → clear).
  storageUnitIds: z
    .preprocess(
      (val) => {
        if (typeof val !== "string") return val;
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      },
      z.record(z.string(), z.string())
    )
    .nullish()
});

export const methodOperationValidator = z
  .object({
    id: z.string().min(1, { message: "Operation ID is required" }),
    makeMethodId: z.string().min(0, { message: "Make method is required" }),
    order: zfd.numeric(z.number().min(0)),
    operationOrder: z.enum(methodOperationOrders, {
      error: "Operation order is required"
    }),
    operationType: z.enum(operationTypes, {
      error: "Operation type is required"
    }),
    processId: z.string().min(1, { message: "Process is required" }),
    workCenterId: zfd.text(z.string().optional()),
    procedureId: zfd.text(z.string().optional()),
    assemblyInstructionId: zfd.text(z.string().optional()),
    inspectionDocumentId: zfd.text(z.string().optional()),
    description: zfd.text(
      z.string().min(0, { message: "Description is required" })
    ),
    setupUnit: z
      .enum(standardFactorType, {
        error: "Setup unit is required"
      })
      .optional(),
    setupTime: zfd.numeric(z.number().min(0).optional()),
    laborUnit: z
      .enum(standardFactorType, {
        error: "Labor unit is required"
      })
      .optional(),
    laborTime: zfd.numeric(z.number().min(0).optional()),
    machineUnit: z
      .enum(standardFactorType, {
        error: "Machine unit is required"
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
      if (data.operationType !== "Outside Processing") {
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
      if (data.operationType !== "Outside Processing") {
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
      // Machine only applies to Process operations — Assembly and Inspection
      // are setup + labor work.
      if (data.operationType === "Process") {
        return !!data.machineUnit;
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
      if (data.operationType !== "Outside Processing") {
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
      if (data.operationType !== "Outside Processing") {
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
      if (data.operationType === "Process") {
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
      if (data.operationType === "Inspection") {
        return !!data.inspectionDocumentId;
      }
      return true;
    },
    {
      message: "Inspection Plan is required",
      path: ["inspectionDocumentId"]
    }
  );

export const itemCostValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  itemPostingGroupId: zfd.text(z.string().optional()),
  costingMethod: z.enum(itemCostingMethods, {
    error: "Costing method is required"
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
  name: z.string().trim().min(1, { message: "Name is required" }).max(255),
  description: z.string().optional()
});

export const itemPlanningValidator = z
  .object({
    itemId: z.string().min(1, { message: "Item ID is required" }),
    locationId: z.string().min(1, { message: "Location is required" }),
    reorderingPolicy: z.enum(itemReorderingPolicies, {
      error: "Reordering policy is required"
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
    description:
      "Plan and build with the successor; picking falls back to the old part only while the successor is out of stock"
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
    (data) =>
      data.supersessionMode && data.supersessionMode !== "Consume First"
        ? !!data.discontinuationDate
        : true,
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

export const predecessorSupersessionValidator = z
  .object({
    predecessorItemId: z.string().min(1, { message: "Part is required" }),
    supersessionMode: z.enum(supersessionModes),
    discontinuationDate: zfd.text(z.string().optional()),
    successorEffectivityDate: zfd.text(z.string().optional()),
    conversionFactor: zfd.numeric(z.number().positive().optional())
  })
  .refine((data) => data.supersessionMode !== "No Stock", {
    message: "No Stock has no successor; set it on the part itself",
    path: ["supersessionMode"]
  })
  .refine(
    (data) =>
      data.supersessionMode !== "Consume First"
        ? !!data.discontinuationDate
        : true,
    {
      message: "Discontinuation date is required",
      path: ["discontinuationDate"]
    }
  )
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
  name: z.string().trim().min(1, { message: "Name is required" }).max(255),
  materialFormId: z.string().min(1, { message: "Shape is required" })
});

export const materialFinishValidator = z.object({
  id: zfd.text(z.string().optional()),
  materialSubstanceId: z.string().min(1, { message: "Substance is required" }),
  name: z.string().trim().min(1, { message: "Name is required" }).max(255)
});

export const materialFormValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }).max(255),
  code: z.string().trim().min(1, { message: "Code is required" }).max(10)
});

export const materialGradeValidator = z.object({
  id: zfd.text(z.string().optional()),
  materialSubstanceId: z.string().min(1, { message: "Substance is required" }),
  name: z.string().trim().min(1, { message: "Name is required" }).max(255)
});

export const materialSubstanceValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }).max(255),
  code: z.string().trim().min(1, { message: "Code is required" }).max(10)
});

export const materialTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  materialSubstanceId: z.string().min(1, { message: "Substance is required" }),
  materialFormId: z.string().min(1, { message: "Shape is required" }),
  name: z.string().trim().min(1, { message: "Name is required" }).max(255),
  code: z.string().trim().min(1, { message: "Code is required" }).max(10)
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
        error: "Replenishment system is required"
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
  code: z.string().trim().min(1, { message: "Code is required" }).max(10),
  name: z.string().trim().min(1, { message: "Name is required" }).max(50)
});

export const itemRevisionStatus = [
  "Design",
  "Prototype",
  "Production",
  "Obsolete"
] as const;

// companySettings.plmReleaseControl
export const plmReleaseControl = ["off", "warn", "enforce"] as const;

// Error shape returned by the change notice service functions: either a real
// Supabase PostgrestError or a hand-built message (sequence/lookup failures that
// don't originate from a query). One alias so callers get a consistent contract.
export type ChangeNoticeError = PostgrestError | { message: string };

// =============================================================================
// Change Notices — validators, enums, and the stage state machine.
//
// A sub-area of the Items module, modeled on Quality. The header evolves the
// existing `changeOrder` table. v2: a CO's per-affected-item edits live on a
// REAL CO-owned Draft make method (no staged mirror tables); the change type
// drives the release action. Validators here cover the header, affected items +
// change type, cutover, manual supersession, and freeform actions.
// =============================================================================

// changeOrder.type — the legacy category enum on the header. Retained (the
// column still exists); the primary "Category" is `changeOrderTypeId` (a row in
// the changeNoticeType lookup, reseeded to Design improvement / Obsolescence /
// Cost reduction).
export const changeNoticeType = [
  "Engineering",
  "Manufacturing",
  "Documentation"
] as const;

// V1 stage flow (forward, one step at a time). Notifies on Start /
// Implementation / Done; silent on Draft / Engineering Complete. "Cancelled" is
// the off-ramp: a CO can be closed from any open stage and reopened to Draft.
export const changeNoticeStatus = [
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
export const changeNoticeStageFlow: (typeof changeNoticeStatus)[number][] = [
  "Draft",
  "Start",
  "Engineering Complete",
  "Implementation",
  "Done"
];

export const changeNoticeTaskStatus = [
  "Pending",
  "In Progress",
  "Completed",
  "Skipped"
] as const;

export const changeNoticeActionTaskOrigins = [
  "Template-owned",
  "Manual",
  "Impact follow-up"
] as const;
export type ChangeNoticeActionTaskOrigin =
  (typeof changeNoticeActionTaskOrigins)[number];

// =============================================================================
// Change Notice Operational Impact — Slice 1 contracts.
//
// These unions are deliberately closed. Operational Impact is a constrained
// read model for the three V1 target kinds, not a registry for arbitrary source
// tables or a second workflow state machine.
// =============================================================================

export const changeNoticeImpactTargetTypes = [
  "purchaseOrderLine",
  "job",
  "jobMaterial"
] as const;
export type ChangeNoticeImpactTargetType =
  (typeof changeNoticeImpactTargetTypes)[number];

export const changeNoticeImpactDecisionStatuses = [
  "No action required",
  "Action required",
  "Resolved"
] as const;
export type ChangeNoticeImpactDecisionStatus =
  (typeof changeNoticeImpactDecisionStatuses)[number];

/** Returned when a bulk browser preview no longer matches live source facts. */
export const CHANGE_NOTICE_IMPACT_BULK_PREVIEW_STALE_MESSAGE =
  "This Impact bulk preview is stale. Refresh and review the selected targets.";

export const changeNoticeImpactNoActionReasonCodes = [
  "Outside effectivity",
  "Not affected after review",
  "No purchasing intervention remains"
] as const;
export type ChangeNoticeImpactNoActionReasonCode =
  (typeof changeNoticeImpactNoActionReasonCodes)[number];

export const changeNoticeImpactExposureClassifications = [
  "Current operational exposure",
  "Historical reference",
  "No longer in current scope"
] as const;
export type ChangeNoticeImpactExposureClassification =
  (typeof changeNoticeImpactExposureClassifications)[number];

export const changeNoticeImpactSourceAvailabilities = [
  "Present",
  "Restricted",
  "Source deleted",
  "Unavailable"
] as const;
export type ChangeNoticeImpactSourceAvailability =
  (typeof changeNoticeImpactSourceAvailabilities)[number];

export const changeNoticeImpactFreshnessStatuses = [
  "Current",
  "Changed since assessment",
  "Unknown"
] as const;
export type ChangeNoticeImpactFreshnessStatus =
  (typeof changeNoticeImpactFreshnessStatuses)[number];

export const changeNoticeImpactCoverageStatuses = [
  "complete",
  "partial",
  "failed",
  "restricted"
] as const;
export type ChangeNoticeImpactCoverageStatus =
  (typeof changeNoticeImpactCoverageStatuses)[number];

export const changeNoticeImpactDecisionStatusValidator = z.enum(
  changeNoticeImpactDecisionStatuses
);
export const changeNoticeImpactNoActionReasonCodeValidator = z.enum(
  changeNoticeImpactNoActionReasonCodes
);
export const changeNoticeImpactTargetTypeValidator = z.enum(
  changeNoticeImpactTargetTypes
);

/**
 * The browser/API contract for one assessment. Company, actor, source access,
 * operation, event type, and the canonical snapshot are all server-owned. The
 * strict object is intentional: accepting an operation or client snapshot and
 * silently stripping it would make the contract look authoritative when it is
 * not.
 */
const changeNoticeImpactDecisionTargetRequestShape = {
  targetType: changeNoticeImpactTargetTypeValidator,
  targetId: z.string().min(1, { message: "Impact target is required" }),
  decisionStatus: changeNoticeImpactDecisionStatusValidator,
  noActionReasonCode: changeNoticeImpactNoActionReasonCodeValidator
    .nullable()
    .optional(),
  rationale: z.string().trim().nullable().optional(),
  resolutionNote: z.string().trim().nullable().optional(),
  confirmNoPurchasingInterventionRemains: z.boolean().optional(),
  expectedRevision: z.number().int().positive().nullable().optional()
};

export const changeNoticeImpactDecisionRequestValidator = z
  .object({
    changeNoticeId: z.string().min(1, { message: "Change notice is required" }),
    ...changeNoticeImpactDecisionTargetRequestShape
  })
  .strict();
export type ChangeNoticeImpactDecisionRequest = z.infer<
  typeof changeNoticeImpactDecisionRequestValidator
>;

/**
 * The browser form shape deliberately differs from the JSON request shape:
 * empty optional controls are omitted and numeric/checkbox values are decoded
 * from FormData before the server-authorized request boundary is called.
 */
export const changeNoticeImpactDecisionFormValidator = z
  .object({
    changeNoticeId: zfd.text(
      z.string().min(1, { message: "Change notice is required" })
    ),
    targetType: changeNoticeImpactTargetTypeValidator,
    targetId: z.string().min(1, { message: "Impact target is required" }),
    decisionStatus: changeNoticeImpactDecisionStatusValidator,
    noActionReasonCode: zfd.text(
      changeNoticeImpactNoActionReasonCodeValidator.optional()
    ),
    rationale: zfd.text(z.string().trim().optional()),
    resolutionNote: zfd.text(z.string().trim().optional()),
    confirmNoPurchasingInterventionRemains: zfd.checkbox(),
    expectedRevision: zfd.numeric(z.number().int().positive().optional())
  })
  .strict();
export type ChangeNoticeImpactDecisionFormValues = z.infer<
  typeof changeNoticeImpactDecisionFormValidator
>;

/**
 * A bulk request names every target explicitly. It deliberately has no maximum
 * selection size: authorization, complete preflight, and the one transaction
 * are the safety boundaries rather than an arbitrary count cap.
 */
export const changeNoticeImpactDecisionBulkTargetRequestValidator = z
  .object({
    ...changeNoticeImpactDecisionTargetRequestShape,
    /** Opaque server-issued source/eligibility proof from the browser preview. */
    expectedSnapshotFingerprint: z.string().trim().min(1).optional()
  })
  .strict();
export type ChangeNoticeImpactDecisionBulkTargetRequest = z.infer<
  typeof changeNoticeImpactDecisionBulkTargetRequestValidator
>;

export const changeNoticeImpactDecisionBulkRequestValidator = z
  .object({
    changeNoticeId: z.string().min(1, { message: "Change notice is required" }),
    targets: z
      .array(changeNoticeImpactDecisionBulkTargetRequestValidator)
      .min(1, { message: "At least one Impact target is required" })
  })
  .strict()
  .superRefine((input, context) => {
    const seen = new Set<string>();
    for (const [index, target] of input.targets.entries()) {
      const key = `${target.targetType}\u0000${target.targetId}`;
      if (seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targets", index, "targetId"],
          message: "Bulk Impact targets must be unique."
        });
      }
      seen.add(key);
    }
  });
export type ChangeNoticeImpactDecisionBulkRequest = z.infer<
  typeof changeNoticeImpactDecisionBulkRequestValidator
>;

const changeNoticeImpactDecisionBulkFormTargetValidator = z
  .object({
    targetType: changeNoticeImpactTargetTypeValidator,
    targetId: z.string().min(1, { message: "Impact target is required" }),
    expectedRevision: z.number().int().positive().nullable().optional(),
    expectedSnapshotFingerprint: z.string().trim().min(1)
  })
  .strict();
export type ChangeNoticeImpactDecisionBulkFormTarget = z.infer<
  typeof changeNoticeImpactDecisionBulkFormTargetValidator
>;

export const changeNoticeImpactDecisionBulkFormValidator = z
  .object({
    changeNoticeId: zfd.text(
      z.string().min(1, { message: "Change notice is required" })
    ),
    targets: zfd.text(
      z
        .string()
        .trim()
        .min(1, { message: "Selected Impact targets are required" })
        .transform((value, context) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(value);
          } catch {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Selected Impact targets are invalid."
            });
            return z.NEVER;
          }
          const validation = z
            .array(changeNoticeImpactDecisionBulkFormTargetValidator)
            .min(1, { message: "At least one Impact target is required" })
            .safeParse(parsed);
          if (!validation.success) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                validation.error.issues[0]?.message ??
                "Selected Impact targets are invalid."
            });
            return z.NEVER;
          }
          return validation.data;
        })
    ),
    decisionStatus: zfd.text(changeNoticeImpactDecisionStatusValidator),
    noActionReasonCode: zfd.text(
      changeNoticeImpactNoActionReasonCodeValidator.optional()
    ),
    rationale: zfd.text(z.string().trim().optional()),
    resolutionNote: zfd.text(z.string().trim().optional()),
    confirmNoPurchasingInterventionRemains: zfd.checkbox()
  })
  .strict();
export type ChangeNoticeImpactDecisionBulkFormValues = z.infer<
  typeof changeNoticeImpactDecisionBulkFormValidator
>;

/** Internal operation labels. Callers never submit one of these values. */
export const changeNoticeImpactDecisionOperations = [
  "createDecision",
  "reassessDecision",
  "correctDecision",
  "reopenDecision",
  "resolveActionRequired",
  "updateDecision",
  "noOp"
] as const;
export type ChangeNoticeImpactDecisionOperation =
  (typeof changeNoticeImpactDecisionOperations)[number];

/**
 * Classify the lifecycle operation from persisted state and the requested
 * conclusion. This helper deliberately has no public input field for the
 * operation; it is used by the server after loading the current row.
 */
export function deriveChangeNoticeImpactDecisionOperation(input: {
  existingStatus: ChangeNoticeImpactDecisionStatus | null;
  requestedStatus: ChangeNoticeImpactDecisionStatus;
}): ChangeNoticeImpactDecisionOperation {
  if (input.existingStatus === null) return "createDecision";
  if (input.existingStatus === input.requestedStatus) return "updateDecision";
  if (
    input.existingStatus === "Resolved" &&
    input.requestedStatus === "Action required"
  ) {
    return "reopenDecision";
  }
  if (
    input.existingStatus === "Action required" &&
    input.requestedStatus === "Resolved"
  ) {
    return "resolveActionRequired";
  }
  if (
    (input.existingStatus === "Action required" ||
      input.existingStatus === "Resolved") &&
    input.requestedStatus === "No action required"
  ) {
    return "correctDecision";
  }
  return "reassessDecision";
}

export const purchaseOrderLineImpactItemTypes = [
  "Part",
  "Material",
  "Tool",
  "Consumable",
  "Fixture"
] as const;
export type PurchaseOrderLineImpactItemType =
  (typeof purchaseOrderLineImpactItemTypes)[number];

export const purchaseOrderLineImpactNonAssessmentTypes = [
  "Comment",
  "G/L Account",
  "Fixed Asset",
  "Service"
] as const;

export const purchaseOrderLineImpactCurrentStatuses = [
  "Draft",
  "Planned",
  "Needs Approval",
  "To Review",
  "To Receive",
  "To Receive and Invoice",
  "To Invoice"
] as const;
export type PurchaseOrderLineImpactCurrentStatus =
  (typeof purchaseOrderLineImpactCurrentStatuses)[number];

export const purchaseOrderLineImpactHistoricalStatuses = [
  "Completed",
  "Closed",
  "Rejected"
] as const;
export type PurchaseOrderLineImpactHistoricalStatus =
  (typeof purchaseOrderLineImpactHistoricalStatuses)[number];

export const jobImpactActiveStatuses = [
  "Draft",
  "Planned",
  "Ready",
  "In Progress",
  "Paused"
] as const;
export type JobImpactActiveStatus = (typeof jobImpactActiveStatuses)[number];

export const jobImpactHistoricalStatuses = [
  "Completed",
  "Closed",
  "Cancelled"
] as const;
export type JobImpactHistoricalStatus =
  (typeof jobImpactHistoricalStatuses)[number];

export const PO_LINE_SNAPSHOT_V1 = "PO_LINE_SNAPSHOT_V1" as const;
export const JOB_SNAPSHOT_V1 = "JOB_SNAPSHOT_V1" as const;
export const JOB_MATERIAL_SNAPSHOT_V1 = "JOB_MATERIAL_SNAPSHOT_V1" as const;

export const OPEN_PURCHASING_COMMITMENT = "openPurchasingCommitment" as const;
export const ACTIVE_PRODUCING_JOB = "activeProducingJob" as const;
export const ACTIVE_JOB_MATERIAL = "activeJobMaterial" as const;

export type ChangeNoticeImpactEffectivityProof = {
  complete: boolean;
  decisionRelevant: boolean;
  outsideEffectivity: boolean;
  ambiguous: boolean;
};

export type ChangeNoticeImpactPurchasingInterventionConfirmation = {
  supplierReturnReviewed: boolean;
  replacementReviewed: boolean;
  creditReviewed: boolean;
  communicationReviewed: boolean;
  noInterventionRemains: boolean;
};

export type ChangeNoticeImpactReasonValidation =
  | { valid: true }
  | { valid: false; message: string };

export type ChangeNoticeImpactFirstAssessmentValidation =
  | {
      valid: true;
      noActionReasonCode: ChangeNoticeImpactNoActionReasonCode | null;
      rationale: string | null;
      resolutionNote: string | null;
    }
  | { valid: false; message: string };

/**
 * Validate the state-specific part of a first assessment. Source availability,
 * exposure, lifecycle, and the canonical snapshot are deliberately checked by
 * the server after it reloads the live rows.
 */
export function validateChangeNoticeImpactFirstAssessment(input: {
  targetType: ChangeNoticeImpactTargetType;
  decisionStatus: ChangeNoticeImpactDecisionStatus;
  noActionReasonCode?: ChangeNoticeImpactNoActionReasonCode | null;
  rationale?: string | null;
  resolutionNote?: string | null;
  confirmNoPurchasingInterventionRemains?: boolean;
  expectedRevision?: number | null;
}): ChangeNoticeImpactFirstAssessmentValidation {
  const rationale = input.rationale?.trim() ?? "";
  const resolutionNote = input.resolutionNote?.trim() ?? "";
  const reason = input.noActionReasonCode ?? null;

  if (input.expectedRevision !== undefined && input.expectedRevision !== null) {
    return {
      valid: false,
      message:
        "First assessments must not include an expected decision revision."
    };
  }

  if (input.decisionStatus !== "Resolved" && resolutionNote.length > 0) {
    return {
      valid: false,
      message: "Resolution notes are only valid for a Resolved decision."
    };
  }

  if (input.decisionStatus !== "No action required") {
    if (input.confirmNoPurchasingInterventionRemains !== undefined) {
      return {
        valid: false,
        message:
          "Purchasing intervention confirmation is only valid for a No action required decision."
      };
    }
  }

  if (input.decisionStatus === "No action required") {
    if (reason === null) {
      return {
        valid: false,
        message: "No action required needs a reason."
      };
    }
    if (reason === "Outside effectivity") {
      return {
        valid: false,
        message:
          "Outside effectivity is unavailable until Carbon can provide authoritative applicability evidence."
      };
    }
    if (reason === "Not affected after review" && rationale.length === 0) {
      return {
        valid: false,
        message: "Not affected after review requires written rationale."
      };
    }
    if (
      reason === "No purchasing intervention remains" &&
      input.targetType !== "purchaseOrderLine"
    ) {
      return {
        valid: false,
        message:
          "No purchasing intervention remains applies only to purchase order lines."
      };
    }
    if (
      reason !== "No purchasing intervention remains" &&
      input.confirmNoPurchasingInterventionRemains !== undefined
    ) {
      return {
        valid: false,
        message:
          "Purchasing intervention confirmation is only valid for No purchasing intervention remains."
      };
    }
    if (
      reason === "No purchasing intervention remains" &&
      input.confirmNoPurchasingInterventionRemains !== true
    ) {
      return {
        valid: false,
        message:
          "No purchasing intervention remains requires explicit confirmation that no supplier return, replacement, credit, or communication intervention remains."
      };
    }
    if (
      (reason === "Not affected after review" ||
        reason === "No purchasing intervention remains") &&
      rationale.length === 0
    ) {
      return {
        valid: false,
        message: `${reason} requires written rationale.`
      };
    }
  } else if (reason !== null) {
    return {
      valid: false,
      message:
        "No Action reason is only valid for a No action required decision."
    };
  }

  if (input.decisionStatus === "Action required" && rationale.length === 0) {
    return {
      valid: false,
      message: "Action required needs written follow-up rationale."
    };
  }

  if (input.decisionStatus === "Resolved" && resolutionNote.length === 0) {
    return {
      valid: false,
      message: "Resolved requires written closure evidence."
    };
  }

  return {
    valid: true,
    noActionReasonCode: reason,
    rationale: rationale.length > 0 ? rationale : null,
    resolutionNote: resolutionNote.length > 0 ? resolutionNote : null
  };
}

/**
 * Validate No Action semantics without creating a decision or mutating any
 * source/Impact row. Historical evidence is intentionally not a reason.
 */
export function validateChangeNoticeImpactNoActionReason(input: {
  targetType: ChangeNoticeImpactTargetType;
  reasonCode: ChangeNoticeImpactNoActionReasonCode;
  exposureClassification: ChangeNoticeImpactExposureClassification;
  rationale?: string | null;
  effectivityProof?: ChangeNoticeImpactEffectivityProof;
  purchasingInterventionConfirmation?: ChangeNoticeImpactPurchasingInterventionConfirmation | null;
}): ChangeNoticeImpactReasonValidation {
  if (input.exposureClassification !== "Current operational exposure") {
    return {
      valid: false,
      message: "No Action reasons require a current operational exposure."
    };
  }

  const rationale = input.rationale?.trim() ?? "";

  switch (input.reasonCode) {
    case "Outside effectivity":
      if (
        !input.effectivityProof?.complete ||
        !input.effectivityProof.decisionRelevant ||
        !input.effectivityProof.outsideEffectivity
      ) {
        return {
          valid: false,
          message:
            "Outside effectivity requires a complete, decision-relevant applicability proof."
        };
      }
      if (input.effectivityProof.ambiguous && rationale.length === 0) {
        return {
          valid: false,
          message:
            "Ambiguous outside-effectivity evidence requires written rationale."
        };
      }
      return { valid: true };
    case "Not affected after review":
      return rationale.length > 0
        ? { valid: true }
        : {
            valid: false,
            message: "Not affected after review requires written rationale."
          };
    case "No purchasing intervention remains": {
      if (input.targetType !== "purchaseOrderLine") {
        return {
          valid: false,
          message:
            "No purchasing intervention remains applies only to purchase order lines."
        };
      }
      const confirmation = input.purchasingInterventionConfirmation;
      if (
        !confirmation?.supplierReturnReviewed ||
        !confirmation.replacementReviewed ||
        !confirmation.creditReviewed ||
        !confirmation.communicationReviewed ||
        !confirmation.noInterventionRemains
      ) {
        return {
          valid: false,
          message:
            "No purchasing intervention remains requires explicit confirmation that supplier return, replacement, credit, and communication intervention do not remain."
        };
      }
      return rationale.length > 0
        ? { valid: true }
        : {
            valid: false,
            message:
              "No purchasing intervention remains requires written rationale."
          };
    }
  }
}

// =============================================================================
// Change Notice Operational Impact — Slice 1 read contracts.
//
// Kept next to the closed product contracts so the service layer does not need
// to import the broad Items type barrel (which also infers many service return
// types).
// =============================================================================

export type ChangeNoticeImpactSourceAccess = {
  purchaseOrderLine: boolean;
  job: boolean;
  jobMaterial: boolean;
};

export type ChangeNoticeImpactSourceAccessResult =
  | {
      status: "resolved";
      access: ChangeNoticeImpactSourceAccess;
    }
  | {
      status: "failed";
      errorMessage: string;
    };

export type PurchaseOrderLineImpactSnapshot = {
  schema: "PO_LINE_SNAPSHOT_V1";
  purchaseOrderLineId: string;
  purchaseOrderId: string;
  supplierId: string;
  itemId: string;
  itemRevision: string | null;
  purchaseOrderLineType: Database["public"]["Enums"]["purchaseOrderLineType"];
  purchaseOrderStatus:
    | "Draft"
    | "Planned"
    | "Needs Approval"
    | "To Review"
    | "To Receive"
    | "To Receive and Invoice"
    | "To Invoice"
    | "Completed"
    | "Closed"
    | "Rejected";
  receivedComplete: boolean;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  purchaseUnitOfMeasureCode: string | null;
  inventoryUnitOfMeasureCode: string | null;
  conversionFactor: number;
  requiredDate: string | null;
  promisedDate: string | null;
  eligibilityBasis: "openPurchasingCommitment";
};

export type JobImpactSnapshot = {
  schema: "JOB_SNAPSHOT_V1";
  jobId: string;
  itemId: string;
  itemRevision: string | null;
  status:
    | "Draft"
    | "Planned"
    | "Ready"
    | "In Progress"
    | "Paused"
    | "Completed"
    | "Closed"
    | "Cancelled";
  plannedQuantity: number;
  completedQuantity: number;
  remainingQuantity: number;
  quantityShipped: number;
  quantityReceivedToInventory: number;
  dueDate: string | null;
  effectiveMethodId: string;
  effectiveMethodVersion: number;
  unitOfMeasureCode: string;
  eligibilityBasis: "activeProducingJob";
};

export type JobMaterialImpactSnapshot = {
  schema: "JOB_MATERIAL_SNAPSHOT_V1";
  jobMaterialId: string;
  jobId: string;
  itemId: string;
  itemRevision: string | null;
  jobStatus:
    | "Draft"
    | "Planned"
    | "Ready"
    | "In Progress"
    | "Paused"
    | "Completed"
    | "Closed"
    | "Cancelled";
  requiredQuantity: number;
  issuedQuantity: number | null;
  remainingQuantity: number;
  unitOfMeasureCode: string | null;
  methodType: Database["public"]["Enums"]["methodType"];
  jobOperationId: string | null;
  requiresTracking: {
    batch: boolean;
    serial: boolean;
  };
  eligibilityBasis: "activeJobMaterial";
};

export type ChangeNoticeImpactSnapshot =
  | PurchaseOrderLineImpactSnapshot
  | JobImpactSnapshot
  | JobMaterialImpactSnapshot;

// Browser-safe snapshot projection. Canonical snapshots retain source and
// operation identifiers for persistence, comparison, and guarded writes; the
// read-only workspace only needs the decision-relevant display facts.
export type ChangeNoticeImpactWorkspaceSnapshot =
  | Omit<
      PurchaseOrderLineImpactSnapshot,
      "purchaseOrderLineId" | "purchaseOrderId" | "supplierId" | "itemId"
    >
  | Omit<JobImpactSnapshot, "jobId" | "itemId" | "effectiveMethodId">
  | Omit<
      JobMaterialImpactSnapshot,
      "jobMaterialId" | "jobId" | "itemId" | "jobOperationId"
    >;

export type ChangeNoticeImpactDecisionMutationInput =
  ChangeNoticeImpactDecisionRequest & {
    /** Optional only for the legacy/raw bulk boundary; browser bulk forms require it. */
    expectedSnapshotFingerprint?: string;
    /** Server-derived tenant and actor context. */
    companyId: string;
    userId: string;
    /** Resolved from the actor's source-domain view permissions. */
    sourceAccess: ChangeNoticeImpactSourceAccess;
  };

export type ChangeNoticeImpactDecisionBulkMutationInput =
  ChangeNoticeImpactDecisionBulkRequest & {
    /** Server-derived tenant and actor context. */
    companyId: string;
    userId: string;
    /** Resolved from the actor's source-domain view permissions. */
    sourceAccess: ChangeNoticeImpactSourceAccess;
  };

export type ChangeNoticeImpactDecisionWriteData = {
  /** Derived by the server from persisted state, never supplied by a caller. */
  operation: ChangeNoticeImpactDecisionOperation;
  decision: {
    id: string;
    targetType: ChangeNoticeImpactTargetType;
    targetId: string;
    decisionStatus: ChangeNoticeImpactDecisionStatus;
    noActionReasonCode: ChangeNoticeImpactNoActionReasonCode | null;
    rationale: string | null;
    resolutionNote: string | null;
    assessmentSnapshot: ChangeNoticeImpactSnapshot;
    snapshotVersion: number;
    assessedBy: string;
    assessedAt: string;
    revision: number;
  };
};

export type ChangeNoticeImpactDecisionWriteResult = {
  data: ChangeNoticeImpactDecisionWriteData | null;
  error: { message: string } | null;
};

export type ChangeNoticeImpactDecisionBulkWriteData = {
  changeNoticeId: string;
  selectedCount: number;
  appliedCount: number;
  noOpCount: number;
};

export type ChangeNoticeImpactDecisionBulkWriteResult = {
  data: ChangeNoticeImpactDecisionBulkWriteData | null;
  error: { message: string } | null;
};

export type ChangeNoticeImpactTaskDecisionReference = {
  decisionId: string;
  targetType: ChangeNoticeImpactTargetType;
  targetId: string;
};

export type ChangeNoticeImpactTaskFields = {
  name?: string;
  notes?: Json | null;
  assignee?: string | null;
  dueDate?: string | null;
};

export type ChangeNoticeImpactTaskCreateRequest = {
  changeNoticeId: string;
  targetType: ChangeNoticeImpactTargetType;
  targetId: string;
  decision?: ChangeNoticeImpactTaskDecisionReference;
  bootstrapDecision?: {
    decisionStatus: "Action required";
    rationale: string;
  };
  task: ChangeNoticeImpactTaskFields;
};

export type ChangeNoticeImpactTaskRelationshipRequest =
  ChangeNoticeImpactTaskDecisionReference & {
    actionTaskId: string;
  };

export type ChangeNoticeImpactTaskCreateMutationInput =
  ChangeNoticeImpactTaskCreateRequest & {
    /** Server-derived tenant and actor context. */
    companyId: string;
    userId: string;
    /** Resolved from the actor's source-domain view permissions. */
    sourceAccess: ChangeNoticeImpactSourceAccess;
  };

export type ChangeNoticeImpactTaskRelationshipMutationInput =
  ChangeNoticeImpactTaskRelationshipRequest & {
    changeNoticeId: string;
    /** Server-derived tenant and actor context. */
    companyId: string;
    userId: string;
    /** Resolved from the actor's source-domain view permissions. */
    sourceAccess: ChangeNoticeImpactSourceAccess;
  };

export type ChangeNoticeImpactTaskCreateData = {
  decisionId: string;
  actionTaskId: string;
  decisionCreated: boolean;
  taskOrigin: "Impact follow-up";
  status: (typeof changeNoticeTaskStatus)[number];
};

export type ChangeNoticeImpactTaskRelationshipData = {
  decisionId: string;
  actionTaskId: string;
  changed: boolean;
};

export type ChangeNoticeImpactTaskDesignationData =
  ChangeNoticeImpactTaskRelationshipData & {
    previousTaskOrigin: ChangeNoticeActionTaskOrigin;
    taskOrigin: "Impact follow-up";
  };

export type ChangeNoticeImpactTaskCreateResult = {
  data: ChangeNoticeImpactTaskCreateData | null;
  error: { message: string } | null;
};

export type ChangeNoticeImpactTaskRelationshipResult = {
  data: ChangeNoticeImpactTaskRelationshipData | null;
  error: { message: string } | null;
};

export type ChangeNoticeImpactTaskDesignationResult = {
  data: ChangeNoticeImpactTaskDesignationData | null;
  error: { message: string } | null;
};

export const changeNoticeImpactTaskDecisionReferenceValidator = z
  .object({
    decisionId: z.string().min(1, { message: "Decision is required" }),
    targetType: changeNoticeImpactTargetTypeValidator,
    targetId: z.string().min(1, { message: "Impact target is required" })
  })
  .strict();

/**
 * Impact task notes cross the browser/API boundary as a JSON object. This is a
 * narrow shape check, not a ProseMirror/Tiptap schema validator — the browser
 * editor owns the document semantics. Without the predicate, `z.custom<Json>()`
 * accepts anything and the API/MCP create path can store a string or array where
 * the browser sends an object.
 */
export function isJsonObjectTaskNotes(value: unknown): value is Json {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
}

const changeNoticeImpactTaskFieldsValidator = z
  .object({
    name: z.string().trim().min(1).optional(),
    notes: z.custom<Json>(isJsonObjectTaskNotes).nullable().optional(),
    assignee: z.string().trim().nullable().optional(),
    dueDate: z.string().trim().nullable().optional()
  })
  .strict();

export const changeNoticeImpactTaskCreateRequestValidator = z
  .object({
    changeNoticeId: z.string().min(1, { message: "Change notice is required" }),
    targetType: changeNoticeImpactTargetTypeValidator,
    targetId: z.string().min(1, { message: "Impact target is required" }),
    decision: changeNoticeImpactTaskDecisionReferenceValidator.optional(),
    bootstrapDecision: z
      .object({
        decisionStatus: z.literal("Action required"),
        rationale: z.string().trim().min(1, {
          message: "Action required needs written follow-up rationale."
        })
      })
      .strict()
      .optional(),
    task: changeNoticeImpactTaskFieldsValidator
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.decision ? 1 : 0) + (input.bootstrapDecision ? 1 : 0) !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision"],
        message:
          "Impact task creation requires an existing decision or an Action Required bootstrap."
      });
    }
    if (
      input.decision &&
      (input.decision.targetType !== input.targetType ||
        input.decision.targetId !== input.targetId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision"],
        message:
          "Impact task decision target does not match the requested target."
      });
    }
  });

export const changeNoticeImpactTaskRelationshipRequestValidator = z
  .object({
    decisionId: z.string().min(1, { message: "Decision is required" }),
    targetType: changeNoticeImpactTargetTypeValidator,
    targetId: z.string().min(1, { message: "Impact target is required" }),
    actionTaskId: z.string().min(1, { message: "Action task is required" })
  })
  .strict();

export const changeNoticeImpactTaskCreateFormValidator = z
  .object({
    decisionId: zfd.text(z.string().trim().min(1).optional()),
    targetType: changeNoticeImpactTargetTypeValidator,
    targetId: z.string().min(1, { message: "Impact target is required" }),
    bootstrapRationale: zfd.text(z.string().trim().min(1).optional()),
    name: zfd.text(z.string().trim().min(1).optional()),
    notes: zfd.text(z.string().optional()),
    assignee: zfd.text(z.string().trim().min(1).optional()),
    dueDate: zfd.text(z.string().trim().min(1).optional())
  })
  .superRefine((input, context) => {
    if ((input.decisionId ? 1 : 0) + (input.bootstrapRationale ? 1 : 0) !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionId"],
        message:
          "Impact task creation requires an existing decision or an Action Required bootstrap."
      });
    }
  });

export const changeNoticeImpactTaskRelationshipFormValidator = z.object({
  decisionId: z.string().min(1, { message: "Decision is required" }),
  targetType: changeNoticeImpactTargetTypeValidator,
  targetId: z.string().min(1, { message: "Impact target is required" }),
  actionTaskId: z.string().min(1, { message: "Action task is required" })
});

export type ChangeNoticeImpactProvenanceReconciliationInput = {
  /** Server-derived tenant and actor context. */
  companyId: string;
  userId: string;
  changeNoticeId: string;
  /** Resolved from the actor's source-domain view permissions. */
  sourceAccess: ChangeNoticeImpactSourceAccess;
};

export type ChangeNoticeImpactProvenanceReconciliationData = {
  changeNoticeId: string;
  changeNoticeStatus: Database["public"]["Enums"]["changeOrderStatus"];
  started: number;
  ended: number;
  /** Domain names only; target identities from restricted domains are omitted. */
  restrictedTargetTypes: ChangeNoticeImpactTargetType[];
};

export type ChangeNoticeImpactProvenanceReconciliationResult = {
  data: ChangeNoticeImpactProvenanceReconciliationData | null;
  error: { message: string } | null;
};

export type ChangeNoticeImpactSnapshotNormalization =
  | {
      sourceAvailability: "Present";
      snapshot: ChangeNoticeImpactSnapshot;
    }
  | {
      sourceAvailability: "Unavailable";
      snapshot: null;
      reason: string;
    };

export type ChangeNoticeImpactPurchaseOrderLineSnapshotInput = {
  purchaseOrderLineId?: unknown;
  id?: unknown;
  purchaseOrderId?: unknown;
  supplierId?: unknown;
  itemId?: unknown;
  itemRevision?: unknown;
  purchaseOrderLineType?: unknown;
  purchaseOrderStatus?: unknown;
  receivedComplete?: unknown;
  purchaseQuantity?: unknown;
  quantityReceived?: unknown;
  quantityToReceive?: unknown;
  purchaseUnitOfMeasureCode?: unknown;
  inventoryUnitOfMeasureCode?: unknown;
  conversionFactor?: unknown;
  requiredDate?: unknown;
  promisedDate?: unknown;
  linePromisedDate?: unknown;
  deliveryReceiptPromisedDate?: unknown;
  /** Required parent-delivery hydration marker supplied by live discovery. */
  deliveryRowPresent?: unknown;
};

export type ChangeNoticeImpactJobSnapshotInput = {
  jobId?: unknown;
  id?: unknown;
  itemId?: unknown;
  itemRevision?: unknown;
  status?: unknown;
  plannedQuantity?: unknown;
  quantity?: unknown;
  completedQuantity?: unknown;
  quantityComplete?: unknown;
  remainingQuantity?: unknown;
  quantityShipped?: unknown;
  quantityReceivedToInventory?: unknown;
  dueDate?: unknown;
  effectiveMethodId?: unknown;
  effectiveMethodVersion?: unknown;
  unitOfMeasureCode?: unknown;
};

export type ChangeNoticeImpactJobMaterialSnapshotInput = {
  jobMaterialId?: unknown;
  id?: unknown;
  jobId?: unknown;
  itemId?: unknown;
  itemRevision?: unknown;
  jobStatus?: unknown;
  requiredQuantity?: unknown;
  estimatedQuantity?: unknown;
  issuedQuantity?: unknown;
  quantityIssued?: unknown;
  remainingQuantity?: unknown;
  quantityToIssue?: unknown;
  unitOfMeasureCode?: unknown;
  methodType?: unknown;
  jobOperationId?: unknown;
  requiresTracking?: unknown;
  requiresBatchTracking?: unknown;
  requiresSerialTracking?: unknown;
};

export type ChangeNoticeImpactProvenance = {
  affectedItemId: string;
  affectedItemSourceId: string;
  /** Null means the source label was not available; the UI localizes its fallback. */
  affectedItemLabel: string | null;
  status: "Current" | "Historical";
  endedReason: string | null;
};

export type ChangeNoticeImpactParentContext =
  | {
      type: "purchaseOrder";
      id: string;
      readableId: string;
      status: string;
      supplierName: string | null;
    }
  | {
      type: "job";
      id: string;
      readableId: string;
      status: string;
    };

export type ChangeNoticeImpactItemContext = {
  id: string;
  readableId: string | null;
  readableIdWithRevision: string | null;
  revision: string | null;
  unitOfMeasureCode: string | null;
};

export type ChangeNoticeImpactDecisionProjection = {
  id: string;
  status: ChangeNoticeImpactDecisionStatus;
  decisionStatus: ChangeNoticeImpactDecisionStatus;
  noActionReasonCode: ChangeNoticeImpactNoActionReasonCode | null;
  rationale: string | null;
  resolutionNote: string | null;
  revision: number;
  snapshotVersion: number;
  persistedSnapshot: ChangeNoticeImpactSnapshot | null;
};

export type ChangeNoticeImpactCandidate = {
  targetType: ChangeNoticeImpactTargetType;
  targetId: string;
  parent: ChangeNoticeImpactParentContext | null;
  item: ChangeNoticeImpactItemContext | null;
  currentSnapshot: ChangeNoticeImpactSnapshot | null;
  currentProvenance: ChangeNoticeImpactProvenance[];
  historicalProvenance: ChangeNoticeImpactProvenance[];
  provenance: ChangeNoticeImpactProvenance[];
  exposureClassification: ChangeNoticeImpactExposureClassification | null;
  sourceAvailability: ChangeNoticeImpactSourceAvailability;
  unavailableReason: string | null;
  decision: ChangeNoticeImpactDecisionProjection | null;
  freshness: ChangeNoticeImpactFreshnessStatus | null;
};

// Read-only projection of an existing Change Notice action task linked to an
// Impact decision. Task lifecycle remains independent from the decision state.
export type ChangeNoticeImpactTaskLink = {
  decisionId: string;
  actionTaskId: string;
  name: string | null;
  status: (typeof changeNoticeTaskStatus)[number];
  assignee: string | null;
  dueDate: string | null;
  taskOrigin: string;
};

export type ChangeNoticeImpactTaskCoverage = {
  status: "complete" | "partial" | "failed";
  errorMessage?: string;
};

export type ChangeNoticeImpactWorkspaceDecisionProjection = Omit<
  ChangeNoticeImpactDecisionProjection,
  "persistedSnapshot"
> & {
  persistedSnapshot: ChangeNoticeImpactWorkspaceSnapshot | null;
};

export type ChangeNoticeImpactWorkspaceCandidate = Omit<
  ChangeNoticeImpactCandidate,
  "currentSnapshot" | "decision"
> & {
  currentSnapshot: ChangeNoticeImpactWorkspaceSnapshot | null;
  decision: ChangeNoticeImpactWorkspaceDecisionProjection | null;
  /** Opaque proof that the reviewed source facts and current cause were read together. */
  previewFingerprint: string | null;
  taskLinks: ChangeNoticeImpactTaskLink[];
};

export type ChangeNoticeImpactWorkspaceReadModel = Omit<
  ChangeNoticeImpactCandidateReadModel,
  "candidates"
> & {
  candidates: ChangeNoticeImpactWorkspaceCandidate[];
  taskCoverage: ChangeNoticeImpactTaskCoverage;
};

export type ChangeNoticeImpactWorkspaceReadResult = {
  data: ChangeNoticeImpactWorkspaceReadModel | null;
  error: { message: string } | null;
};

// Browser-safe, lazy history projection. Source and database identifiers stay
// behind the service boundary; only the task id is retained so the workspace
// can resolve it against its already-authorized action collection.
export type ChangeNoticeImpactHistoryProvenance = {
  affectedItemLabel: string | null;
  endedAt: string | null;
  endedReason: string | null;
};

export type ChangeNoticeImpactHistorySnapshotStatus =
  | "present"
  | "absent"
  | "unavailable";

export type ChangeNoticeImpactHistoryEntry = {
  id: string;
  eventType: string;
  previousStatus: ChangeNoticeImpactDecisionStatus | null;
  newStatus: ChangeNoticeImpactDecisionStatus | null;
  previousReasonCode: ChangeNoticeImpactNoActionReasonCode | null;
  newReasonCode: ChangeNoticeImpactNoActionReasonCode | null;
  previousSnapshot: ChangeNoticeImpactWorkspaceSnapshot | null;
  previousSnapshotStatus: ChangeNoticeImpactHistorySnapshotStatus;
  newSnapshot: ChangeNoticeImpactWorkspaceSnapshot | null;
  newSnapshotStatus: ChangeNoticeImpactHistorySnapshotStatus;
  rationale: string | null;
  resolutionNote: string | null;
  priorAssessmentWasChanged: boolean;
  relatedActionTaskId: string | null;
  provenance: ChangeNoticeImpactHistoryProvenance | null;
  createdBy: string;
  createdAt: string;
};

export type ChangeNoticeImpactHistoryReadModel = {
  entries: ChangeNoticeImpactHistoryEntry[];
};

export type ChangeNoticeImpactHistoryReadErrorKind =
  | "not-found"
  | "restricted"
  | "unavailable";

export type ChangeNoticeImpactHistoryReadResult = {
  data: ChangeNoticeImpactHistoryReadModel | null;
  error: {
    kind: ChangeNoticeImpactHistoryReadErrorKind;
    message: string;
  } | null;
};

export type ChangeNoticeImpactDomainCursor = {
  // undefined = never started, string = continuation, null = exhausted.
  current?: string | null;
  historical?: string | null;
};

export type ChangeNoticeImpactCoverage = {
  targetType: ChangeNoticeImpactTargetType;
  status: ChangeNoticeImpactCoverageStatus;
  currentExposureCount: number | null;
  historicalReferenceCount: number | null;
  unassessedCount: number | null;
  errorMessage?: string;
  nextCursor: {
    current: string | null;
    historical: string | null;
  };
};

export type ChangeNoticeImpactCandidateOptions = {
  sourceAccess:
    | ChangeNoticeImpactSourceAccess
    | ChangeNoticeImpactSourceAccessResult;
  limit?: number;
  pageSize?: number;
  /**
   * Materialize the bounded workspace window in one candidate read instead of
   * returning one regular page. The service caps this at its workspace page
   * budget; it is not an unbounded result request.
   */
  fetchAll?: boolean;
  cursor?: Partial<
    Record<
      ChangeNoticeImpactTargetType,
      ChangeNoticeImpactDomainCursor | null | undefined
    >
  >;
};

export type ChangeNoticeImpactCandidateReadModel = {
  changeNoticeId: string;
  changeNoticeStatus: Database["public"]["Enums"]["changeOrderStatus"] | null;
  candidates: ChangeNoticeImpactCandidate[];
  coverage: {
    purchaseOrderLine: ChangeNoticeImpactCoverage;
    job: ChangeNoticeImpactCoverage;
    jobMaterial: ChangeNoticeImpactCoverage;
  };
};

export type ChangeNoticeImpactCandidateReadResult = {
  data: ChangeNoticeImpactCandidateReadModel | null;
  error: { message: string } | null;
};

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
export const changeNoticeChangeTypes = [
  "Version",
  "Revision",
  "Replacement Part",
  "New Part"
] as const;
export type ChangeNoticeChangeType = (typeof changeNoticeChangeTypes)[number];

// changeOrder.priority reuses quality's nonConformancePriority DB enum.
export const changeNoticePriority = nonConformancePriority;

// -----------------------------------------------------------------------------
// Stage state machine (G8 — one place). Forward, single step, plus the Cancel /
// Reopen off-ramp. This map only encodes the allowed shape of a transition.
// IMPORTANT: the forward stage is always index 0 — the header's "Advance" action
// reads `transitions[status][0]`, so "Cancelled" must never be first.
// -----------------------------------------------------------------------------
export const changeNoticeStatusTransitions: Record<
  (typeof changeNoticeStatus)[number],
  (typeof changeNoticeStatus)[number][]
> = {
  Draft: ["Start", "Cancelled"],
  Start: ["Engineering Complete", "Cancelled"],
  "Engineering Complete": ["Implementation", "Cancelled"],
  // Last entry is the reopen edge — "Done" stays first so the header still advances/releases.
  Implementation: ["Done", "Cancelled", "Engineering Complete"],
  Done: [],
  // Reopen a closed CO back to Draft (fully editable). Done stays terminal.
  Cancelled: ["Draft"]
};

export function isAllowedChangeNoticeTransition(
  from: string | null | undefined,
  to: string | null | undefined
): boolean {
  if (!from || !to || from === to) return false;
  const allowed =
    changeNoticeStatusTransitions[from as (typeof changeNoticeStatus)[number]];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

// The stages that notify the CO assignee + action-task assignees on entry.
export const changeNoticeNotifyStages: (typeof changeNoticeStatus)[number][] = [
  "Start",
  "Implementation",
  "Done"
];

// "Open" = every stage before the record is closed at Done. Used by the item
// open-CO alert and the single-open-CO guard.
export const changeNoticeOpenStatuses: (typeof changeNoticeStatus)[number][] = [
  "Draft",
  "Start",
  "Engineering Complete",
  "Implementation"
];

export function isChangeNoticeOpen(status: string | null | undefined): boolean {
  return changeNoticeOpenStatuses.some((s) => s === status);
}

// Locked once closed — Done (released, part of the audit trail) or Cancelled
// (abandoned). Reopen a Cancelled CO to Draft to edit it again.
export function isChangeNoticeLocked(
  status: string | null | undefined
): boolean {
  return status === "Done" || status === "Cancelled";
}

// Engineering content — affected items, BOM/BOP drafts, cutover, reason/description.
// Frozen from Implementation onward: what is being implemented must not shift underneath.
export function canEditChangeNoticeEngineering(
  status: string | null | undefined
): boolean {
  return !isChangeNoticeLocked(status) && status !== "Implementation";
}

// Why a change notice is locked, for whichever surface is asking: server guards
// flash it, the affected-item UI shows it in the read-only tooltip. One wording,
// so the two never drift.
export function changeNoticeLockedMessage(status: string | null | undefined) {
  return status === "Implementation"
    ? "This change notice is being implemented, so its changes are locked. Reopen it to make changes."
    : "This change notice is closed, so its changes are read-only.";
}

// Workflow operations — adding, reconciling, reordering, and deleting tasks —
// remain editable until the Change Notice is closed.
export function canEditChangeNoticeWorkflow(
  status: string | null | undefined
): boolean {
  return !isChangeNoticeLocked(status);
}

// Task fields have a separate lifecycle from workflow operations such as adding,
// reconciling, reordering, and deleting tasks. Only an Impact follow-up keeps its
// fields editable after the Change Notice is Done or Cancelled.
export function canEditChangeNoticeActionTaskFields(
  status: string | null | undefined,
  taskOrigin: string | null | undefined
): boolean {
  if (
    !changeNoticeStatus.includes(status as (typeof changeNoticeStatus)[number])
  ) {
    return false;
  }

  if (
    !changeNoticeActionTaskOrigins.includes(
      taskOrigin as (typeof changeNoticeActionTaskOrigins)[number]
    )
  ) {
    return false;
  }

  return !isChangeNoticeLocked(status) || taskOrigin === "Impact follow-up";
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------
export const changeNoticeValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  reasonForChange: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  type: z.enum(changeNoticeType).optional(),
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
export const changeNoticeStatusValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  fromStatus: z.enum(changeNoticeStatus),
  status: z.enum(changeNoticeStatus),
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
export const changeNoticeAffectedItemValidator = z.object({
  id: zfd.text(z.string().optional()),
  changeOrderId: z.string().min(1, { message: "Change notice is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  changeType: z.enum(changeNoticeChangeTypes).default("Version"),
  // Optional revision label for a Revision change (e.g. "A"). Blank → the next
  // revision is auto-computed server-side (createChangeNoticeDraftMethod).
  revision: zfd.text(z.string().optional())
});

// Add-affected-item path for a net-new "New Part" (no existing itemId): the CO
// mints a brand-new inactive Part and adds it as a New Part affected item. Always
// a Part (no Part/Tool choice in the modal).
export const changeNoticeNewPartValidator = z.object({
  changeOrderId: z.string().min(1, { message: "Change notice is required" }),
  // The route branches on this raw FormData value; also seeds the change-type
  // Select so it reads "New Part" after the form remounts (see AffectedItemForm).
  changeType: z.enum(changeNoticeChangeTypes).default("New Part"),
  readableId: z.string().min(1, { message: "Part number is required" }),
  name: z.string().trim().min(1, { message: "Name is required" }),
  replenishmentSystem: z.enum(["Buy", "Make", "Buy and Make"]).default("Make"),
  itemTrackingType: z.enum(itemTrackingTypes).default("Inventory")
});

// Switch the change type on an existing affected item (rebuilds its CO-owned
// Draft make method for the new type — see updateChangeNoticeAffectedItemChangeType).
export const changeNoticeAffectedItemChangeTypeValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  changeType: z.enum(changeNoticeChangeTypes)
});

// Per-item revision cutover config (Q3): existence of the oldRev→newRev
// supersession is automatic at release; the user only tunes mode + dates here.
export const changeNoticeAffectedItemCutoverValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  supersessionMode: z.enum(supersessionModes),
  discontinuationDate: zfd.text(z.string().optional()),
  successorEffectivityDate: zfd.text(z.string().optional())
});

// Action task status transition (Start / Complete / Reopen). Actions are
// instantiated from templates (see changeOrderRequiredAction); there's no
// freeform-create validator.
export const changeNoticeActionStatusValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  status: z.enum(changeNoticeTaskStatus)
});

export const changeNoticeActionNotesValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  notes: zfd.text(z.string().min(1, { message: "Notes are required" }))
});

export const changeNoticeActionAssigneeValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  assignee: zfd.text(z.string().optional())
});

export const changeNoticeActionDueDateValidator = z.object({
  id: z.string().min(1, { message: "Id is required" }),
  dueDate: zfd.text(z.string().optional())
});

// Configurable default actions (changeOrderRequiredAction templates) — the
// per-company set a new change notice is seeded from. Configured like Issue Types.
export const changeNoticeRequiredActionValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
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
// items.service.ts) so ChangeNoticeItemDiff can carry the operation tree
// without a circular import; items.service.ts re-exports these for its own
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

export type ChangeNoticeItemDiff = {
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
// Change Notice Types (the "Category" lookup — configured like Issue Types)
// -----------------------------------------------------------------------------
export const changeNoticeTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" })
});
