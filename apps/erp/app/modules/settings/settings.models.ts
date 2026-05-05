import { labelSizes } from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { DataType } from "~/modules/shared";

export const modulesType = [
  "Accounting",
  // "Documents",
  "Invoicing",
  "Inventory",
  "Items",
  "Production",
  "Purchasing",
  "Quality",
  "Resources",
  "Sales",
  "Users"
] as const;

export const kanbanOutputTypes = ["label", "qrcode", "url"] as const;

export const purchasePriceUpdateTimingTypes = [
  "Purchase Invoice Post",
  "Purchase Order Finalize"
] as const;

/** All permission modules with their available CRUD actions */
export const apiKeyPermissionModules = {
  accounting: ["view", "create", "update"],
  documents: ["view", "create", "update", "delete"],
  inventory: ["view", "create", "update", "delete"],
  invoicing: ["view", "create", "update", "delete"],
  parts: ["view", "create", "update", "delete"],
  people: ["view", "create", "update", "delete"],
  production: ["view", "create", "update", "delete"],
  purchasing: ["view", "create", "update", "delete"],
  quality: ["view", "create", "update", "delete"],
  resources: ["view", "create", "update", "delete"],
  sales: ["view", "create", "update", "delete"],
  settings: ["view", "create", "update", "delete"],
  users: ["view", "create", "update", "delete"]
} as const;

export type ApiKeyPermissionModule = keyof typeof apiKeyPermissionModules;

export const apiKeyValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  scopes: zfd.text(z.string().optional()),
  expiresAt: zfd.text(
    z
      .string()
      .optional()
      .refine((val) => !val || new Date(val) > new Date(), {
        message: "Expiration date must be in the future"
      })
  )
});

const company = {
  name: z.string().min(1, { message: "Name is required" }),
  taxId: zfd.text(z.string().optional()),
  addressLine1: z.string().min(1, { message: "Address is required" }),
  addressLine2: zfd.text(z.string().optional()),
  city: z.string().min(1, { message: "City is required" }),
  stateProvince: z.string().min(1, { message: "State / Province is required" }),
  postalCode: z.string().min(1, { message: "Postal Code is required" }),
  countryCode: z.string().min(1, { message: "Country is required" }),
  baseCurrencyCode: zfd.text(z.string()),
  phone: zfd.text(z.string().optional()),
  fax: zfd.text(z.string().optional()),
  email: zfd.text(z.string().optional()),
  website: zfd.text(z.string().optional()),
  vatNumber: zfd.text(z.string().optional())
};

export const companyValidator = z.object(company);
export const onboardingCompanyValidator = z.object({
  ...company,
  next: z.string().min(1, { message: "Next is required" })
});

export const customFieldValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }),
    table: z.string().min(1, { message: "Table is required" }),
    dataTypeId: zfd.numeric(
      z.number().min(1, { message: "Data type is required" })
    ),
    listOptions: z.string().min(1).array().optional(),
    tags: z.array(z.string()).optional(),
    required: zfd.checkbox()
  })
  .refine((input) => {
    // allows bar to be optional only when foo is 'foo'
    if (
      input.dataTypeId === DataType.List &&
      (input.listOptions === undefined ||
        input.listOptions.length === 0 ||
        input.listOptions.some((option) => option.length === 0))
    )
      return false;

    return true;
  });

export const digitalQuoteValidator = z.object({
  digitalQuoteEnabled: zfd.checkbox(),
  digitalQuoteNotificationGroup: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .optional(),
  digitalQuoteIncludesPurchaseOrders: zfd.checkbox()
});

export const jobCompletedValidator = z.object({
  inventoryJobCompletedNotificationGroup: z.array(z.string()).optional(),
  salesJobCompletedNotificationGroup: z.array(z.string()).optional()
});

export const kanbanOutputValidator = z.object({
  kanbanOutput: z.enum(kanbanOutputTypes)
});

export const purchasePriceUpdateTimingValidator = z.object({
  purchasePriceUpdateTiming: z.enum(purchasePriceUpdateTimingTypes)
});

export const calculatedShelfLifeInputScopes = [
  "AllInputs",
  "ManagedInputsOnly"
] as const;

export const expiredEntityPolicies = [
  "Warn",
  "Block",
  "BlockWithOverride"
] as const;

// Every shelf-life knob lives inside the companySettings.inventoryShelfLife
// JSONB blob. The validator below reads/writes that single object so the
// settings form can submit one cohesive structure.
export const shelfLifeSettingsValidator = z.object({
  // Empty input -> undefined -> persisted as null in JSONB, which disables
  // expiry badges company-wide. Any value 0..365 drives the amber
  // "expiring soon" badge plus the red "expired" badge.
  nearExpiryWarningDays: zfd.numeric(
    z.number().int().min(0).max(365).optional()
  ),
  // Seed value for the "Shelf-life (days)" input when a new item is first
  // configured for Fixed Duration. Defaults to 7.
  defaultShelfLifeDays: zfd.numeric(
    z.number().int().min(1).max(3650).default(7)
  ),
  // Calculated-mode MIN expiry scope. 'AllInputs' = MIN over every input
  // carrying an expiry (food/perishable default). 'ManagedInputsOnly' =
  // only inputs whose own item has a Fixed Duration / Calculated policy
  // (excludes supplier-set Set-on-Receipt expiries).
  calculatedInputScope: z
    .enum(calculatedShelfLifeInputScopes)
    .default("AllInputs"),
  // What happens when an operator tries to consume an expired tracked
  // entity. 'Warn' lets it through with a banner; 'Block' rejects;
  // 'BlockWithOverride' rejects unless the caller has inventory:update
  // and supplies an override reason that gets audit-logged.
  expiredEntityPolicy: z.enum(expiredEntityPolicies).default("Block")
});

