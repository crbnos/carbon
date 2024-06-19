import { z } from "zod";
import { zfd } from "zod-form-data";

export const itemInventoryTypes = ["Inventory", "Non-Inventory"] as const;
export const partReplenishmentSystems = [
  "Buy",
  "Make",
  "Buy and Make",
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

export const partManufacturingPolicies = [
  "Make to Stock",
  "Make to Order",
] as const;

export const serviceType = ["Internal", "External"] as const;

export const itemValidator = z.object({
  id: z.string().min(1, { message: "Item ID is required" }).max(255),
  name: z.string().min(1, { message: "Name is required" }).max(255),
  description: zfd.text(z.string().optional()),
  itemGroupId: zfd.text(z.string().optional()),
  itemInventoryType: z.enum(itemInventoryTypes, {
    errorMap: (issue, ctx) => ({
      message: "Part type is required",
    }),
  }),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of Measure is required" }),
  blocked: zfd.checkbox(),
  active: zfd.checkbox(),
});

export const consumableValidator = itemValidator.merge(
  z.object({
    id: z.string().min(1, { message: "Consumable ID is required" }).max(255),
    unitOfMeasureCode: z
      .string()
      .min(1, { message: "Unit of Measure is required" }),
  })
);

export const fixtureValidator = itemValidator.merge(
  z.object({
    id: z.string().min(1, { message: "Fixture ID is required" }).max(255),
    customerId: z.string().optional(),
  })
);

export const materialValidator = itemValidator.merge(
  z.object({
    id: z.string().min(1, { message: "Material ID is required" }).max(255),
    materialSubstanceId: z
      .string()
      .min(1, { message: "Substance is required" }),
    materialFormId: z.string().min(1, { message: "Form is required" }),
    finish: z.string().optional(),
    grade: z.string().optional(),
    dimensions: z.string().optional(),
  })
);

export const partValidator = itemValidator.merge(
  z.object({
    id: z.string().min(1, { message: "Part ID is required" }).max(255),
    replenishmentSystem: z.enum(partReplenishmentSystems, {
      errorMap: (issue, ctx) => ({
        message: "Replenishment system is required",
      }),
    }),
  })
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

export const toolValidator = itemValidator.merge(
  z.object({
    id: z.string().min(1, { message: "Tool ID is required" }).max(255),
    unitOfMeasureCode: z
      .string()
      .min(1, { message: "Unit of Measure is required" }),
  })
);

export const itemCostValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  costingMethod: z.enum(itemCostingMethods, {
    errorMap: (issue, ctx) => ({
      message: "Costing method is required",
    }),
  }),
  standardCost: zfd.numeric(z.number().min(0)),
  unitCost: zfd.numeric(z.number().min(0)),
  costIsAdjusted: zfd.checkbox(),
});

export const itemGroupValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(255),
  description: z.string().optional(),
});

export const pickMethodValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  locationId: z.string().min(20, { message: "Location is required" }),
  defaultShelfId: zfd.text(z.string().optional()),
});

export const materialFormValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(255),
});

export const materialSubstanceValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }).max(255),
});

export const partManufacturingValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  manufacturingLeadTime: zfd.numeric(z.number().min(0)),
  manufacturingBlocked: zfd.checkbox(),
  requiresConfiguration: zfd.checkbox(),
  scrapPercentage: zfd.numeric(z.number().min(0).max(100)),
  lotSize: zfd.numeric(z.number().min(0)),
});

export const itemPlanningValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  locationId: z.string().min(20, { message: "Location is required" }),
  reorderingPolicy: z.enum(itemReorderingPolicies, {
    errorMap: (issue, ctx) => ({
      message: "Reordering policy is required",
    }),
  }),
  critical: zfd.checkbox(),
  safetyStockQuantity: zfd.numeric(z.number().min(0).optional()),
  safetyStockLeadTime: zfd.numeric(z.number().min(0).optional()),
  demandAccumulationPeriod: zfd.numeric(z.number().min(0).optional()),
  demandReschedulingPeriod: zfd.numeric(z.number().min(0).optional()),
  demandAccumulationIncludesInventory: zfd.checkbox().optional(),
  reorderPoint: zfd.numeric(z.number().min(0).optional()).optional(),
  reorderQuantity: zfd.numeric(z.number().min(0)).optional(),
  reorderMaximumInventory: zfd.numeric(z.number().min(0)).optional(),
  minimumOrderQuantity: zfd.numeric(z.number().min(0)).optional(),
  maximumOrderQuantity: zfd.numeric(z.number().min(0)).optional(),
  orderMultiple: zfd.numeric(z.number().min(1)),
});

export const itemPurchasingValidator = z.object({
  itemId: z.string().min(1, { message: "Item ID is required" }),
  preferredSupplierId: zfd.text(z.string().optional()),
  conversionFactor: zfd.numeric(z.number().min(0)),
  purchasingLeadTime: zfd.numeric(z.number().min(0)),
  purchasingUnitOfMeasureCode: zfd.text(z.string().optional()),
  purchasingBlocked: zfd.checkbox(),
});

export const buyMethodValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item ID is required" }),
  supplierId: z.string().min(36, { message: "Supplier ID is required" }),
  supplierPartId: z.string().optional(),
  supplierUnitOfMeasureCode: zfd.text(z.string().optional()),
  minimumOrderQuantity: zfd.numeric(z.number().min(0)),
  conversionFactor: zfd.numeric(z.number().min(0)),
  unitPrice: zfd.numeric(z.number().min(0)),
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

export const unitOfMeasureValidator = z.object({
  id: zfd.text(z.string().optional()),
  code: z.string().min(1, { message: "Code is required" }).max(10),
  name: z.string().min(1, { message: "Name is required" }).max(50),
});
