// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  bicMatchesCountry,
  conditionAstFormField,
  equals,
  getBankFieldConfig,
  getFieldDef,
  isFieldAvailableOnSalesRuleSurfaces,
  isValidSwiftBic,
  RULE_SEVERITIES,
  round,
  SALES_RULE_SURFACES
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { address, contact } from "~/types/validators";
import { currencyCodes } from "../accounting";
import {
  incoterms,
  itemType,
  methodItemType,
  methodOperationOrders,
  methodType,
  operationTypes,
  optionalTiptapDoc,
  standardFactorType,
  taxExemptionReasons
} from "../shared";
import { pricingRuleConfigurationPriceValidator } from "./sales.utils";

export const KPIs = [
  {
    key: "quoteCount",
    label: "Quotes"
  },
  {
    key: "rfqCount",
    label: "RFQs"
  },
  {
    key: "salesFunnel",
    label: "Sales Funnel"
  },
  {
    key: "salesOrderCount",
    label: "Sales Orders"
  },
  {
    key: "salesOrderRevenue",
    label: "Sales Revenue"
  }
  // {
  //   key: "turnaroundTime",
  //   label: "Turnaround Time",
  // },
] as const;

export const salesRFQStatusType = [
  "Draft",
  "Ready for Quote",
  "Quoted",
  "Closed"
] as const;

export const customerAccountingValidator = z.object({
  id: zfd.text(z.string()),
  customerTypeId: zfd.text(z.string().optional())
});

export const customerContactValidator = z.object({
  id: zfd.text(z.string().optional()),
  ...contact,
  customerLocationId: zfd.text(z.string().optional())
});

export const customerLocationValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: zfd.text(z.string()),
  ...address
});

export const customerValidator = z.object({
  id: zfd.text(z.string().optional()),
  readableId: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  customerStatusId: zfd.text(z.string().optional()),
  customerTypeId: zfd.text(z.string().optional()),
  accountManagerId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  taxPercent: zfd.numeric(
    z.number().min(0).max(1, { message: "Tax percent must be between 0 and 1" })
  ),
  salesContactId: zfd.text(z.string().optional()),
  website: zfd.text(z.string().optional())
  // defaultCc: z.array(z.string().email()).default([])
});

export const customerTaxValidator = z
  .object({
    customerId: z.string().min(1),
    taxId: zfd.text(z.string().optional()),
    vatNumber: zfd.text(z.string().optional()),
    eori: zfd.text(z.string().optional()),
    taxExempt: z.coerce.boolean().default(false),
    taxExemptionReason: z.preprocess(
      (val) => (val === "" ? undefined : val),
      z.enum(taxExemptionReasons).optional().nullable()
    ),
    taxExemptionCertificateNumber: zfd.text(z.string().optional())
  })
  .refine(
    (data) => !data.taxExempt || (data.taxExempt && data.taxExemptionReason),
    {
      message: "Exemption reason is required when tax exempt",
      path: ["taxExemptionReason"]
    }
  );

export const customerBankAccountValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    customerId: z.string().min(1, { message: "Customer is required" }),
    name: zfd.text(z.string().min(1, { message: "Name is required" })),
    accountHolderName: zfd.text(z.string().optional()),
    bankName: zfd.text(z.string().min(1, { message: "Bank name is required" })),
    // Correspondent banks route international wires on this.
    bankAddress: zfd.text(
      z.string().min(1, { message: "Bank address is required" })
    ),
    // Required because it SELECTS the validation rules below — left blank, the
    // permissive default applies and nothing is really checked.
    countryCode: zfd.text(
      z.string().min(1, { message: "Country is required" })
    ),
    currencyCode: zfd.text(z.string().optional()),
    // Generic by design: `accountNumber` holds an IBAN in SEPA and a plain
    // account number elsewhere; `bankCode` holds an ABA / sort code / BSB /
    // IFSC / transit. countryCode decides which validator applies, so a new
    // country is an entry in getBankFieldConfig, not a migration.
    accountNumber: zfd.text(z.string().optional()),
    bankCode: zfd.text(z.string().optional()),
    swiftBic: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  })
  .superRefine((data, ctx) => {
    const config = getBankFieldConfig(data.countryCode);

    if (!data.accountNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An account number is required",
        path: ["accountNumber"]
      });
    } else if (
      config.validateAccount &&
      !config.validateAccount(data.accountNumber)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid account number for the selected country",
        path: ["accountNumber"]
      });
    }

    if (config.bankCodeLabel !== null) {
      // A country that defines a routing identifier always needs it — there is
      // no scheme where it is optional.
      if (!data.bankCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A bank code is required for the selected country",
          path: ["bankCode"]
        });
      } else if (
        config.validateBankCode &&
        !config.validateBankCode(data.bankCode)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid bank code for the selected country",
          path: ["bankCode"]
        });
      }
    }

    // Cross-border payments will not route without a BIC, so where the country
    // config demands one, absence is an error rather than a blank field.
    if (!data.swiftBic) {
      if (config.requiresSwift) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A SWIFT/BIC code is required for this country",
          path: ["swiftBic"]
        });
      }
    } else if (!isValidSwiftBic(data.swiftBic)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid SWIFT/BIC code",
        path: ["swiftBic"]
      });
    } else if (!bicMatchesCountry(data.swiftBic, data.countryCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "This SWIFT/BIC belongs to a different country",
        path: ["swiftBic"]
      });
    }
  })
  // Countries with no routing identifier (SEPA: the IBAN carries it) unmount the
  // input, so nothing is submitted. Left undefined, an update would skip the
  // column entirely and strand the previous country's code on the row — so it is
  // explicitly nulled rather than merely absent.
  .transform((data) => ({
    ...data,
    bankCode:
      getBankFieldConfig(data.countryCode).bankCodeLabel === null
        ? null
        : (data.bankCode ?? null)
  }));

export const customerPaymentValidator = z.object({
  customerId: z.string().min(1, { message: "Customer is required" }),
  invoiceCustomerId: zfd.text(z.string().optional()),
  invoiceCustomerLocationId: zfd.text(z.string().optional()),
  invoiceCustomerContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional())
});

export const customerShippingValidator = z.object({
  customerId: z.string().min(1, { message: "Customer is required" }),
  shippingCustomerId: zfd.text(z.string().optional()),
  shippingCustomerLocationId: zfd.text(z.string().optional()),
  shippingCustomerContactId: zfd.text(z.string().optional()),
  // shippingTermId: zfd.text(z.string().optional()),
  shippingMethodId: zfd.text(z.string().optional()),
  incoterm: zfd.text(z.enum(incoterms).optional()),
  incotermLocation: zfd.text(z.string().optional())
});

export const customerStatusValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" })
});

export const customerTypeValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" })
});

export const externalQuoteValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("accept"),
    digitalQuoteAcceptedBy: z.string().min(1, { message: "Name is required" }),
    digitalQuoteAcceptedByEmail: z
      .string()
      .email({ message: "Email is invalid" })
  }),
  z.object({
    type: z.literal("reject"),
    digitalQuoteRejectedBy: z.string().min(1, { message: "Name is required" }),
    digitalQuoteRejectedByEmail: z
      .string()
      .email({ message: "Email is invalid" })
  })
]);

export const getMethodValidator = z.object({
  type: z.enum(["item", "quoteLine", "method", "quoteToQuote"]),
  sourceId: z.string().min(1, { message: "Please select a source method" }),
  targetId: z.string().min(1, { message: "Please select a target method" }),
  billOfMaterial: zfd.checkbox(),
  billOfProcess: zfd.checkbox(),
  parameters: zfd.checkbox(),
  tools: zfd.checkbox(),
  steps: zfd.checkbox(),
  workInstructions: zfd.checkbox()
});

export const noQuoteReasonValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" })
});

export const customerPortalValidator = z.object({
  id: zfd.text(z.string().optional()),
  customerId: z.string().min(1, { message: "Customer is required" })
});

export const priceOverrideBreakValidator = z.object({
  id: z.string().optional(),
  quantity: z.number().nonnegative(),
  overridePrice: z.number().nonnegative(),
  active: z.boolean().default(true)
});

export const priceOverrideBreaksValidator = z
  .array(priceOverrideBreakValidator)
  .min(1, { message: "At least one break is required" })
  .refine((b) => new Set(b.map((x) => x.quantity)).size === b.length, {
    message: "Duplicate quantity across breaks"
  });

export const priceOverrideValidator = z
  .object({
    id: z.string().optional(),
    itemId: z.string().min(1),
    customerId: z.string().optional(),
    customerTypeId: z.string().optional(),
    active: zfd.checkbox(),
    applyRulesOnTop: zfd.checkbox(),
    validFrom: zfd.text(z.string().optional()),
    validTo: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  })
  .refine((d) => !(d.customerId && d.customerTypeId), {
    message: "Cannot set both Customer and Customer Type",
    path: ["customerId"]
  })
  .refine((d) => !d.validFrom || !d.validTo || d.validFrom <= d.validTo, {
    message: "Valid From must be on or before Valid To",
    path: ["validTo"]
  });

export const duplicatePriceListValidator = z
  .object({
    sourceCustomerId: zfd.text(z.string().optional()),
    sourceCustomerTypeId: zfd.text(z.string().optional()),
    targetCustomerId: zfd.text(z.string().optional()),
    targetCustomerTypeId: zfd.text(z.string().optional()),
    conflictStrategy: z.enum(["skip", "overwrite"]),
    overrideIds: zfd.text(z.string().optional())
  })
  .refine((d) => d.targetCustomerId || d.targetCustomerTypeId, {
    message: "Please select a target scope",
    path: ["targetCustomerId"]
  });

export const priceResolutionInputValidator = z.object({
  itemId: z.string().min(1),
  quantity: z.number().nonnegative(),
  customerId: z.string().optional(),
  customerTypeId: z.string().optional(),
  itemPostingGroupId: z.string().optional(),
  date: z.string().optional(),
  existingBasePrice: z.number().optional(),
  configuration: z.record(z.string(), z.unknown()).optional()
});