export const updateLeadTimesOnReceiptValidator = z.object({
  updateLeadTimesOnReceipt: zfd.checkbox()
});

export const maintenanceSettingsValidator = z.object({
  maintenanceGenerateInAdvance: zfd.checkbox(),
  maintenanceAdvanceDays: zfd.numeric(z.number().min(1).max(90).default(7))
});

export const materialIdsValidator = z.object({
  materialGeneratedIds: zfd.checkbox()
});

export const materialUnitsValidator = z.object({
  useMetric: zfd.checkbox()
});

export const productLabelSizeValidator = z.object({
  productLabelSize: z.enum(
    labelSizes.map((size) => size.id) as [string, ...string[]],
    {
      message: "Product label size is required"
    }
  )
});

export const includeThumbnailsOnPurchasingPdfsValidator = z.object({
  includeThumbnailsOnPurchasingPdfs: zfd.checkbox()
});

export const includeThumbnailsOnSalesPdfsValidator = z.object({
  includeThumbnailsOnSalesPdfs: zfd.checkbox()
});

export const rfqReadyValidator = z.object({
  rfqReadyNotificationGroup: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .optional()
});

export const suggestionNotificationValidator = z.object({
  suggestionNotificationGroup: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .optional()
});

export const maintenanceDispatchNotificationValidator = z.object({
  maintenanceDispatchNotificationGroup: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .optional(),
  qualityDispatchNotificationGroup: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .optional(),
  operationsDispatchNotificationGroup: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .optional(),
  otherDispatchNotificationGroup: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .optional()
});

export const supplierQuoteNotificationValidator = z.object({
  supplierQuoteNotificationGroup: z
    .array(z.string().min(1, { message: "Invalid selection" }))
    .optional()
});

export const accountsPayableEmailValidator = z.object({
  accountsPayableEmail: zfd.text(z.string().email().optional())
});

export const defaultSupplierCcValidator = z.object({
  defaultSupplierCc: z.array(z.string().email()).optional()
});

export const accountsReceivableEmailValidator = z.object({
  accountsReceivableEmail: zfd.text(z.string().email().optional())
});

export const defaultCustomerCcValidator = z.object({
  defaultCustomerCc: z.array(z.string().email()).optional()
});

export const sequenceValidator = z.object({
  table: z.string().min(1, { message: "Table is required" }),
  prefix: zfd.text(z.string().optional()),
  suffix: zfd.text(z.string().optional()),
  next: zfd.numeric(z.number().min(0)),
  step: zfd.numeric(z.number().min(1)),
  size: zfd.numeric(z.number().min(1).max(20))
});

export const themes = [
  "zinc",
  "neutral",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "violet"
] as const;
export type Theme = (typeof themes)[number];

export const themeValidator = z.object({
  next: zfd.text(z.string().optional()),
  theme: z.enum(themes, {
    errorMap: (issue, ctx) => ({ message: "Theme is required" })
  })
});

export const webhookValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }),
    table: z.string().min(1, { message: "Table is required" }),
    url: z.string().url({ message: "Must be a valid URL" }),
    onInsert: zfd.checkbox(),
    onUpdate: zfd.checkbox(),
    onDelete: zfd.checkbox(),
    active: zfd.checkbox()
  })
  .refine(
    (input) => {
      if (input.onInsert || input.onUpdate || input.onDelete) return true;
      return false;
    },
    {
      message: "At least one action is required",
      path: ["onDelete"]
    }
  );

export const jobTravelerSettingsValidator = z.object({
  jobTravelerIncludeWorkInstructions: zfd.checkbox()
});

export const consoleSettingsValidator = z.object({
  consoleEnabled: zfd.checkbox()
});

export const quoteLineCategoryMarkupsSettingsValidator = z.object({
  materialCost: zfd.numeric(z.number().min(0).default(0)),
  partCost: zfd.numeric(z.number().min(0).default(0)),
  toolCost: zfd.numeric(z.number().min(0).default(0)),
  consumableCost: zfd.numeric(z.number().min(0).default(0)),
  laborCost: zfd.numeric(z.number().min(0).default(0)),
  machineCost: zfd.numeric(z.number().min(0).default(0)),
  overheadCost: zfd.numeric(z.number().min(0).default(0)),
  outsideCost: zfd.numeric(z.number().min(0).default(0))
});

const billingAddress = {
  name: zfd.text(z.string().optional()),
  addressLine1: zfd.text(z.string().optional()),
  addressLine2: zfd.text(z.string().optional()),
  city: zfd.text(z.string().optional()),
  state: zfd.text(z.string().optional()),
  postalCode: zfd.text(z.string().optional()),
  countryCode: zfd.text(z.string().optional()),
  phone: zfd.text(z.string().optional()),
  fax: zfd.text(z.string().optional()),
  email: zfd.text(z.string().email().optional())
};

export const accountsPayableBillingAddressValidator = z.object(billingAddress);
export const accountsReceivableBillingAddressValidator =
  z.object(billingAddress);

export const timeCardSettingsValidator = z.object({
  timeCardEnabled: zfd.checkbox()
});
