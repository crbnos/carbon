import { z } from "zod";
import { zfd } from "zod-form-data";
import { months } from "~/modules/shared";
import {
  itemLedgerDocumentTypes,
  itemLedgerTypes
} from "../inventory/inventory.models";
import { macrsConventions, macrsPropertyClasses } from "./accounting.utils";

export { macrsConventions, macrsPropertyClasses };

export const accountTypes = [
  "Bank",
  "Cash",
  "Accounts Receivable",
  "Accounts Payable",
  "Inventory",
  "Fixed Asset",
  "Accumulated Depreciation",
  "Other Current Asset",
  "Other Asset",
  "Other Current Liability",
  "Long Term Liability",
  "Equity - No Close",
  "Equity - Close",
  "Retained Earnings",
  "Income",
  "Cost of Goods Sold",
  "Expense",
  "Other Income",
  "Other Expense",
  "Tax",
  "Investments"
] as const;

export const consolidatedRateTypes = [
  "Average",
  "Current",
  "Historical"
] as const;

const costLedgerTypes = [
  "Direct Cost",
  "Revaluation",
  "Rounding",
  "Indirect Cost",
  "Variance",
  "Total"
] as const;

export const journalLineDocumentType = [
  "Receipt",
  "Invoice",
  "Credit Memo",
  "Blanket Order",
  "Return Order"
] as const;

export const incomeBalanceTypes = [
  "Balance Sheet",
  "Income Statement"
] as const;
export const accountClassTypes = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense"
] as const;

export const groupAccountValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }),
    parentId: zfd.text(z.string().optional()),
    accountType: z
      .enum(accountTypes, {
        errorMap: () => ({
          message: "Account type is required"
        })
      })
      .optional(),
    incomeBalance: z.enum(incomeBalanceTypes, {
      errorMap: () => ({
        message: "Income balance is required"
      })
    }),
    class: z.enum(accountClassTypes, {
      errorMap: () => ({
        message: "Class is required"
      })
    })
  })
  .refine(
    (data) => {
      if (["Asset", "Liability", "Equity"].includes(data.class)) {
        return data.incomeBalance === "Balance Sheet";
      }
      return true;
    },
    {
      message: "Asset, Liability and Equity are Balance Sheet accounts",
      path: ["class"]
    }
  )
  .refine(
    (data) => {
      if (["Revenue", "Expense"].includes(data.class)) {
        return data.incomeBalance === "Income Statement";
      }
      return true;
    },
    {
      message: "Revenue and Expense are Income Statement accounts",
      path: ["class"]
    }
  );

export const moveAccountValidator = z.object({
  id: z.string().min(1),
  parentId: zfd.text(z.string().optional())
});

export const accountValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    number: z.string().min(1, { message: "Number is required" }).nullish(),
    name: z.string().min(1, { message: "Name is required" }),
    parentId: zfd.text(z.string().optional()),
    isGroup: zfd.checkbox(),
    accountType: z
      .enum(accountTypes, {
        errorMap: () => ({
          message: "Account type is required"
        })
      })
      .optional(),
    incomeBalance: z.enum(incomeBalanceTypes, {
      errorMap: () => ({
        message: "Income balance is required"
      })
    }),
    class: z.enum(accountClassTypes, {
      errorMap: () => ({
        message: "Class is required"
      })
    }),
    consolidatedRate: z.enum(consolidatedRateTypes)
  })
  .refine(
    (data) => {
      if (["Asset", "Liability", "Equity"].includes(data.class)) {
        return data.incomeBalance === "Balance Sheet";
      }
      return true;
    },
    {
      message: "Asset, Liability and Equity are Balance Sheet accounts",
      path: ["class"]
    }
  )
  .refine(
    (data) => {
      if (["Revenue", "Expense"].includes(data.class)) {
        return data.incomeBalance === "Income Statement";
      }
      return true;
    },
    {
      message: "Revenue and Expense are Income Statement accounts",
      path: ["class"]
    }
  )
  .refine(
    (data) => {
      if (!data.isGroup) {
        return !!data.accountType;
      }
      return true;
    },
    {
      message: "Account type is required for ledger accounts",
      path: ["accountType"]
    }
  );