const parseJsonField = (value: unknown) => {
  if (typeof value !== "string") return value;
  if (value.trim() === "") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

// One step of how a price was resolved — the shape of PriceTraceStep (types.ts).
export const priceTraceStepValidator = z.object({
  step: z.string(),
  source: z.string(),
  amount: z.number(),
  adjustment: z.number().optional(),
  ruleId: z.string().optional(),
  label: z.string().optional()
});

// A Configuration rule prices one configurable item's parameter values
// (`configurationPrices`) and has no discount or markup of its own.
export const pricingRuleTypes = [
  "Discount",
  "Markup",
  "Configuration"
] as const;
export const pricingRuleAmountTypes = ["Percentage", "Fixed"] as const;

export const pricingRuleValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().trim().min(1, { message: "Name is required" }),
    ruleType: z.enum(pricingRuleTypes),
    amountType: z.enum(pricingRuleAmountTypes),
    amount: zfd.numeric(z.number().min(0)),
    minQuantity: zfd.numeric(z.number().min(0).optional()),
    maxQuantity: zfd.numeric(z.number().min(0).optional()),
    customerIds: z.array(z.string()).optional().default([]),
    customerTypeIds: z.array(z.string()).optional().default([]),
    itemIds: z.array(z.string()).optional().nullable().default([]),
    // The single configurable item of a Configuration rule.
    itemId: zfd.text(z.string().optional()),
    itemPostingGroupId: zfd.text(z.string().optional()),
    validFrom: zfd.text(z.string().optional()),
    validTo: zfd.text(z.string().optional()),
    priority: zfd.numeric(z.number().int().min(0).optional().default(0)),
    active: zfd.checkbox(),
    configurationPrices: z.preprocess(
      parseJsonField,
      z.array(pricingRuleConfigurationPriceValidator).optional()
    )
  })
  .refine((d) => d.amountType !== "Percentage" || d.amount <= 1, {
    message: "Percentage must be between 0% and 100%",
    path: ["amount"]
  })
  .refine((d) => !d.validFrom || !d.validTo || d.validFrom <= d.validTo, {
    message: "Valid From must be on or before Valid To",
    path: ["validTo"]
  })
  .refine(
    (d) =>
      d.ruleType !== "Configuration" || !!d.itemId || d.itemIds?.length === 1,
    { message: "A configured part is required", path: ["itemId"] }
  );

export const quoteLineStatusType = [
  "Not Started",
  "In Progress",
  "Complete",
  "No Quote"
] as const;

export const quoteStatusType = [
  "Draft",
  "Sent",
  "Ordered",
  "Partial",
  "Lost",
  "Cancelled",
  "Expired"
] as const;

export const quoteValidator = z.object({
  id: zfd.text(z.string().optional()),
  quoteId: zfd.text(z.string().optional()),
  name: zfd.text(z.string().optional()),
  salesPersonId: zfd.text(z.string().optional()),
  estimatorId: zfd.text(z.string().optional()),
  customerId: z.string().min(1, { message: "Customer is required" }),
  customerLocationId: zfd.text(z.string().optional()),
  customerContactId: zfd.text(z.string().optional()),
  customerEngineeringContactId: zfd.text(z.string().optional()),
  customerReference: zfd.text(z.string().optional()),
  locationId: z.string().min(1, { message: "Location is required" }),
  status: z.enum(quoteStatusType).optional(),
  notes: optionalTiptapDoc,
  dueDate: zfd.text(z.string().optional()),
  expirationDate: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  exchangeRate: zfd.numeric(z.number().optional()),
  exchangeRateUpdatedAt: zfd.text(z.string().optional()),
  digitalQuoteAcceptedBy: zfd.text(z.string().optional()),
  digitalQuoteAcceptedByEmail: zfd.text(z.string().optional())
});

export const quoteLineAdditionalChargesValidator = z.record(
  z.string(),
  z.object({
    description: z.string(),
    amounts: z.record(z.string(), z.number()),
    taxable: z.boolean().default(true)
  })
);

export const costCategoryKeys = [
  "materialCost",
  "partCost",
  "toolCost",
  "consumableCost",
  "serviceCost",
  "laborCost",
  "machineCost",
  "overheadCost",
  "outsideCost"
] as const;

export type CostCategoryKey = (typeof costCategoryKeys)[number];

export const quoteLineCategoryMarkupsValidator = z
  .record(z.string(), z.number().min(0))
  .default({});

export const quoteLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  quoteId: z.string(),
  itemType: z.enum(itemType).optional(),
  itemId: z.string().min(1, { message: "Part is required" }),
  status: z.enum(quoteLineStatusType, {
    error: "Status is required"
  }),
  estimatorId: zfd.text(z.string().optional()),
  description: z.string().min(1, { message: "Description is required" }),
  methodType: z.enum(methodType, {
    error: "Method is required"
  }),
  customerPartId: zfd.text(z.string().optional()),
  customerPartRevision: zfd.text(z.string().optional()),
  unitOfMeasureCode: zfd.text(
    z.string().min(1, { message: "Unit of measure is required" })
  ),
  quantity: z
    .array(
      zfd.numeric(z.number().min(0.00001, { message: "Quantity is required" }))
    )
    .refine((quantities) => new Set(quantities).size === quantities.length, {
      message: "Each quantity must be different"
    }),
  modelUploadId: zfd.text(z.string().optional()),
  noQuoteReason: zfd.text(z.string().optional()),
  taxPercent: zfd.numeric(
    z.number().min(0).max(1, { message: "Tax percent must be between 0 and 1" })
  ),
  internalNotes: z.any().optional(),
  externalNotes: z.any().optional(),
  configuration: z.any().optional()
});

