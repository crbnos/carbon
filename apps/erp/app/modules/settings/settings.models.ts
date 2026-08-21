import {
  blockSchema,
  documentSectionPlacementSchema,
  documentSettingsSchema,
  documentTemplateTypeSchema,
  sectionConfigSchema,
  themeSchema
} from "@carbon/documents/template";
import { isValidTimeZone, labelSizes } from "@carbon/utils";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { plmReleaseControl } from "~/modules/items/items.models";
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
  name: z.string().trim().min(1, { message: "Name is required" }),
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

const companyAddress = {
  name: z.string().trim().min(1, { message: "Name is required" }),
  addressLine1: z.string().min(1, { message: "Address is required" }),
  addressLine2: zfd.text(z.string().optional()),
  city: z.string().min(1, { message: "City is required" }),
  stateProvince: zfd.text(z.string().optional()),
  postalCode: z.string().min(1, { message: "Postal Code is required" }),
  countryCode: z.string().min(1, { message: "Country is required" }),
  baseCurrencyCode: zfd.text(z.string()),
  timezone: z
    .string()
    .min(1, { message: "Timezone is required" })
    .refine(isValidTimeZone, { message: "Invalid timezone" }),
  website: zfd.text(z.string().optional())
};

const company = {
  ...companyAddress,
  taxId: zfd.text(z.string().optional()),
  phone: zfd.text(z.string().optional()),
  fax: zfd.text(z.string().optional()),
  email: zfd.text(z.string().optional()),
  vatNumber: zfd.text(z.string().optional()),
  eori: zfd.text(z.string().optional()),
  registrationNumber: zfd.text(z.string().optional())
};

export const companyValidator = z.object(company);

// The onboarding company step collects only the address; the industry choice
// comes from the dedicated industry step that follows.
export const addressValidator = z.object({
  ...companyAddress,
  next: z.string().min(1, { message: "Next is required" })
});

// Onboarding-only: the industry fields live on the company row but are not part
// of the general company validator (kept off the settings forms).
export const onboardingCompanyValidator = z.object({
  ...company,
  industryId: zfd.text(z.string().optional()),
  customIndustryDescription: z.string().optional(),
  next: z.string().min(1, { message: "Next is required" })
});

export const customFieldValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().trim().min(1, { message: "Name is required" }),
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