export const fiscalYearSettingsValidator = z.object({
  startMonth: z.enum(months, {
    errorMap: (issue, ctx) => ({
      message: "Start month is required"
    })
  }),
  taxStartMonth: z.enum(months, {
    errorMap: (issue, ctx) => ({
      message: "Tax start month is required"
    })
  })
});

export const journalLineValidator = z.object({
  postingDate: zfd.text(z.string().optional()),
  accountId: z.string().min(1, { message: "Account is required" }),
  description: z.string().optional(),
  amount: z.number(),
  documentType: z.union([z.enum(journalLineDocumentType), z.undefined()]),
  documentId: z.string().optional(),
  externalDocumentId: z.string().optional()
});

export const currencyValidator = z.object({
  id: zfd.text(z.string().optional()),
  code: z.string().min(1, { message: "Code is required" }),
  decimalPlaces: zfd.numeric(z.number().min(0).max(4)),
  exchangeRate: zfd.numeric(z.number().min(0, { message: "Rate is required" })),
  historicalExchangeRate: zfd.numeric(
    z.number().min(0, { message: "Rate must be positive" }).optional()
  )
});

export const defaultBalanceSheetAccountValidator = z.object({
  inventoryAccount: z.string().min(1, {
    message: "Inventory account is required"
  }),
  goodsReceivedNotInvoicedAccount: z.string().min(1, {
    message: "GR/IR clearing account is required"
  }),
  inventoryShippedNotInvoicedAccount: z.string().min(1, {
    message: "Inventory shipped not invoiced account is required"
  }),
  workInProgressAccount: z.string().min(1, {
    message: "Work in progress account is required"
  }),
  receivablesAccount: z.string().min(1, {
    message: "Receivables account is required"
  }),
  bankCashAccount: z.string().min(1, {
    message: "Bank cash account is required"
  }),
  bankLocalCurrencyAccount: z.string().min(1, {
    message: "Bank local currency account is required"
  }),
  bankForeignCurrencyAccount: z.string().min(1, {
    message: "Bank foreign currency account is required"
  }),
  assetAquisitionCostAccount: z.string().min(1, {
    message: "Aquisition cost account is required"
  }),
  assetAquisitionCostOnDisposalAccount: z.string().min(1, {
    message: "Aquisition cost on disposal account is required"
  }),
  accumulatedDepreciationAccount: z.string().min(1, {
    message: "Accumulated depreciation account is required"
  }),
  accumulatedDepreciationOnDisposalAccount: z.string().min(1, {
    message: "Accumulated depreciation on disposal account is required"
  }),
  prepaymentAccount: z.string().min(1, {
    message: "Prepayment account is required"
  }),
  payablesAccount: z.string().min(1, {
    message: "Payables account is required"
  }),
  salesTaxPayableAccount: z.string().min(1, {
    message: "Sales tax payable account is required"
  }),
  purchaseTaxPayableAccount: z.string().min(1, {
    message: "Purchase tax payable account is required"
  }),
  reverseChargeSalesTaxPayableAccount: z.string().min(1, {
    message: "Reverse charge sales tax payable account is required"
  }),
  retainedEarningsAccount: z.string().min(1, {
    message: "Retained earnings account is required"
  }),
  currencyTranslationAccount: z.string().min(1, {
    message: "Currency translation account is required"
  }),
  deferredTaxLiabilityAccountId: z.string().min(1, {
    message: "Deferred tax liability account is required"
  })
});