export const quoteMaterialValidator = z
  .object({
    id: z.string().min(1, { message: "Material ID is required" }),
    quoteMakeMethodId: z
      .string()
      .min(1, { message: "Make method is required" }),
    order: zfd.numeric(z.number().min(0)),
    itemType: z.enum(methodItemType, {
      error: "Item type is required"
    }),
    methodType: z.enum(methodType, {
      error: "Method type is required"
    }),
    itemId: z.string().min(1, { message: "Item is required" }),
    kit: zfd.text(z.string().optional()).transform((value) => value === "true"),
    description: z.string().min(1, { message: "Description is required" }),
    quoteOperationId: zfd.text(z.string().optional()),
    quantity: zfd.numeric(z.number().min(0)),
    storageUnitId: zfd.text(z.string().optional()),
    unitCost: zfd.numeric(z.number().min(0)),
    // Required, not optional-with-default: a form that omits it fails loudly
    // instead of silently downgrading a typed cost to 'system'.
    unitCostSource: z.enum(["system", "manual"]),
    unitOfMeasureCode: z
      .string()
      .min(1, { message: "Unit of Measure is required" })
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

export const quoteOperationValidator = z
  .object({
    id: z.string().min(1, { message: "Operation ID is required" }),
    quoteMakeMethodId: z
      .string()
      .min(1, { message: "Quote Make Method is required" }),
    order: zfd.numeric(z.number().min(0)),
    operationOrder: z.enum(methodOperationOrders, {
      error: "Operation order is required"
    }),
    operationType: z.enum(operationTypes, {
      error: "Operation type is required"
    }),
    processId: z.string().min(1, { message: "Process is required" }),
    procedureId: zfd.text(z.string().optional()),
    assemblyInstructionId: zfd.text(z.string().optional()),
    inspectionDocumentId: zfd.text(z.string().optional()),
    workCenterId: zfd.text(z.string().optional()),
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
    machineRate: zfd.numeric(z.number().min(0).optional()),
    overheadRate: zfd.numeric(z.number().min(0).optional()),
    laborRate: zfd.numeric(z.number().min(0).optional()),
    operationSupplierProcessId: zfd.text(z.string().optional()),
    operationMinimumCost: zfd.numeric(z.number().min(0).optional()),
    operationUnitCost: zfd.numeric(z.number().min(0).optional()),
    operationLeadTime: zfd.numeric(z.number().min(0).optional())
  })
  .refine(
    (data) => {
      if (data.operationType === "Outside Processing") {
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
      if (data.operationType === "Outside Processing") {
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
      if (data.operationType === "Outside Processing") {
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
      if (data.operationType === "Process") {
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
      if (data.operationType !== "Outside Processing") {
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
      if (data.operationType !== "Outside Processing") {
        return Number.isFinite(data.laborRate);
      }
      return true;
    },
    {
      message: "Labor rate is required",
      path: ["laborRate"]
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

export const quoteFinalizeValidator = z
  .object({
    notification: z.enum(["Email", "None"]).optional(),
    customerContact: zfd.text(z.string().optional()),
    cc: z.array(z.string()).optional()
  })
  .refine(
    (data) => (data.notification === "Email" ? data.customerContact : true),
    {
      message: "Supplier contact is required for email",
      path: ["customerContact"] // path of error
    }
  );

export const quotePaymentValidator = z.object({
  id: z.string(),
  invoiceCustomerId: zfd.text(z.string().optional()),
  invoiceCustomerLocationId: zfd.text(z.string().optional()),
  invoiceCustomerContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional())
});

export const quoteShipmentValidator = z.object({
  id: z.string(),
  locationId: zfd.text(z.string().optional()),
  shippingMethodId: zfd.text(z.string().optional()),
  receiptRequestedDate: zfd.text(z.string().optional()),
  shippingCost: zfd.numeric(z.number().optional()),
  incoterm: zfd.text(z.enum(incoterms).optional()),
  incotermLocation: zfd.text(z.string().optional())
});

export const salesOrderLineType = [
  "Part",
  "Service",
  "Material",
  "Tool",
  "Consumable",
  "Comment",
  "Fixed Asset"
] as const;

export const salesOrderStatusType = [
  "Draft",
  "In Progress",
  "Needs Approval",
  // "Confirmed",
  "To Ship and Invoice",
  "To Ship",
  "To Invoice",
  "Completed",
  // "Invoiced",
  "Cancelled",
  "Closed"
] as const;

// Sales orders in these statuses can still receive/fulfill a job — i.e. a job
// may be linked to one of their lines. The terminal statuses (Completed,
// Invoiced, Cancelled, Closed) are excluded. Used when offering sales order
// lines to link a job to (see getOpenSalesOrderLinesForItem).
export const OPEN_SALES_ORDER_STATUSES = [
  "Draft",
  "Needs Approval",
  "Confirmed",
  "In Progress",
  "To Ship and Invoice",
  "To Ship",
  "To Invoice"
] as const;

/**
 * True for terminal statuses (Completed, Invoiced, Cancelled, Closed) — and for
 * null/unknown — i.e. sales orders a job should not be (re)linked to. Inverse of
 * OPEN_SALES_ORDER_STATUSES.
 */
export function isSalesOrderClosed(status: string | null | undefined): boolean {
  return !OPEN_SALES_ORDER_STATUSES.includes(
    status as (typeof OPEN_SALES_ORDER_STATUSES)[number]
  );
}

export const salesConfirmValidator = z
  .object({
    notification: z.enum(["Email", "None"]).optional(),
    customerContact: zfd.text(z.string().optional()),
    cc: z.array(z.string()).optional()
  })
  .refine(
    (data) => (data.notification === "Email" ? data.customerContact : true),
    {
      message: "Customer contact is required for email",
      path: ["customerContact"] // path of error
    }
  );

export const salesOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  salesOrderId: zfd.text(z.string().optional()),
  orderDate: zfd.text(z.string().optional()),
  requestedDate: zfd.text(z.string().optional()),
  promisedDate: zfd.text(z.string().optional()),
  status: z.enum(salesOrderStatusType).optional(),
  notes: zfd.text(z.string().optional()),
  customerId: z.string().min(1, { message: "Customer is required" }),
  customerLocationId: zfd.text(z.string().optional()),
  customerContactId: zfd.text(z.string().optional()),
  customerEngineeringContactId: zfd.text(z.string().optional()),
  customerReference: zfd.text(z.string().optional()),
  quoteId: zfd.text(z.string().optional()),
  locationId: z.string().min(1, { message: "Location is required" }),
  currencyCode: zfd.text(z.string()),
  exchangeRate: zfd.numeric(z.number().optional()),
  exchangeRateUpdatedAt: zfd.text(z.string().optional()),
  salesPersonId: zfd.text(z.string().optional())
});

export const salesOrderShipmentValidator = z
  .object({
    id: z.string(),
    locationId: zfd.text(z.string().optional()),
    shippingMethodId: zfd.text(z.string().optional()),
    // shippingTermId: zfd.text(z.string().optional()),
    trackingNumber: z.string(),
    deliveryDate: zfd.text(z.string().optional()),
    receiptRequestedDate: zfd.text(z.string().optional()),
    receiptPromisedDate: zfd.text(z.string().optional()),
    dropShipment: zfd.checkbox(),
    customerId: zfd.text(z.string().optional()),
    customerLocationId: zfd.text(z.string().optional()),
    supplierId: zfd.text(z.string().optional()),
    supplierLocationId: zfd.text(z.string().optional()),
    shippingCost: zfd.numeric(z.number().optional()),
    notes: zfd.text(z.string().optional()),
    incoterm: zfd.text(z.enum(incoterms).optional()),
    incotermLocation: zfd.text(z.string().optional())
  })
  .refine(
    (data) => {
      if (data.dropShipment) {
        return data.customerId && data.customerLocationId;
      }
      return true;
    },
    {
      message: "Drop shipment requires customer and location",
      path: ["customerLocationId"]
    }
  );

/**
 * A service period is both dates or neither, with the end on or after the
 * start. `zfd.text` has already turned an empty submission into undefined.
 * A malformed date fails the check instead of throwing out of the refine.
 */
function isValidServicePeriod(data: {
  serviceStartDate?: string;
  serviceEndDate?: string;
}): boolean {
  const { serviceStartDate, serviceEndDate } = data;
  if (!serviceStartDate && !serviceEndDate) return true;
  if (!serviceStartDate || !serviceEndDate) return false;
  try {
    return parseDate(serviceEndDate).compare(parseDate(serviceStartDate)) >= 0;
  } catch {
    return false;
  }
}

export const salesOrderLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    salesOrderId: z.string().min(1, { message: "Order is required" }),
    salesOrderLineType: z.enum(salesOrderLineType, {
      error: "Type is required"
    }),
    accountId: zfd.text(z.string().optional()),
    shippingCost: zfd.numeric(z.number().optional()),
    addOnCost: zfd.numeric(z.number().optional()),
    nonTaxableAddOnCost: zfd.numeric(z.number().optional()),
    assetId: zfd.text(z.string().optional()),
    description: zfd.text(z.string().optional()),
    itemId: zfd.text(z.string().optional()),
    locationId: z.string().min(0, { message: "Location is required" }),
    // Wrapped in zfd.text so an empty-string submission (the form always posts a
    // hidden methodType) coerces to undefined instead of failing the enum check.
    // Requiredness is enforced conditionally by the refine below, which exempts
    // Comment and Fixed Asset lines.
    methodType: zfd.text(
      z
        .enum(methodType, {
          error: "Method is required"
        })
        .optional()
    ),
    modelUploadId: zfd.text(z.string().optional()),
    promisedDate: zfd.text(z.string().optional()),
    saleQuantity: zfd.numeric(z.number().optional()),
    serviceId: zfd.text(z.string().optional()),
    serviceStartDate: zfd.text(z.string().optional()),
    serviceEndDate: zfd.text(z.string().optional()),
    setupPrice: zfd.numeric(z.number().optional()),
    storageUnitId: zfd.text(z.string().optional()),
    taxPercent: zfd.numeric(
      z
        .number()
        .min(0)
        .max(1, { message: "Tax percent must be between 0 and 1" })
    ),
    unitOfMeasureCode: zfd.text(z.string().optional()),
    unitPrice: zfd.numeric(z.number().optional()),
    exchangeRate: zfd.numeric(z.number().optional()),
    // Configurator values keyed by configurationParameter key, posted as JSON.
    configuration: z.preprocess(
      parseJsonField,
      z.record(z.string(), z.any()).nullable().optional()
    ),
    // How unitPrice was resolved, posted as JSON; "null" clears it when the
    // price was typed rather than resolved.
    priceTrace: z.preprocess(
      parseJsonField,
      z.array(priceTraceStepValidator).nullable().optional()
    )
  })
  .refine((data) => (data.salesOrderLineType === "Part" ? data.itemId : true), {
    message: "Part is required",
    path: ["itemId"] // path of error
  })
  .refine(
    (data) => (data.salesOrderLineType === "Comment" ? data.description : true),
    {
      message: "Comment is required",
      path: ["description"] // path of error
    }
  )
  .refine(
    (data) => {
      if (
        data.salesOrderLineType !== "Comment" &&
        data.salesOrderLineType !== "Fixed Asset"
      ) {
        return !!data.itemId;
      }
      return true;
    },
    {
      message: "Item is required for this line type",
      path: ["itemId"]
    }
  )
  .refine(
    (data) => {
      if (
        data.salesOrderLineType !== "Comment" &&
        data.salesOrderLineType !== "Fixed Asset" &&
        !data.methodType
      ) {
        return false;
      }
      return true;
    },
    {
      message: "Method type is required",
      path: ["methodType"]
    }
  )
  .refine(
    (data) =>
      data.salesOrderLineType === "Fixed Asset"
        ? (data.saleQuantity ?? 1) === 1
        : true,
    {
      message: "Fixed Asset quantity must be 1",
      path: ["saleQuantity"]
    }
  )
  .refine((data) => isValidServicePeriod(data), {
    message: "Service end must be on or after service start",
    path: ["serviceEndDate"]
  })
  .refine(
    (data) =>
      data.salesOrderLineType === "Service" ||
      (!data.serviceStartDate && !data.serviceEndDate),
    {
      message: "Service dates only apply to Service lines",
      path: ["serviceStartDate"]
    }
  );

export const salesOrderPaymentValidator = z.object({
  id: z.string(),
  invoiceCustomerId: zfd.text(z.string().optional()),
  invoiceCustomerLocationId: zfd.text(z.string().optional()),
  invoiceCustomerContactId: zfd.text(z.string().optional()),
  paymentTermId: zfd.text(z.string().optional()),
  paymentComplete: zfd.checkbox(),
  currencyCode: z.enum(currencyCodes).optional()
});

export const salesOrderReleaseValidator = z
  .object({
    notification: z.enum(["Email", "None"]).optional(),
    customerContact: zfd.text(z.string().optional())
  })
  .refine(
    (data) => (data.notification === "Email" ? data.customerContact : true),
    {
      message: "Customer contact is required for email",
      path: ["customerContact"] // path of error
    }
  );

export const salesRfqValidator = z.object({
  id: zfd.text(z.string().optional()),
  rfqId: zfd.text(z.string().optional()),
  customerLocationId: zfd.text(z.string().optional()),
  customerContactId: zfd.text(z.string().optional()),
  customerEngineeringContactId: zfd.text(z.string().optional()),
  customerId: z.string().min(1, { message: "Customer is required" }),
  customerReference: zfd.text(z.string().optional()),
  expirationDate: zfd.text(z.string().optional()),
  externalNotes: zfd.text(z.string().optional()),
  internalNotes: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  rfqDate: z.string().min(1, { message: "Order Date is required" }),
  status: z.enum(salesRFQStatusType).optional(),
  salesPersonId: zfd.text(z.string().optional())
});

export const salesRfqDragValidator = z.object({
  id: z.string(),
  customerPartId: z.string(),
  is3DModel: z.boolean().optional(),
  size: z.number().optional(),
  lineId: z.string().optional(),
  path: z.string(),
  salesRfqId: z.string()
});

export const salesRfqLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  salesRfqId: z.string().min(1, { message: "RFQ is required" }),
  customerPartId: z.string().min(1, { message: "Part Number is required" }),
  customerPartRevision: zfd.text(z.string().optional()),
  itemId: zfd.text(z.string().optional()),
  description: zfd.text(z.string().optional()),
  quantity: z.array(
    zfd.numeric(z.number().min(0.00001, { message: "Quantity is required" }))
  ),
  unitOfMeasureCode: z
    .string()
    .min(1, { message: "Unit of measure is required" }),
  order: zfd.numeric(z.number().min(0)),
  modelUploadId: zfd.text(z.string().optional())
});

// The `convert` server function derives every financial field (net unit price,
// shipping, add-ons) from the canonical quoteLinePrice rows server-side. These
// money fields are UI/display only and are NOT trusted as an input to quote
// conversion — only `quantity` (the selected quantity break) is authoritative.
export const selectedLineSchema = z.object({
  addOn: z.number().optional(),
  convertedAddOn: z.number().optional(),
  taxableAddOn: z.number().optional(),
  convertedTaxableAddOn: z.number().optional(),
  convertedNetUnitPrice: z.number(),
  convertedShippingCost: z.number(),
  leadTime: z.number(),
  netUnitPrice: z.number(),
  quantity: z.number().min(0),
  shippingCost: z.number()
});

export const selectedLinesValidator = z.record(z.string(), selectedLineSchema);

// Quote lead-time prediction — a JSON body (not FormData), so plain zod.
export const quoteLeadTimeValidator = z.object({
  // Each quantity runs two full scheduling simulations; cap the per-request work.
  quantities: z.array(z.number().positive()).min(1).max(50),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable()
});

// Sales Order Locked Status
export const SALES_ORDER_LOCKED_STATUSES = [
  "To Ship and Invoice",
  "To Ship",
  "To Invoice",
  "Completed",
  "Cancelled",
  "Closed"
] as const;

export function isSalesOrderLocked(status: string | null | undefined): boolean {
  return SALES_ORDER_LOCKED_STATUSES.includes(
    status as (typeof SALES_ORDER_LOCKED_STATUSES)[number]
  );
}

// Sales RFQ Locked Status
export function isSalesRfqLocked(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && status !== "Draft";
}

// Quote Locked Status
export function isQuoteLocked(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && status !== "Draft";
}

// -----------------------------------------------------------------------------
// Sales Rules — predicate rules evaluated when an item is added to a sales
// document (quote line / sales order line). Distinct from storage rules
// (`~/modules/inventory`, warehouse/MES surfaces) and the configurator's
// `configurationRule`. The AST schema and engine are shared via @carbon/utils.
// -----------------------------------------------------------------------------
export const salesRuleSeverities = RULE_SEVERITIES;

export const salesRuleValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().trim().min(1, { message: "Name is required" }).max(120),
    description: zfd.text(z.string().optional()),
    message: z.string().min(1, { message: "Message is required" }).max(500),
    severity: z.enum(salesRuleSeverities),
    // Sales rules are always item-target and broadcast via the filteredItem*
    // columns (empty = all items), so there is no targetType/appliesToAll.
    filteredItemTypes: zfd.repeatableOfType(z.string()).optional(),
    filteredItemGroupIds: zfd.repeatableOfType(z.string()).optional(),
    filteredItemMatchAll: zfd.checkbox(),
    active: zfd.checkbox(),
    surfaces: zfd
      .repeatableOfType(z.enum(SALES_RULE_SURFACES))
      .refine((arr) => arr.length >= 1, {
        message: "Pick at least one surface"
      }),
    conditionAst: conditionAstFormField
  })
  .superRefine((val, ctx) => {
    // Reject conditions on a registry field whose context the evaluator won't
    // populate for every selected surface (else it resolves undefined → false
    // "X is required"). Unknown paths are left to runtime presence handling.
    val.conditionAst.conditions.forEach((c, i) => {
      const def = getFieldDef(c.field);
      if (def && !isFieldAvailableOnSalesRuleSurfaces(def, val.surfaces)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["conditionAst", "conditions", i, "field"],
          message: `"${def.label}" isn't available on the selected surface(s)`
        });
      }
    });
  });