export const plmReleaseControlValidator = z.object({
  plmReleaseControl: z.enum(plmReleaseControl)
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

// What happens when an operator presses Finish on a picking list that still has
// unpicked material. 'warn' surfaces the shortfall but lets them acknowledge &
// continue (the list is flagged Partial); 'error' blocks completion until every
// line is picked or marked Short. Mirrors the storage-rule severity shape.
export const incompletePickingListPolicies = ["warn", "error"] as const;
export type IncompletePickingListPolicy =
  (typeof incompletePickingListPolicies)[number];

export const incompletePickingListPolicyValidator = z.object({
  incompletePickingListPolicy: z
    .enum(incompletePickingListPolicies)
    .default("warn")
});

// When un-consumed picked material flushes back from the work-center lineside
// bin to the warehouse. 'job' (default) returns the remainder when the whole
// job completes; 'operation' returns each operation's remainder as soon as that
// operation is Done (holding back what completion-time backflush still needs).
export const returnPickedMaterialTimings = ["job", "operation"] as const;
export type ReturnPickedMaterialTiming =
  (typeof returnPickedMaterialTimings)[number];

export const returnPickedMaterialTimingValidator = z.object({
  returnPickedMaterialTiming: z.enum(returnPickedMaterialTimings).default("job")
});

export const updateLeadTimesOnReceiptValidator = z.object({
  updateLeadTimesOnReceipt: zfd.checkbox()
});

export const materialIdsValidator = z.object({
  materialGeneratedIds: zfd.checkbox()
});

export const materialUnitsValidator = z.object({
  useMetric: zfd.checkbox()
});

export {
  printerRouteValidator,
  updateAssignmentValidator
} from "@carbon/printing";

export const productLabelSizeValidator = z.object({
  productLabelSize: z.enum(
    labelSizes.map((size) => size.id) as [string, ...string[]],
    {
      message: "Product label size is required"
    }
  )
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

export const subsidiaryValidator = z.object({
  ...company,
  id: zfd.text(z.string().optional()),
  parentCompanyId: zfd.text(z.string().optional())
});

export const sequenceValidator = z.object({
  table: z.string().min(1, { message: "Table is required" }),
  prefix: zfd.text(z.string().optional()),
  suffix: zfd.text(z.string().optional()),
  next: zfd.numeric(z.number().min(0)),
  step: zfd.numeric(z.number().min(1)),
  size: zfd.numeric(z.number().min(1).max(20))
});

export const itemSerialSequenceValidator = z.object({
  id: zfd.text(z.string().optional()),
  itemId: z.string().min(1, { message: "Item is required" }),
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
    name: z.string().trim().min(1, { message: "Name is required" }),
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

export const consoleSettingsValidator = z.object({
  consoleEnabled: zfd.checkbox()
});

/**
 * Retry / Skip / Re-send actions on accounting sync operations. `ids` is a
 * repeated form field (one entry per selected operation) so bulk retry can
 * submit many operations in one POST. The only user-driven target statuses
 * are "Pending" (retry / re-send) and "Skipped" — the service's transition
 * guard re-validates against the row's current status.
 */
export const syncOperationTransitionValidator = z.object({
  intent: z.literal("transition-sync-operation"),
  ids: zfd.repeatable(
    z.array(z.string().min(1)).min(1, { message: "No operations selected" })
  ),
  to: z.enum(["Pending", "Skipped"])
});

/**
 * Saves one account mapping row (Carbon account.id → provider account id)
 * from the integration drawer's Account Mapping tab. externalCode /
 * externalName are display metadata captured from the selected provider
 * account — the journal syncer resolves provider account codes from the
 * mapping's stored externalCode, so the code must be persisted.
 */
export const accountMappingUpsertValidator = z.object({
  intent: z.literal("upsert-account-mapping"),
  accountId: z.string().min(1, { message: "Account is required" }),
  externalId: z.string().min(1, { message: "Provider account is required" }),
  externalCode: zfd.text(z.string().optional()),
  externalName: zfd.text(z.string().optional())
});

const accountMappingEntrySchema = z.object({
  accountId: z.string().min(1),
  externalId: z.string().min(1),
  externalCode: z.string().optional(),
  externalName: z.string().optional()
});

/**
 * Confirm-all from the match-by-code drawer. `mappings` is a repeated form
 * field (per the sync-operation `ids` precedent) — each entry a
 * JSON-encoded proposal validated against the same shape as the single-row
 * upsert.
 */
export const accountMappingBulkUpsertValidator = z.object({
  intent: z.literal("bulk-upsert-account-mappings"),
  mappings: zfd.repeatable(
    z
      .array(
        z
          .string()
          .transform((value, ctx) => {
            try {
              return JSON.parse(value);
            } catch {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Invalid account mapping payload"
              });
              return z.NEVER;
            }
          })
          .pipe(accountMappingEntrySchema)
      )
      .min(1, { message: "No account mappings to save" })
  )
});

/**
 * "Suggest with AI" from the Account Mapping tab. The unmapped Carbon
 * accounts and the provider chart already sit in the loaded tab data, so
 * the client ships them back as two JSON-encoded hidden fields instead of
 * the action re-fetching the provider chart. The AI step only proposes
 * matches (nothing is written) — proposals are confirmed through the same
 * `bulk-upsert-account-mappings` path.
 */
const jsonArrayField = <T extends z.ZodTypeAny>(element: T) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = JSON.parse(value);
      const result = z.array(element).safeParse(parsed);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid account list payload"
        });
        return z.NEVER;
      }
      return result.data;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid account list payload"
      });
      return z.NEVER;
    }
  });

export const accountMappingAiSuggestValidator = z.object({
  intent: z.literal("ai-suggest-account-mappings"),
  accounts: jsonArrayField(
    z.object({
      id: z.string().min(1),
      number: z.string().nullable(),
      name: z.string()
    })
  ),
  providerAccounts: jsonArrayField(
    z.object({
      id: z.string().min(1),
      code: z.string().nullable().optional(),
      name: z.string().nullable().optional()
    })
  )
});

/**
 * Posting-sync settings persisted (deep-merged) at
 * companyIntegration.metadata.settings.postingSync in the v3 shape. Field
 * semantics mirror @carbon/ee/accounting's PostingSyncSettingsSchema:
 * posting sync is ALWAYS-ON (no master enable, no per-type enable — Manual
 * never syncs per POSTING_POLICY); `sourceTypeConfigs` is a repeated hidden
 * field of "<sourceType>|<granularity>" carrying each non-Manual
 * journal-represented type's granularity; `familyAr`/`familyAp` are the
 * AR/AP representation modes ("journals" is schema-valid but UI-gated until
 * the spec's Phase 4 ships).
 */