export const defaultIncomeAcountValidator = z.object({
  salesAccount: z.string().min(1, { message: "Sales account is required" }),
  salesDiscountAccount: z.string().min(1, {
    message: "Sales discount account is required"
  }),
  costOfGoodsSoldAccount: z.string().min(1, {
    message: "Cost of goods sold account is required"
  }),
  purchaseVarianceAccount: z.string().min(1, {
    message: "Purchase price variance account is required"
  }),
  inventoryAdjustmentVarianceAccount: z.string().min(1, {
    message: "Inventory adjustment variance account is required"
  }),
  materialVarianceAccount: z.string().min(1, {
    message: "Material usage variance account is required"
  }),
  laborAndMachineVarianceAccount: z.string().min(1, {
    message: "Labor & machine variance account is required"
  }),
  overheadVarianceAccount: z.string().min(1, {
    message: "Overhead variance account is required"
  }),
  lotSizeVarianceAccount: z.string().min(1, {
    message: "Lot size variance account is required"
  }),
  subcontractingVarianceAccount: z.string().min(1, {
    message: "Subcontracting variance account is required"
  }),
  laborAbsorptionAccount: z.string().min(1, {
    message: "Labor absorption account is required"
  }),
  indirectCostAccount: z.string().min(1, {
    message: "Indirect cost account is required"
  }),
  maintenanceAccount: z.string().min(1, {
    message: "Maintenance account is required"
  }),
  assetDepreciationExpenseAccount: z.string().min(1, {
    message: "Depreciation expense account is required"
  }),
  assetGainsAndLossesAccount: z.string().min(1, {
    message: "Gains and losses account is required"
  }),
  serviceChargeAccount: z.string().min(1, {
    message: "Service charge account is required"
  }),
  interestAccount: z.string().min(1, {
    message: "Interest account is required"
  }),
  supplierPaymentDiscountAccount: z.string().min(1, {
    message: "Supplier payment discount account is required"
  }),
  customerPaymentDiscountAccount: z.string().min(1, {
    message: "Customer payment discount account is required"
  }),
  roundingAccount: z.string().min(1, {
    message: "Rounding account is required"
  }),
  deferredTaxExpenseAccountId: z.string().min(1, {
    message: "Deferred tax expense account is required"
  })
});

export const defaultAccountValidator =
  defaultBalanceSheetAccountValidator.merge(defaultIncomeAcountValidator);

export const paymentTermsCalculationMethod = [
  "Net",
  "End of Month",
  "Day of Month"
] as const;

export const paymentTermValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  daysDue: zfd.numeric(
    z
      .number()
      .min(0, { message: "Days due must be greater than or equal to 0" })
  ),
  daysDiscount: zfd.numeric(
    z
      .number()
      .min(0, { message: "Days discount must be greater than or equal to 0" })
  ),
  discountPercentage: zfd.numeric(
    z
      .number()
      .min(0, {
        message: "Discount percent must be greater than or equal to 0"
      })
      .max(100, {
        message: "Discount percent must be less than or equal to 100"
      })
  ),
  calculationMethod: z.enum(["Net", "End of Month", "Day of Month"], {
    errorMap: (issue, ctx) => ({
      message: "Calculation method is required"
    })
  })
});

export const costLedgerValidator = z.object({
  postingDate: zfd.text(z.string().optional()),
  itemLedgerType: z.enum(itemLedgerTypes),
  costLedgerType: z.enum(costLedgerTypes),
  adjustment: z.boolean(),
  documentType: z.union([z.enum(itemLedgerDocumentTypes), z.undefined()]),
  documentId: z.string().optional(),
  itemId: zfd.text(z.string()),
  quantity: z.number(),
  cost: z.number(),
  costPostedToGL: z.number()
});

export const costCenterValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  parentCostCenterId: zfd.text(z.string().optional()),
  ownerId: z.string().min(1, { message: "Owner is required" })
});

export const intercompanyTransactionStatuses = [
  "Unmatched",
  "Matched",
  "Eliminated"
] as const;