// ─── Sales Return Orders (RMAs) ───

export const salesReturnOrderStatusType = [
  "Draft",
  "To Receive",
  "Completed",
  "Cancelled"
] as const;

// Picker subset of the DB `disposition` enum for RMA lines — same
// commented-subset technique as `disposition` in quality.models.ts. Scrap and
// Rework are set via Issue escalation, not directly.
export const salesReturnDispositionType = [
  // "Conditional Acceptance",
  // "Deviation Accepted",
  // "Hold",
  // "No Action Required",
  "Pending",
  // "Quarantine",
  "Repair",
  "Return to Customer",
  "Rework",
  "Scrap",
  "Use As Is"
] as const;

/** Why a line's Repair disposition cannot change once it has received. */
export const REPAIR_DISPOSITION_LOCKED_MESSAGE =
  "A line's Repair disposition is set before receipt and cannot change after it. Void the receipt to change it.";

/** Why a Repair line takes no credit memo: the unit goes back to the customer. */
export const REPAIR_LINE_CREDIT_MESSAGE =
  "Change the disposition before you credit a repair line.";

/** Why an RMA of Repair lines only gets no replacement order. */
export const REPAIR_ONLY_REPLACEMENT_MESSAGE =
  "Every line is a repair. There is nothing to replace.";

/** The dispositions a line can take before any quantity is received. */
export const salesReturnPreReceiptDispositions = ["Pending", "Repair"] as const;

export const SALES_RETURN_ORDER_LOCKED_STATUSES = [
  "Completed",
  "Cancelled"
] as const;

export function isSalesReturnOrderLocked(
  status: string | null | undefined
): boolean {
  return SALES_RETURN_ORDER_LOCKED_STATUSES.includes(
    status as (typeof SALES_RETURN_ORDER_LOCKED_STATUSES)[number]
  );
}

export const returnReasonValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().trim().min(1, { message: "Name is required" }),
  inventoryValueZero: zfd.checkbox()
});

export const salesReturnOrderValidator = z.object({
  id: zfd.text(z.string().optional()),
  salesReturnOrderId: zfd.text(z.string().optional()),
  status: z.enum(salesReturnOrderStatusType).optional(),
  customerId: z.string().min(1, { message: "Customer is required" }),
  customerLocationId: zfd.text(z.string().optional()),
  customerContactId: zfd.text(z.string().optional()),
  customerReference: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  salesOrderId: zfd.text(z.string().optional()),
  currencyCode: zfd.text(z.string().optional()),
  exchangeRate: zfd.numeric(z.number().optional()),
  orderDate: z.string().min(1, { message: "Order date is required" }),
  expirationDate: zfd.text(z.string().optional()),
  assignee: zfd.text(z.string().optional())
});

export const salesReturnOrderLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  salesReturnOrderId: z
    .string()
    .min(1, { message: "Return order is required" }),
  itemId: z.string().min(1, { message: "Item is required" }),
  quantity: zfd.numeric(
    z.number().gt(0, { message: "Quantity must be positive" })
  ),
  unitOfMeasureCode: zfd.text(z.string().optional()),
  unitPrice: zfd.numeric(z.number().min(0)),
  restockFeePercent: zfd.numeric(z.number().min(0).max(1).optional()),
  returnReasonId: zfd.text(z.string().optional()),
  salesOrderLineId: zfd.text(z.string().optional()),
  shipmentLineId: zfd.text(z.string().optional()),
  salesInvoiceLineId: zfd.text(z.string().optional())
});

export const salesReturnOrderDispositionValidator = z.object({
  lineId: z.string().min(1),
  disposition: z.enum(salesReturnDispositionType, {
    error: "Disposition is required"
  })
});

// Credit dialog: repeatable per-line quantity rows (same encoding as
// selectedLines in purchasing.models.ts — a JSON-encoded field)
export const salesReturnOrderCreditValidator = z.object({
  lines: z
    .string()
    .transform((val, ctx) => {
      try {
        return JSON.parse(val) as unknown;
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid lines" });
        return z.NEVER;
      }
    })
    .pipe(
      z
        .array(
          z.object({
            salesReturnOrderLineId: z.string().min(1),
            quantity: z.number().min(0)
          })
        )
        .min(1, { message: "At least one line is required" })
    )
});

// Rental agreements (spec §3): the agreement header, its lines (one fleet
// unit each), variable charges, the return form and the item rate ladder.
// Every enum value comes from these arrays — the DB enums of the same name.

export const rentalAgreementStatuses = [
  "Draft",
  "Active",
  "Closed",
  "Cancelled"
] as const;

export const rentalAgreementLineStatuses = [
  "Pending",
  "On Rent",
  "Returned",
  "Sold"
] as const;

export const rentalBillingCycles = ["Calendar Month", "28 Days"] as const;

export const rentalBillingTimings = ["Advance", "Arrears"] as const;

/** What happens to an invoice the daily run creates — the DB enum
 *  `invoiceAutomation`. An agreement's null falls back to the company's. */
export const invoiceAutomations = [
  "Draft Only",
  "Post",
  "Post and Email",
  "Post and Send via Stripe"
] as const;

/** A rental unit's rate frequency: what one unit of its `rate` buys. */
export const rentalRateUnits = ["Day", "Week", "Month"] as const;

export const rentalInvoiceLineTypes = [
  "Rent",
  "Charge",
  "Purchase Option"
] as const;

/**
 * The end date, when given, falls after the start date (the table's CHECK).
 * `zfd.text` has already turned an empty submission into undefined. A
 * malformed date fails the check instead of throwing out of the refine.
 */
function isEndDateAfterStart(data: {
  startDate: string;
  endDate?: string;
}): boolean {
  if (!data.endDate) return true;
  try {
    return parseDate(data.endDate).compare(parseDate(data.startDate)) > 0;
  } catch {
    return false;
  }
}

export const rentalAgreementValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    rentalAgreementId: zfd.text(z.string().optional()),
    customerId: z.string().min(1, { message: "Customer is required" }),
    customerLocationId: zfd.text(z.string().optional()),
    customerContactId: zfd.text(z.string().optional()),
    salesPersonId: zfd.text(z.string().optional()),
    locationId: z.string().min(1, { message: "Location is required" }),
    startDate: z.string().min(1, { message: "Start date is required" }),
    endDate: zfd.text(z.string().optional()),
    billingCycle: z.enum(rentalBillingCycles, {
      error: "Billing cycle is required"
    }),
    billingTiming: z.enum(rentalBillingTimings, {
      error: "Billing timing is required"
    }),
    paymentTermId: zfd.text(z.string().optional()),
    currencyCode: z.string().min(1, { message: "Currency is required" }),
    exchangeRate: zfd.numeric(z.number().optional()),
    depositAmount: zfd.numeric(
      z.number().min(0, { message: "Deposit cannot be negative" })
    ),
    taxPercent: zfd.numeric(
      z
        .number()
        .min(0)
        .max(1, { message: "Tax percent must be between 0 and 1" })
    ),
    discountRate: zfd.numeric(
      z.number().min(0, { message: "Discount rate cannot be negative" })
    ),
    ownershipTransfers: zfd.checkbox(),
    specializedAsset: zfd.checkbox(),
    purchaseOptionAmount: zfd.numeric(
      z
        .number()
        .min(0, { message: "Purchase option cannot be negative" })
        .optional()
    ),
    purchaseOptionReasonablyCertain: zfd.checkbox(),
    notes: zfd.text(z.string().optional())
  })
  .refine(isEndDateAfterStart, {
    message: "End date must be after the start date",
    path: ["endDate"]
  })
  .refine(
    (data) => (data.purchaseOptionReasonablyCertain ? !!data.endDate : true),
    {
      message: "A purchase option that is reasonably certain needs an end date",
      path: ["endDate"]
    }
  );