export const postingSyncSettingsValidator = z.object({
  intent: z.literal("update-posting-settings"),
  sourceTypeConfigs: zfd.repeatable(
    z.array(
      z
        .string()
        .regex(
          /^[^|]+\|(individual|daily-summary)$/,
          "Malformed source-type config"
        )
    )
  ),
  familyAr: z.enum(["documents", "journals", "none"]),
  familyAp: z.enum(["documents", "journals", "none"]),
  periodLockPolicy: z.enum(["park", "redate"]),
  lockDate: zfd.text(z.string().optional())
});

/**
 * Saves the dimension-slot configuration (Dimensions tab): which Carbon
 * dimensions ride along on pushed journals and which provider analytics
 * target each one maps to. `slots` is a repeated JSON-encoded hidden field
 * (per the bulk account-mapping precedent); zero slots is a valid save
 * (dimension sync off). The action re-validates the slots against the
 * provider's declared targets via validateDimensionSlots before writing.
 */
const dimensionSlotEntrySchema = z.object({
  dimensionId: z.string().min(1),
  target: z.string().min(1),
  autoCreate: z.boolean().optional()
});

export const dimensionSlotsUpdateValidator = z.object({
  intent: z.literal("update-dimension-slots"),
  onUnmappedDimensionValue: z.enum(["warn", "drop"]),
  slots: zfd.repeatable(
    z.array(
      z
        .string()
        .transform((value, ctx) => {
          try {
            return JSON.parse(value);
          } catch {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Invalid dimension slot payload"
            });
            return z.NEVER;
          }
        })
        .pipe(dimensionSlotEntrySchema)
    )
  )
});

/**
 * Saves one dimension-value mapping row (Carbon `<dimensionId>:<valueId>`
 * → provider option id) from the Dimensions tab. externalName is display
 * metadata captured from the selected provider option, mirroring the
 * account-mapping upsert.
 */
export const dimensionValueMappingUpsertValidator = z.object({
  intent: z.literal("upsert-dimension-value-mapping"),
  dimensionId: z.string().min(1, { message: "Dimension is required" }),
  valueId: z.string().min(1, { message: "Value is required" }),
  externalId: z.string().min(1, { message: "Provider value is required" }),
  externalName: zfd.text(z.string().optional())
});

const dimensionValueMappingEntrySchema = z.object({
  dimensionId: z.string().min(1),
  valueId: z.string().min(1),
  externalId: z.string().min(1),
  externalName: z.string().optional()
});

/**
 * Confirm-all from the match-by-name drawer. `mappings` is a repeated
 * JSON-encoded form field — the same shape/precedent as
 * accountMappingBulkUpsertValidator.
 */
export const dimensionValueMappingBulkUpsertValidator = z.object({
  intent: z.literal("bulk-upsert-dimension-value-mappings"),
  mappings: zfd.repeatable(
    z
      .array(
        z
          .string()
          .transform((value, ctx) => {
            try {
              return JSON.parse(value);
            } catch {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Invalid dimension value mapping payload"
              });
              return z.NEVER;
            }
          })
          .pipe(dimensionValueMappingEntrySchema)
      )
      .min(1, { message: "No dimension value mappings to save" })
  )
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

// The editor submits the block list as a JSON string in a hidden field; we
// parse it and validate every block against the shared schema.
const jsonField = <T>(schema: z.ZodType<T>, message: string) =>
  zfd.text(
    z.string().transform((value, ctx) => {
      try {
        return schema.parse(JSON.parse(value));
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
        return z.NEVER;
      }
    })
  );

export const documentTemplateValidator = zfd.formData({
  documentType: zfd.text(documentTemplateTypeSchema),
  blocks: jsonField(z.array(blockSchema), "Invalid document template blocks"),
  theme: jsonField(themeSchema, "Invalid document theme"),
  settings: jsonField(documentSettingsSchema, "Invalid document settings"),
  headerSectionId: zfd.text(z.string().optional()),
  footerSectionId: zfd.text(z.string().optional()),
  // Header layout config (logo) is edited inline and saved with the template;
  // the action upserts it onto the referenced header section.
  headerConfig: jsonField(
    sectionConfigSchema,
    "Invalid header config"
  ).optional()
});

export const documentSectionValidator = zfd.formData({
  id: zfd.text(z.string().optional()),
  name: zfd.text(z.string().min(1)),
  placement: zfd.text(documentSectionPlacementSchema),
  content: jsonField(z.any(), "Invalid section content"),
  config: jsonField(sectionConfigSchema, "Invalid section config").optional()
});