export const intercompanyTransactionValidator = z
  .object({
    sourceCompanyId: z
      .string()
      .min(1, { message: "Source company is required" }),
    targetCompanyId: z
      .string()
      .min(1, { message: "Target company is required" }),
    amount: zfd.numeric(
      z.number().positive({ message: "Amount must be positive" })
    ),
    currencyCode: z.string().min(1, { message: "Currency is required" }),
    description: z.string().min(1, { message: "Description is required" }),
    debitAccountId: z.string().min(1, { message: "Debit account is required" }),
    creditAccountId: z
      .string()
      .min(1, { message: "Credit account is required" }),
    postingDate: zfd.text(z.string().optional())
  })
  .refine(
    (data) => {
      return data.debitAccountId !== data.creditAccountId;
    },
    {
      message: "Debit and credit account must be different"
    }
  )
  .refine(
    (data) => {
      return data.sourceCompanyId !== data.targetCompanyId;
    },
    {
      message: "Source and target company must be different"
    }
  );

export const journalEntrySourceTypes = [
  "Manual",
  "Purchase Receipt",
  "Purchase Invoice",
  "Purchase Return",
  "Sales Invoice",
  "Sales Shipment",
  "Sales Return",
  "Transfer Receipt",
  "Inventory Adjustment",
  "Production Order",
  "Job Consumption",
  "Job Receipt",
  "Production Event",
  "Job Close",
  "Asset Depreciation",
  "Asset Disposal"
] as const;

export const journalEntryStatuses = ["Draft", "Posted", "Reversed"] as const;

export const journalEntryValidator = z.object({
  id: zfd.text(z.string().optional()),
  description: z.string().optional(),
  postingDate: z.string().min(1, { message: "Posting date is required" })
});

export const journalEntryLineValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    journalEntryId: zfd.text(z.string().optional()),
    accountId: z.string().min(1, { message: "Account is required" }),
    description: z.string().optional(),
    debit: zfd.numeric(z.number().min(0)),
    credit: zfd.numeric(z.number().min(0))
  })
  .refine((data) => !(data.debit > 0 && data.credit > 0), {
    message: "A line cannot have both debit and credit",
    path: ["credit"]
  })
  .refine((data) => data.debit > 0 || data.credit > 0, {
    message: "Either debit or credit is required",
    path: ["debit"]
  });

export const dimensionEntityTypes = [
  "CostCenter",
  "Custom",
  "CustomerType",
  "Department",
  "Employee",
  "FixedAssetClass",
  "ItemPostingGroup",
  "Location",
  "Process",
  "SupplierType",
  "WorkCenter"
] as const;

export const dimensionValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  entityType: z.enum(dimensionEntityTypes, {
    errorMap: () => ({ message: "Entity type is required" })
  }),
  active: zfd.checkbox(),
  required: zfd.checkbox(),
  dimensionValues: z.string().min(1).array().optional()
});

// -- Fixed Asset Models --

export const fixedAssetStatuses = [
  "Draft",
  "Active",
  "Fully Depreciated",
  "Disposed"
] as const;

export const depreciationMethods = [
  "Straight Line",
  "Declining Balance",
  "Units of Production"
] as const;

export const taxDepreciationMethods = [
  "Straight Line",
  "Declining Balance",
  "MACRS"
] as const;

export const disposalMethods = ["Sale", "Scrapping"] as const;