export const rentalAgreementInvoiceAutomationValidator = z.object({
  invoiceAutomation: z.enum(invoiceAutomations).nullable()
});

export const rentalAgreementLineValidator = z.object({
  id: zfd.text(z.string().optional()),
  rentalAgreementId: z
    .string()
    .min(1, { message: "Rental agreement is required" }),
  fixedAssetId: z.string().min(1, { message: "Fleet unit is required" }),
  itemId: zfd.text(z.string().optional()),
  rateUnit: z.enum(rentalRateUnits, { error: "Rate frequency is required" }),
  /** Omitted by an API caller: the customer's, customer type's or item's
   *  rate for the frequency is used. The form always sends one. */
  rate: zfd.numeric(
    z.number().min(0, { message: "Rate cannot be negative" }).optional()
  ),
  fairValue: zfd.numeric(z.number().min(0).optional()),
  economicLifeMonths: zfd.numeric(
    z
      .number()
      .int()
      .positive({ message: "Economic life must be positive" })
      .optional()
  ),
  guaranteedResidualValue: zfd.numeric(z.number().min(0).optional()),
  unguaranteedResidualValue: zfd.numeric(z.number().min(0).optional())
});

/** Several fleet units at once (the setup wizard's Add Units), each at its
 *  rate on file for the frequency. */
export const rentalAgreementLinesAddValidator = z.object({
  fixedAssetIds: z
    .array(z.string().min(1))
    .min(1, { message: "Choose at least one unit" }),
  rateUnit: z.enum(rentalRateUnits, { error: "Rate frequency is required" })
});

/** No `chargeType`: the form only ever adds a `Charge`. `Rent` comes from the
 *  schedule and `Purchase Option` from Sell to Customer, both server-side. */
export const rentalAgreementChargeValidator = z.object({
  id: zfd.text(z.string().optional()),
  rentalAgreementLineId: z
    .string()
    .min(1, { message: "Rental agreement line is required" }),
  chargeDate: z.string().min(1, { message: "Charge date is required" }),
  description: z.string().trim().min(1, { message: "Description is required" }),
  amount: zfd.numeric(z.number()),
  taxPercent: zfd.numeric(
    z.number().min(0).max(1, { message: "Tax percent must be between 0 and 1" })
  ),
  /** Drafted on its own invoice, held for review, instead of with the rent. */
  invoiceSeparately: zfd.checkbox()
});

/** Where a Sale unit's closing net investment goes when it comes back
 *  (spec §4): a new asset in the Rental Fleet class, or finished goods. */
export const rentalResidualDestinations = ["Fleet", "Inventory"] as const;

export const rentalAgreementReleaseValidator = z.object({
  rentalAgreementLineId: z
    .string()
    .min(1, { message: "Rental agreement line is required" }),
  returnedAt: z.string().min(1, { message: "Release date is required" })
});

export const lessorClassificationOverrides = ["Rental", "Sale"] as const;

/** A manual lessor classification (spec §4), audit-logged with its reason. */
export const rentalAgreementLineClassificationValidator = z.object({
  classification: z.enum(lessorClassificationOverrides, {
    error: "Classification is required"
  }),
  reason: z.string().trim().min(1, { message: "A reason is required" })
});

/** One customer's (or customer type's) rental rates for an item — exactly
 *  one scope, at least one tier. */
export const customerItemRentalRateValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    itemId: z.string().min(1, { message: "Item is required" }),
    currencyCode: z.string().min(1, { message: "Currency is required" }),
    customerId: zfd.text(z.string().optional()),
    customerTypeId: zfd.text(z.string().optional()),
    dayRate: zfd.numeric(z.number().min(0).optional()),
    weekRate: zfd.numeric(z.number().min(0).optional()),
    monthRate: zfd.numeric(z.number().min(0).optional()),
    validFrom: zfd.text(z.string().optional()),
    validTo: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  })
  .refine((data) => !!data.customerId !== !!data.customerTypeId, {
    message: "Choose a customer or a customer type",
    path: ["customerId"]
  })
  .refine(
    (data) =>
      [data.dayRate, data.weekRate, data.monthRate].some(
        (rate) => rate !== undefined
      ),
    {
      message: "At least one of day, week or month rate is required",
      path: ["dayRate"]
    }
  )
  .refine(
    (data) =>
      !data.validFrom || !data.validTo || data.validTo >= data.validFrom,
    { message: "Valid To must be on or after Valid From", path: ["validTo"] }
  );

export const itemRentalRateValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    itemId: z.string().min(1, { message: "Item is required" }),
    currencyCode: z.string().min(1, { message: "Currency is required" }),
    dayRate: zfd.numeric(z.number().min(0).optional()),
    weekRate: zfd.numeric(z.number().min(0).optional()),
    monthRate: zfd.numeric(z.number().min(0).optional())
  })
  .refine(
    (data) =>
      [data.dayRate, data.weekRate, data.monthRate].some(
        (rate) => rate !== undefined
      ),
    {
      message: "At least one of day, week or month rate is required",
      path: ["dayRate"]
    }
  );

// ----------------------------------------------------------------------
// Customer contracts (`.ai/specs/implemented/2026-09-22-revenue-recognition-rentals-and-contracts.md` Part III): the header, its
// lines, edits to the invoice schedule, amendments, cancellation and Create
// Contract from a sales order. Each enum array mirrors the DB enum of the
// same name. Percentages on these forms are percent POINTS (10 = 10%); the
// services divide by 100 before writing the 0–1 fraction the columns hold.

type Enums = Database["public"]["Enums"];

export const customerContractStatuses = [
  "Draft",
  "Active",
  "Ended"
] as const satisfies readonly Enums["customerContractStatus"][];

export const customerContractTypes = [
  "New Sales",
  "Existing",
  "Expansion",
  "Reactivation",
  "Contraction"
] as const satisfies readonly Enums["customerContractType"][];

/**
 * The R&D tax facts of a contract (Government Contracting 5d). They stay
 * editable in any status: they are tax facts, not terms.
 */
export const customerContractResearchFields = [
  "researchFunded",
  "paymentContingentOnSuccess",
  "contractorRetainsRights"
] as const;
export type CustomerContractResearchField =
  (typeof customerContractResearchFields)[number];

export const contractRevenueTypes = [
  "One-time",
  "Recurring"
] as const satisfies readonly Enums["contractRevenueType"][];

export const contractRateUnits = [
  "Day",
  "Week",
  "Month",
  "Quarter",
  "Year"
] as const satisfies readonly Enums["contractRateUnit"][];

export const contractBillingFrequencies = [
  "Week",
  "Month",
  "Quarter",
  "Year"
] as const satisfies readonly Enums["contractBillingFrequency"][];

export const contractBillingAlignments = [
  "Anniversary",
  "Calendar"
] as const satisfies readonly Enums["contractBillingAlignment"][];

export const contractBillingTimings = [
  "Advance",
  "Arrears"
] as const satisfies readonly Enums["contractBillingTiming"][];

export const contractRenewals = [
  "End",
  "Renew"
] as const satisfies readonly Enums["contractRenewal"][];

export const contractBillingMethods = [
  "Fixed",
  "Time & Materials",
  "Cost Plus"
] as const satisfies readonly Enums["contractBillingMethod"][];

/** What a contract bills from: `Schedule` is a service contract (its invoice
 *  schedule), `Project` a project contract (project cost and billing events). */
export const contractBillingBases = [
  "Schedule",
  "Project"
] as const satisfies readonly Enums["contractBillingBasis"][];

/** The billing methods a contract's lines may use: a service contract bills
 *  only on its schedule. */
export function contractBillingMethodsFor(
  basis: (typeof contractBillingBases)[number]
): readonly (typeof contractBillingMethods)[number][] {
  return basis === "Project" ? contractBillingMethods : ["Fixed"];
}

/** The header billing terms of a project contract. Its lines bill from
 *  project cost each billing period, in arrears on calendar periods, and it
 *  never renews; only the frequency is the user's choice. */
export const projectContractTermDefaults = {
  billingFrequency: "Month",
  billingAlignment: "Calendar",
  billingTiming: "Arrears",
  renewal: "End"
} as const satisfies {
  billingFrequency: (typeof contractBillingFrequencies)[number];
  billingAlignment: (typeof contractBillingAlignments)[number];
  billingTiming: (typeof contractBillingTimings)[number];
  renewal: (typeof contractRenewals)[number];
};

export const contractRevenueMethods = [
  "Daily",
  "Even Period",
  "Right to Invoice",
  "Percent Complete"
] as const satisfies readonly Enums["contractRevenueMethod"][];

/** Revenue methods a Fixed line plans on a schedule. */
export const contractScheduleRevenueMethods = ["Daily", "Even Period"] as const;

export const contractAmendmentEffects = [
  "Change Date",
  "Next Period"
] as const satisfies readonly Enums["contractAmendmentEffect"][];

export const contractInvoiceStatuses = [
  "Planned",
  "Invoiced",
  "Billed Externally"
] as const satisfies readonly Enums["contractInvoiceStatus"][];

/** The term a contract is signed for: a number of months, open-ended (no end
 *  date, bills until cancelled) or a custom end date. */
export const contractDurations = [
  "6",
  "12",
  "24",
  "36",
  "open",
  "custom"
] as const;

export type ContractDuration = (typeof contractDurations)[number];

/**
 * The end date and term a duration gives. N months ends the day before the
 * same date N months on (`@internationalized/date` clamps to month end), so a
 * 12-month contract starting 1 Nov 2026 ends 31 Oct 2027.
 */
export function contractEndDate(
  startDate: string,
  duration: ContractDuration,
  endDate?: string | null
): { endDate: string | null; termMonths: number | null } {
  if (duration === "open") return { endDate: null, termMonths: null };
  if (duration === "custom")
    return { endDate: endDate || null, termMonths: null };
  const termMonths = Number(duration);
  return {
    endDate: parseDate(startDate)
      .add({ months: termMonths })
      .subtract({ days: 1 })
      .toString(),
    termMonths
  };
}

/**
 * The contract term that covers sales order lines' service periods: the
 * earliest start and the latest end of the lines that have one. The term is a
 * month preset when the end falls exactly N months on (so it can renew),
 * else a custom end date. Null when no line has a service period.
 */
export function contractTermFromServicePeriods(
  lines: { serviceStartDate: string | null; serviceEndDate: string | null }[]
): { startDate: string; duration: ContractDuration; endDate?: string } | null {
  let startDate: string | null = null;
  let endDate: string | null = null;
  for (const line of lines) {
    if (!line.serviceStartDate || !line.serviceEndDate) continue;
    // YYYY-MM-DD, so string order is chronological.
    if (!startDate || line.serviceStartDate < startDate)
      startDate = line.serviceStartDate;
    if (!endDate || line.serviceEndDate > endDate)
      endDate = line.serviceEndDate;
  }
  if (!startDate || !endDate) return null;

  const start = startDate;
  const end = endDate;
  const preset = contractDurations.find(
    (duration) =>
      duration !== "open" &&
      duration !== "custom" &&
      contractEndDate(start, duration).endDate === end
  );
  return preset
    ? { startDate: start, duration: preset }
    : { startDate: start, duration: "custom", endDate: end };
}

/** `date` falls on or after `floor` shifted by `days`. An empty `date` passes
 *  (`zfd.text` has already turned an empty submission into undefined); a
 *  malformed one fails the check instead of throwing out of the refine. */
function isOnOrAfter(
  date: string | null | undefined,
  floor: string,
  days = 0
): boolean {
  if (!date) return true;
  try {
    return parseDate(date).compare(parseDate(floor).add({ days })) >= 0;
  } catch {
    return false;
  }
}

/** A JSON-encoded form field (the same encoding as `selectedLines`), parsed
 *  then checked against `schema`. */
function jsonField<T extends z.ZodType>(schema: T, message: string) {
  return z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
    })
    .pipe(schema);
}

export const customerContractValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    customerContractId: zfd.text(z.string().optional()),
    name: z.string().trim().min(1, { message: "Name is required" }),
    /** Omitted on create: suggested from the customer's previous contracts. */
    contractType: zfd.text(z.enum(customerContractTypes).optional()),
    customerId: z.string().min(1, { message: "Customer is required" }),
    invoiceCustomerId: zfd.text(z.string().optional()),
    invoiceCustomerContactId: zfd.text(z.string().optional()),
    invoiceCustomerLocationId: zfd.text(z.string().optional()),
    /** The customer's location the service is delivered to. Stored on the
     *  contract only — a sales invoice has no customer ship-to to copy it to. */
    shipToCustomerLocationId: zfd.text(z.string().optional()),
    salesPersonId: zfd.text(z.string().optional()),
    projectId: zfd.text(z.string().optional()),
    customerReference: zfd.text(z.string().optional()),
    closeDate: z.string().min(1, { message: "Close date is required" }),
    /** Omitted means `Schedule`, a service contract. A project contract has
     *  a period of performance instead of a term, so it takes no duration,
     *  renewal or billing timing. */
    billingBasis: zfd.text(z.enum(contractBillingBases).optional()),
    startDate: z.string().min(1, { message: "Start date is required" }),
    /** Required on a service contract. */
    duration: zfd.text(z.enum(contractDurations).optional()),
    /** Required when `duration` is `custom` and on a project contract;
     *  otherwise derived. */
    endDate: zfd.text(z.string().optional()),
    /** Required on a service contract. */
    renewal: zfd.text(z.enum(contractRenewals).optional()),
    /** Percent points: 3 = prices rise 3% at each renewal. */
    renewalUplift: zfd.numeric(
      z.number().min(0, { message: "Renewal uplift cannot be negative" })
    ),
    /** Required on a service contract. The three billing terms of a
     *  project contract default from `projectContractTermDefaults`. */
    billingFrequency: zfd.text(z.enum(contractBillingFrequencies).optional()),
    billingAlignment: zfd.text(z.enum(contractBillingAlignments).optional()),
    billingTiming: zfd.text(z.enum(contractBillingTimings).optional()),
    firstInvoiceDate: zfd.text(z.string().optional()),
    billedThrough: zfd.text(z.string().optional()),
    recognizeRevenueFrom: zfd.text(z.string().optional()),
    /** Empty means the company's default. */
    invoiceAutomation: zfd.text(z.enum(invoiceAutomations).optional()),
    paymentTermId: zfd.text(z.string().optional()),
    currencyCode: z.string().min(1, { message: "Currency is required" }),
    exchangeRate: zfd.numeric(z.number().optional()),
    notes: optionalTiptapDoc
  })
  .refine((data) => data.billingBasis === "Project" || !!data.duration, {
    message: "Duration is required",
    path: ["duration"]
  })
  .refine((data) => data.billingBasis === "Project" || !!data.renewal, {
    message: "Renewal is required",
    path: ["renewal"]
  })
  .refine(
    (data) => data.billingBasis === "Project" || !!data.billingFrequency,
    { message: "Billing frequency is required", path: ["billingFrequency"] }
  )
  .refine(
    (data) => data.billingBasis === "Project" || !!data.billingAlignment,
    { message: "Billing alignment is required", path: ["billingAlignment"] }
  )
  .refine((data) => data.billingBasis === "Project" || !!data.billingTiming, {
    message: "Billing timing is required",
    path: ["billingTiming"]
  })
  .refine((data) => data.billingBasis !== "Project" || !!data.projectId, {
    message: "Project is required",
    path: ["projectId"]
  })
  .refine(
    (data) =>
      data.duration === "custom" || data.billingBasis === "Project"
        ? !!data.endDate
        : true,
    {
      message: "End date is required",
      path: ["endDate"]
    }
  )
  .refine((data) => isOnOrAfter(data.endDate, data.startDate, -1), {
    message: "End date cannot be before the start date",
    path: ["endDate"]
  })
  .refine((data) => isOnOrAfter(data.billedThrough, data.startDate, -1), {
    message: "Billed through cannot be before the start date",
    path: ["billedThrough"]
  });

/** A percent-points field (0–100). */
function percentPoints(label: string) {
  return zfd.numeric(
    z
      .number()
      .min(0, { message: `${label} cannot be negative` })
      .max(100, { message: `${label} cannot exceed 100%` })
  );
}

/** An optional percent-points field (0–100); empty is absent. */
function optionalPercentPoints(label: string) {
  return zfd.numeric(
    z
      .number()
      .min(0, { message: `${label} cannot be negative` })
      .max(100, { message: `${label} cannot exceed 100%` })
      .optional()
  );
}

function optionalAmount(label: string) {
  return zfd.numeric(
    z
      .number()
      .min(0, { message: `${label} cannot be negative` })
      .optional()
  );
}

/** The funding of a billing line. `noticePercent` is in percent points
 *  (75–85), as FAR 52.232-20/-22 allow. */
const contractLineFundingFields = {
  fundedAmount: optionalAmount("Funded amount"),
  fundedCost: optionalAmount("Funded cost"),
  ceilingAmount: optionalAmount("Ceiling"),
  noticePercent: zfd.numeric(
    z
      .number()
      .min(75, { message: "The notice percent is 75% to 85%" })
      .max(85, { message: "The notice percent is 75% to 85%" })
      .default(75)
  ),
  noticeWindowDays: zfd.numeric(
    z
      .number()
      .int({ message: "Enter whole days" })
      .min(30, { message: "The notice window is 30 to 90 days" })
      .max(90, { message: "The notice window is 30 to 90 days" })
      .default(60)
  )
};

/** The funding of one billing line, edited on an Active contract (P9). */
export const contractLineFundingValidator = z.object({
  id: z.string().min(1, { message: "Line is required" }),
  ...contractLineFundingFields
});

/** One bill rate of a contract line: a labor category or an employee. */
export const contractLaborRateValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    customerContractLineId: z.string().min(1, { message: "Line is required" }),
    laborCategoryId: zfd.text(z.string().optional()),
    employeeId: zfd.text(z.string().optional()),
    billRate: zfd.numeric(
      z.number().min(0, { message: "The bill rate cannot be negative" })
    ),
    effectiveFrom: z.string().min(1, { message: "Effective from is required" })
  })
  .refine((rate) => !!rate.laborCategoryId !== !!rate.employeeId, {
    message: "Choose a labor category or an employee",
    path: ["laborCategoryId"]
  });

/** The fields of one contract line, shared by the line form and an
 *  amendment's added line. */
const contractLineFields = {
  revenueType: z.enum(contractRevenueTypes, {
    error: "Revenue type is required"
  }),
  itemId: z.string().min(1, { message: "Item is required" }),
  description: zfd.text(z.string().optional()),
  quantity: zfd.numeric(
    z.number().positive({ message: "Quantity must be greater than 0" })
  ),
  rate: zfd.numeric(z.number().min(0, { message: "Rate cannot be negative" })),
  /** Required for a Recurring line, absent for a One-time one. */
  rateUnit: zfd.text(z.enum(contractRateUnits).optional()),
  discountPercent: percentPoints("Discount"),
  discountEndsOn: zfd.text(z.string().optional()),
  taxPercent: percentPoints("Tax"),
  startDate: z.string().min(1, { message: "Start date is required" }),
  endDate: zfd.text(z.string().optional()),
  goLiveDate: zfd.text(z.string().optional()),
  revenueMethod: z.enum(contractRevenueMethods, {
    error: "Revenue method is required"
  }),
  revenueStartDate: zfd.text(z.string().optional()),
  revenueEndDate: zfd.text(z.string().optional()),
  projectId: zfd.text(z.string().optional()),
  // Project billing (Phase 4a). Absent means a Fixed line.
  billingMethod: zfd.text(z.enum(contractBillingMethods).default("Fixed")),
  projectElementId: zfd.text(z.string().optional()),
  materialHandlingPercent: optionalPercentPoints("Handling"),
  feePercent: optionalPercentPoints("Fee"),
  ...contractLineFundingFields
};