export const fixedAssetClassValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
  depreciationMethod: z.enum(depreciationMethods, {
    errorMap: () => ({ message: "Depreciation method is required" })
  }),
  usefulLifeMonths: zfd.numeric(
    z.number().int().positive({ message: "Useful life must be positive" })
  ),
  residualValuePercent: zfd.numeric(
    z
      .number()
      .min(0, { message: "Residual value must be >= 0" })
      .max(100, { message: "Residual value must be <= 100" })
  ),
  assetAccountId: z.string().min(1, { message: "Asset account is required" }),
  accumulatedDepreciationAccountId: z
    .string()
    .min(1, { message: "Accumulated depreciation account is required" }),
  depreciationExpenseAccountId: z
    .string()
    .min(1, { message: "Depreciation expense account is required" }),
  writeOffAccountId: z
    .string()
    .min(1, { message: "Write-off account is required" }),
  writeDownAccountId: z
    .string()
    .min(1, { message: "Write-down account is required" }),
  disposalAccountId: z
    .string()
    .min(1, { message: "Disposal account is required" }),
  taxDepreciationMethod: z.preprocess(
    (val) => (val === "" ? null : val),
    z.enum(taxDepreciationMethods).nullable().optional()
  ),
  taxUsefulLifeMonths: zfd.numeric(
    z.number().int().positive().nullable().optional()
  ),
  taxResidualValuePercent: zfd.numeric(
    z.number().min(0).max(100).nullable().optional()
  ),
  macrsPropertyClass: z.enum(macrsPropertyClasses).nullable().optional(),
  macrsConvention: z.enum(macrsConventions).nullable().optional(),
  bonusDepreciationPercent: zfd.numeric(
    z.number().min(0).max(100).nullable().optional()
  )
});

export const fixedAssetValidator = z.object({
  id: zfd.text(z.string().optional()),
  fixedAssetClassId: z.string().min(1, { message: "Asset class is required" }),
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
  serialNumber: z.string().optional(),
  depreciationMethod: z.enum(depreciationMethods, {
    errorMap: () => ({ message: "Depreciation method is required" })
  }),
  usefulLifeMonths: zfd.numeric(
    z.number().int().positive({ message: "Useful life must be positive" })
  ),
  residualValuePercent: zfd.numeric(
    z
      .number()
      .min(0, { message: "Residual value must be >= 0" })
      .max(100, { message: "Residual value must be <= 100" })
  ),
  assetLifetimeUsage: zfd.numeric(z.number().positive().optional()),
  locationId: zfd.text(z.string().optional()),
  taxDepreciationMethod: z.preprocess(
    (val) => (val === "" ? null : val),
    z.enum(taxDepreciationMethods).nullable().optional()
  ),
  taxUsefulLifeMonths: zfd.numeric(
    z.number().int().positive().nullable().optional()
  ),
  taxResidualValuePercent: zfd.numeric(
    z.number().min(0).max(100).nullable().optional()
  ),
  macrsPropertyClass: z.preprocess(
    (val) => (val === "" ? null : val),
    z.enum(macrsPropertyClasses).nullable().optional()
  ),
  macrsConvention: z.preprocess(
    (val) => (val === "" ? null : val),
    z.enum(macrsConventions).nullable().optional()
  ),
  bonusDepreciationPercent: zfd.numeric(
    z.number().min(0).max(100).nullable().optional()
  )
});

export const fixedAssetRegisterValidator = z.object({
  acquisitionCost: zfd.numeric(
    z.number().positive({ message: "Acquisition cost must be positive" })
  ),
  acquisitionDate: z
    .string()
    .min(1, { message: "Acquisition date is required" }),
  accumulatedDepreciation: zfd.numeric(
    z.number().min(0, { message: "Accumulated depreciation must be >= 0" })
  ),
  depreciationStartDate: z
    .string()
    .min(1, { message: "Depreciation start date is required" })
});

export const depreciationRunValidator = z.object({
  periodEnd: z.string().min(1, { message: "Period end date is required" })
});

export const fixedAssetUsageLogValidator = z.object({
  fixedAssetId: z.string().min(1, { message: "Asset is required" }),
  periodStart: z.string().min(1, { message: "Period start is required" }),
  periodEnd: z.string().min(1, { message: "Period end is required" }),
  unitsProduced: zfd.numeric(
    z.number().positive({ message: "Units must be positive" })
  )
});

export const fixedAssetDisposalValidator = z.object({
  disposalDate: z.string().min(1, { message: "Disposal date is required" })
});