/** Revenue methods each billing method allows (plan decision P6). */
export const contractRevenueMethodsByBillingMethod = {
  Fixed: ["Daily", "Even Period", "Percent Complete"],
  "Time & Materials": ["Right to Invoice"],
  "Cost Plus": ["Percent Complete", "Right to Invoice"]
} as const satisfies Record<
  (typeof contractBillingMethods)[number],
  readonly (typeof contractRevenueMethods)[number][]
>;

/** The revenue methods a line may use on a contract of this basis. A project
 *  contract's Fixed Price line is earned by progress or by the day, never by
 *  even period. */
export function contractRevenueMethodsFor(
  basis: (typeof contractBillingBases)[number] | null | undefined,
  billingMethod: (typeof contractBillingMethods)[number]
): readonly (typeof contractRevenueMethods)[number][] {
  const methods = contractRevenueMethodsByBillingMethod[billingMethod];
  return basis === "Project" && billingMethod === "Fixed"
    ? methods.filter((method) => method !== "Even Period")
    : methods;
}

/** The billing fields of a new line: Fixed, with the notice defaults. */
export const newContractLineBillingValues = {
  billingMethod: "Fixed",
  noticePercent: 75,
  noticeWindowDays: 60
} as const;

/** A stored line's billing fields as the line form's values: percents in
 *  percent points. */
export function contractLineBillingFormValues(line: {
  billingMethod: (typeof contractBillingMethods)[number];
  projectElementId: string | null;
  materialHandlingPercent: number | null;
  feePercent: number | null;
  fundedAmount: number | null;
  fundedCost: number | null;
  ceilingAmount: number | null;
  noticePercent: number;
  noticeWindowDays: number;
}) {
  const points = (fraction: number | null) =>
    fraction === null ? undefined : round(Number(fraction) * 100);
  const amount = (value: number | null) =>
    value === null ? undefined : Number(value);
  return {
    billingMethod: line.billingMethod,
    projectElementId: line.projectElementId ?? undefined,
    materialHandlingPercent: points(line.materialHandlingPercent),
    feePercent: points(line.feePercent),
    fundedAmount: amount(line.fundedAmount),
    fundedCost: amount(line.fundedCost),
    ceilingAmount: amount(line.ceilingAmount),
    noticePercent: round(Number(line.noticePercent) * 100),
    noticeWindowDays: Number(line.noticeWindowDays)
  };
}

/** A line billed from project work rather than a schedule. */
export function isProjectBillingMethod(
  billingMethod: (typeof contractBillingMethods)[number] | null | undefined
) {
  return billingMethod === "Time & Materials" || billingMethod === "Cost Plus";
}

/** The default accounts a project contract posts through. An empty one does
 *  not stop Confirm, but its first posting fails. */
export const projectContractAccountDefaults = [
  "projectWorkInProgressAccount",
  "deferredRevenueAccount",
  "contractAssetAccount",
  "contractLossProvisionAccount"
] as const;

export type ProjectContractAccountDefault =
  (typeof projectContractAccountDefaults)[number];

/** What the Review step knows about a project contract. A fact the user may
 *  not read (RLS) is absent or null: it is unknown, and gives no gap. */
export type ProjectContractGapInput = {
  lines: {
    id: string;
    billingMethod: (typeof contractBillingMethods)[number];
    revenueMethod: (typeof contractRevenueMethods)[number];
    projectId: string | null;
    projectElementId: string | null;
  }[];
  /** The contract's project; a line without its own project bills it. */
  projectId: string | null;
  currencyCode: string;
  baseCurrencyCode: string | null;
  costTreatmentByProject: Record<string, Enums["projectCostTreatment"]>;
  /** Per element a line names: whether it is a billing element. */
  billingElementById: Record<string, boolean>;
  /** Per line: its price less the sum of its billing events. */
  residuals: Record<string, number>;
  /** The labor categories a Time & Materials line cannot price. */
  laborCategoriesWithoutBillRate: string[];
  emptyAccountDefaults: ProjectContractAccountDefault[] | null;
};

export type ProjectContractGap =
  | { key: "noLines"; blocking: true }
  | { key: "noBillingElement"; blocking: true; lineId: string }
  | {
      key: "notBillingElement";
      blocking: true;
      lineId: string;
      projectId: string;
      elementId: string;
    }
  | { key: "costTreatment"; blocking: true; projectId: string }
  | { key: "currency"; blocking: true; baseCurrencyCode: string }
  | { key: "billingEvents"; blocking: true; lineId: string; residual: number }
  | { key: "laborBillRate"; blocking: false; count: number }
  | {
      key: "accountDefault";
      blocking: false;
      account: ProjectContractAccountDefault;
    };

/** What stops a project contract's Confirm, and what it should fix first.
 *  The blocking gaps mirror `checkBillingLines` (post-customer-contract), so
 *  the Review step says it before the server refuses it. */
export function projectContractGaps(
  input: ProjectContractGapInput
): ProjectContractGap[] {
  const { lines } = input;
  if (lines.length === 0) return [{ key: "noLines", blocking: true }];
  const gaps: ProjectContractGap[] = [];

  const progress = lines.filter(
    (line) =>
      line.billingMethod !== "Fixed" ||
      line.revenueMethod === "Percent Complete"
  );
  if (
    progress.length > 0 &&
    input.baseCurrencyCode &&
    input.baseCurrencyCode !== input.currencyCode
  ) {
    gaps.push({
      key: "currency",
      blocking: true,
      baseCurrencyCode: input.baseCurrencyCode
    });
  }

  const flaggedProjects = new Set<string>();
  for (const line of lines.filter((l) =>
    isProjectBillingMethod(l.billingMethod)
  )) {
    const projectId = line.projectId ?? input.projectId;
    if (!projectId || !line.projectElementId) {
      gaps.push({ key: "noBillingElement", blocking: true, lineId: line.id });
      continue;
    }
    const treatment = input.costTreatmentByProject[projectId];
    if (treatment && treatment !== "Contract") {
      // One row per project; its elements cannot be billing elements yet.
      if (!flaggedProjects.has(projectId)) {
        flaggedProjects.add(projectId);
        gaps.push({ key: "costTreatment", blocking: true, projectId });
      }
      continue;
    }
    if (input.billingElementById[line.projectElementId] === false) {
      gaps.push({
        key: "notBillingElement",
        blocking: true,
        lineId: line.id,
        projectId,
        elementId: line.projectElementId
      });
    }
  }

  for (const line of lines.filter((l) => l.billingMethod === "Fixed")) {
    const residual = input.residuals[line.id];
    if (residual !== undefined && !equals(residual, 0)) {
      gaps.push({
        key: "billingEvents",
        blocking: true,
        lineId: line.id,
        residual
      });
    }
  }

  if (
    lines.some((line) => line.billingMethod === "Time & Materials") &&
    input.laborCategoriesWithoutBillRate.length > 0
  ) {
    gaps.push({
      key: "laborBillRate",
      blocking: false,
      count: input.laborCategoriesWithoutBillRate.length
    });
  }

  for (const account of input.emptyAccountDefaults ?? []) {
    gaps.push({ key: "accountDefault", blocking: false, account });
  }

  return gaps;
}

/** The active labor categories a Time & Materials line cannot price: no bill
 *  rate of their own, and no contract labor rate on every T&M line. */
export function laborCategoriesWithoutBillRate(args: {
  categories: {
    id: string;
    name: string;
    active: boolean;
    rates: { billRate: number | null }[];
  }[];
  timeAndMaterialsLineIds: string[];
  lineRates: {
    customerContractLineId: string;
    laborCategoryId: string | null;
  }[];
}): string[] {
  if (args.timeAndMaterialsLineIds.length === 0) return [];
  const covered = new Set(
    args.lineRates.flatMap((rate) =>
      rate.laborCategoryId
        ? [`${rate.customerContractLineId}:${rate.laborCategoryId}`]
        : []
    )
  );
  return args.categories
    .filter(
      (category) =>
        category.active &&
        !category.rates.some((rate) => rate.billRate !== null) &&
        args.timeAndMaterialsLineIds.some(
          (lineId) => !covered.has(`${lineId}:${category.id}`)
        )
    )
    .map((category) => category.name);
}

type BillingTerms = {
  revenueMethod: (typeof contractRevenueMethods)[number];
  projectId?: string;
  billingMethod: (typeof contractBillingMethods)[number];
  projectElementId?: string;
  feePercent?: number;
};

/** The billing rules of a line (plan decision P6 and the line CHECKs). */
function checkBillingTerms(line: BillingTerms, ctx: z.RefinementCtx) {
  const allowed: readonly string[] =
    contractRevenueMethodsByBillingMethod[line.billingMethod];
  if (!allowed.includes(line.revenueMethod)) {
    ctx.addIssue({
      code: "custom",
      message: `A ${line.billingMethod} line cannot use ${line.revenueMethod}`,
      path: ["revenueMethod"]
    });
  }
  if (isProjectBillingMethod(line.billingMethod)) {
    if (!line.projectId) {
      ctx.addIssue({
        code: "custom",
        message: "A billing line needs a project",
        path: ["projectId"]
      });
    }
    if (!line.projectElementId) {
      ctx.addIssue({
        code: "custom",
        message: "A billing line needs a billing element",
        path: ["projectElementId"]
      });
    }
  }
  if (line.billingMethod === "Cost Plus" && line.feePercent === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "A Cost Plus line needs a fee",
      path: ["feePercent"]
    });
  }
  if (
    line.revenueMethod === "Percent Complete" &&
    !isProjectBillingMethod(line.billingMethod) &&
    !line.projectElementId
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Percent Complete needs a billing element",
      path: ["projectElementId"]
    });
  }
}

/** The billing terms of an amendment's added line, edited apart from the
 *  amendment grid. Percents in percent points. */
export const contractLineBillingTermsValidator = z
  .object({
    billingMethod: contractLineFields.billingMethod,
    revenueMethod: contractLineFields.revenueMethod,
    projectId: contractLineFields.projectId,
    projectElementId: contractLineFields.projectElementId,
    materialHandlingPercent: contractLineFields.materialHandlingPercent,
    feePercent: contractLineFields.feePercent,
    ...contractLineFundingFields
  })
  .superRefine(checkBillingTerms);

function checkContractLine(
  line: BillingTerms & {
    revenueType: (typeof contractRevenueTypes)[number];
    rateUnit?: string;
    startDate: string;
    endDate?: string;
    discountEndsOn?: string;
  },
  ctx: z.RefinementCtx
) {
  checkBillingTerms(line, ctx);
  if (line.revenueType === "Recurring" && !line.rateUnit) {
    ctx.addIssue({
      code: "custom",
      message: "Rate unit is required for a recurring line",
      path: ["rateUnit"]
    });
  }
  if (line.revenueType === "One-time" && line.rateUnit) {
    ctx.addIssue({
      code: "custom",
      message: "A one-time line has no rate unit",
      path: ["rateUnit"]
    });
  }
  if (!isOnOrAfter(line.endDate, line.startDate)) {
    ctx.addIssue({
      code: "custom",
      message: "End date cannot be before the start date",
      path: ["endDate"]
    });
  }
  // Within [startDate, endDate): an end date the day after the discount ends.
  if (line.discountEndsOn) {
    const withinLine =
      isOnOrAfter(line.discountEndsOn, line.startDate) &&
      isOnOrAfter(line.endDate, line.discountEndsOn, 1);
    if (!withinLine) {
      ctx.addIssue({
        code: "custom",
        message:
          "The discount must end on or after the start date and before the end date",
        path: ["discountEndsOn"]
      });
    }
  }
}

/** A CLIN (`0001`), or a SubCLIN (`0001AA` or `000101`). */
export const CONTRACT_LINE_ITEM_NUMBER_PATTERN =
  /^[0-9]{4}([A-Z]{2}|[0-9]{2})?$/;

export const customerContractLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    customerContractId: z.string().min(1, { message: "Contract is required" }),
    ...contractLineFields,
    // Government Contracting 5a: the CLIN or SubCLIN number, and the CLIN a
    // SubCLIN belongs to.
    lineItemNumber: zfd.text(
      z
        .string()
        .trim()
        .regex(CONTRACT_LINE_ITEM_NUMBER_PATTERN, {
          message: "Use 4 digits, then 2 letters or 2 digits for a SubCLIN"
        })
        .optional()
    ),
    parentLineId: zfd.text(z.string().optional())
  })
  .superRefine(checkContractLine);

/** One funding action (a contract modification) on a billing line. */
export const customerContractFundingValidator = z.object({
  id: zfd.text(z.string().optional()),
  customerContractLineId: z.string().min(1, { message: "Line is required" }),
  modificationNumber: z
    .string()
    .trim()
    .min(1, { message: "Modification number is required" }),
  fundedDate: z.string().min(1, { message: "Funded date is required" }),
  acrn: z
    .string()
    .trim()
    .regex(/^[A-Z0-9]{2}$/, { message: "Use 2 capital letters or digits" }),
  fundedCost: zfd.numeric(
    z.number().min(0, { message: "Funded cost cannot be negative" })
  ),
  fundedFee: zfd.numeric(
    z.number().min(0, { message: "Funded fee cannot be negative" })
  ),
  expiresOn: zfd.text(z.string().optional())
});

/** One amount per contract line, JSON-encoded: an added invoice or month.
 *  At least one must be above zero. */
const contractLineAmounts = jsonField(
  z
    .array(
      z.object({
        customerContractLineId: z.string().min(1),
        amount: z.number().min(0, { message: "Amount cannot be negative" })
      })
    )
    .refine((amounts) => amounts.some((entry) => entry.amount > 0), {
      message: "Enter an amount for at least one line"
    }),
  "Invalid amounts"
);

/** One edit to a Draft contract's invoice schedule. The first edit
 *  materializes the computed schedule; `reset` throws the edits away. */
export const customerContractScheduleEditValidator = z.discriminatedUnion(
  "intent",
  [
    z.object({
      intent: z.literal("move"),
      customerContractInvoiceId: z.string().min(1),
      invoiceDate: z.string().min(1, { message: "Invoice date is required" })
    }),
    z.object({
      intent: z.literal("split"),
      customerContractInvoiceLineId: z.string().min(1),
      installments: jsonField(
        z
          .array(
            z.object({
              invoiceDate: z
                .string()
                .min(1, { message: "Invoice date is required" }),
              amount: z.number()
            })
          )
          .min(2, { message: "Split into at least two installments" }),
        "Invalid installments"
      )
    }),
    z.object({
      intent: z.literal("merge"),
      sourceInvoiceId: z.string().min(1),
      targetInvoiceId: z
        .string()
        .min(1, { message: "Choose the invoice to merge into" })
    }),
    z.object({
      intent: z.literal("moveLine"),
      customerContractInvoiceLineId: z.string().min(1),
      invoiceDate: z.string().min(1, { message: "Invoice date is required" })
    }),
    // The invoice grid (plan D10): one cell, one invoice, one deletion. Money
    // only moves — the footer shows what each line has left to invoice.
    z.object({
      intent: z.literal("setAmount"),
      customerContractInvoiceId: z.string().min(1),
      customerContractLineId: z.string().min(1),
      amount: zfd.numeric(
        z.number().min(0, { message: "Amount cannot be negative" })
      )
    }),
    z.object({
      intent: z.literal("addInvoice"),
      invoiceDate: z.string().min(1, { message: "Invoice date is required" }),
      amounts: contractLineAmounts
    }),
    z.object({
      intent: z.literal("delete"),
      customerContractInvoiceId: z.string().min(1)
    }),
    z.object({ intent: z.literal("reset") })
  ]
);

/** One edit to a Draft contract's revenue plan (plan D11): one cell (line ×
 *  month), a month added or deleted, or the edits thrown away. The first
 *  edit stores the live plan. */
export const customerContractRevenueEditValidator = z.discriminatedUnion(
  "intent",
  [
    z.object({
      intent: z.literal("setAmount"),
      customerContractLineId: z.string().min(1),
      periodStart: z.string().min(1, { message: "Month is required" }),
      amount: zfd.numeric(
        z.number().min(0, { message: "Amount cannot be negative" })
      )
    }),
    z.object({
      intent: z.literal("addMonth"),
      periodStart: z.string().min(1, { message: "Month is required" }),
      amounts: contractLineAmounts
    }),
    z.object({
      intent: z.literal("deleteMonth"),
      periodStart: z.string().min(1, { message: "Month is required" })
    }),
    z.object({ intent: z.literal("reset") })
  ]
);

/** Service items added to a Draft contract at once, each as a line with the
 *  defaults a new line gets. */
export const customerContractLinesAddValidator = z.object({
  itemIds: z
    .array(z.string().min(1))
    .min(1, { message: "Choose at least one service" })
});

/** What an amendment does to the lines: change one in place (from the
 *  amendment date), add one, or end one. Percentages in percent points. */
export const contractAmendmentChangeValidator = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("change"),
    lineId: z.string().min(1),
    quantity: z.number().positive().optional(),
    rate: z.number().min(0).optional(),
    rateUnit: z.enum(contractRateUnits).optional(),
    discountPercent: z.number().min(0).max(100).optional(),
    taxPercent: z.number().min(0).max(100).optional(),
    description: z.string().optional(),
    revenueMethod: z.enum(contractRevenueMethods).optional(),
    projectId: z.string().optional()
  }),
  z.object({
    op: z.literal("add"),
    line: z.object(contractLineFields).superRefine(checkContractLine)
  }),
  z.object({ op: z.literal("end"), lineId: z.string().min(1) })
]);

export const customerContractAmendmentValidator = z.object({
  customerContractId: z.string().min(1, { message: "Contract is required" }),
  amendmentDate: z.string().min(1, { message: "Amendment date is required" }),
  effect: z.enum(contractAmendmentEffects, { error: "Effect is required" }),
  contractType: z.enum(customerContractTypes, {
    error: "Contract type is required"
  }),
  reason: z.string().trim().min(1, { message: "A reason is required" }),
  changes: jsonField(
    z
      .array(contractAmendmentChangeValidator)
      .min(1, { message: "Change at least one line" }),
    "Invalid changes"
  )
});

export const customerContractCancelValidator = z.object({
  customerContractId: z.string().min(1, { message: "Contract is required" }),
  endDate: z.string().min(1, { message: "End date is required" }),
  reason: z.string().trim().min(1, { message: "A reason is required" }),
  creditUnusedTime: zfd.checkbox()
});

export const createContractFromSalesOrderValidator = z
  .object({
    salesOrderId: z.string().min(1, { message: "Sales order is required" }),
    name: z.string().trim().min(1, { message: "Name is required" }),
    startDate: z.string().min(1, { message: "Start date is required" }),
    duration: z.enum(contractDurations, { error: "Duration is required" }),
    endDate: zfd.text(z.string().optional()),
    billingFrequency: z.enum(contractBillingFrequencies, {
      error: "Billing frequency is required"
    }),
    billingAlignment: z.enum(contractBillingAlignments, {
      error: "Billing alignment is required"
    }),
    billingTiming: z.enum(contractBillingTimings, {
      error: "Billing timing is required"
    }),
    lines: jsonField(
      z
        .array(
          z
            .object({
              salesOrderLineId: z.string().min(1),
              revenueType: z.enum(contractRevenueTypes),
              rateUnit: z.enum(contractRateUnits).optional()
            })
            .refine(
              (line) => (line.revenueType === "Recurring") === !!line.rateUnit,
              {
                message:
                  "A recurring line needs a rate unit; a one-time line has none",
                path: ["rateUnit"]
              }
            )
        )
        .min(1, { message: "Choose at least one line" }),
      "Invalid lines"
    )
  })
  .refine((data) => (data.duration === "custom" ? !!data.endDate : true), {
    message: "End date is required",
    path: ["endDate"]
  })
  .refine((data) => isOnOrAfter(data.endDate, data.startDate, -1), {
    message: "End date cannot be before the start date",
    path: ["endDate"]
  });

export const customerContractInvoiceAutomationValidator = z.object({
  invoiceAutomation: z.enum(invoiceAutomations).nullable()
});
