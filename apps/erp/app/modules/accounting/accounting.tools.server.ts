// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The accounting module's single-function tools: each one a service function a
// route calls directly, published as it is. An operation that does more than
// one write lives in accounting.server.ts.

import { defineServiceFn } from "@carbon/api/service-fn.server";
import {
  envelope,
  paged,
  plain,
  stamp
} from "@carbon/api/service-tools.server";
import { z } from "zod";
import {
  createFiscalYearPeriods,
  createIntercompanyTransaction,
  deleteAccount,
  deleteAccountingPeriod,
  deleteCostCenter,
  deleteDepreciationRun,
  deleteDimension,
  deleteFixedAsset,
  deleteFixedAssetClass,
  deleteJournalEntry,
  deletePaymentTerm,
  deleteProject,
  deleteReportView,
  generateEliminations,
  getAccount,
  getAccountingPeriodDeletability,
  getAccountingPeriods,
  getAccountingSyncTieOut,
  getAccountingSyncTieOutCell,
  getAccountLedger,
  getAccountLedgerSummary,
  getAccountsInScope,
  getAccountsList,
  getActiveDimensionsWithValues,
  getAssetDepreciationHistory,
  getBaseCurrency,
  getChartOfAccounts,
  getCompaniesInGroup,
  getCostCenter,
  getCostCentersList,
  getCostCentersTree,
  getCurrencies,
  getCurrenciesList,
  getCurrency,
  getCurrencyByCode,
  getDefaultAccounts,
  getDeferredRevenueWaterfall,
  getDepreciationRun,
  getDepreciationRunLines,
  getDepreciationRuns,
  getDimension,
  getDimensionPivot,
  getDimensionPivotLines,
  getDimensions,
  getExchangeRate,
  getExchangeRateHistory,
  getExchangeRates,
  getFinancialStatementBalances,
  getFinancialStatementPeriodSeries,
  getFiscalCalendarCommitted,
  getFiscalYearSettings,
  getFixedAsset,
  getFixedAssetCipCosts,
  getFixedAssetClass,
  getFixedAssetClasses,
  getFixedAssetClassesList,
  getFixedAssetDisposal,
  getFixedAssets,
  getFixedAssetTransfers,
  getFleetAssets,
  getGroupAccounts,
  getIntercompanyTransactions,
  getJournalEntries,
  getJournalEntry,
  getJournalLineDimensions,
  getLeaseLiabilities,
  getLeaseNetInvestment,
  getPaymentTerm,
  getPaymentTerms,
  getPaymentTermsList,
  getPeriodCloseChecklist,
  getPeriodRunRelatedItems,
  getProject,
  getProjects,
  getPurchaseLinePivot,
  getPurchaseLinePivotLines,
  getRentalUtilization,
  getReportPins,
  getReportViews,
  getRevenueRecognitionRun,
  getRevenueRecognitionRunLines,
  getScrapAccountIds,
  getWorkCenterCapitalCost,
  insertFixedAsset,
  invokeAssetTransfer,
  postJournalEntry,
  reverseJournalEntry,
  runIntercompanyMatching,
  saveJournalLineDimensions,
  translateCompanyBalances,
  updateDefaultAccounts,
  updateFiscalYearSettings,
  updateFixedAsset,
  upsertAccount,
  upsertCostCenter,
  upsertDimension,
  upsertFixedAssetClass,
  upsertPaymentTerm,
  upsertProject,
  upsertReportPin,
  upsertReportView
} from "./accounting.service";

/**
 * Get account ledger
 *
 * @mcp read
 */
export const getAccountLedgerTool = defineServiceFn({
  input: z.looseObject({
    accountId: z.string(),
    companyIds: z.array(z.string()).optional(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    limit: z.number(),
    offset: z.number()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getAccountLedger(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get account ledger summary
 *
 * @mcp read
 */
export const getAccountLedgerSummaryTool = defineServiceFn({
  input: z.looseObject({
    accountId: z.string(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAccountLedgerSummary(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get financial statement balances
 *
 * @mcp read
 */
export const getFinancialStatementBalancesTool = defineServiceFn({
  input: z.looseObject({
    startDate: z.string().nullable(),
    endDate: z.string().nullable(),
    includeCurrentYearEarnings: z.boolean().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getFinancialStatementBalances(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Multi-period financial statement balances: one column per bucket, powered by the accountTreeBalancePeriodSeries RPC (snapshot-based, single journal scan)
 *
 * @mcp read
 */
export const getFinancialStatementPeriodSeriesTool = defineServiceFn({
  input: z.looseObject({
    buckets: z.array(
      z.looseObject({
        key: z.string(),
        start: z.string(),
        end: z.string(),
        fiscalYear: z.number(),
        quarter: z.number().nullable().optional(),
        isPartial: z.boolean()
      })
    ),
    includeCurrentYearEarnings: z.boolean().optional(),
    translate: z.looseObject({ targetCurrency: z.string() }).optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getFinancialStatementPeriodSeries(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get report pins
 *
 * @mcp read
 */
export const getReportPinsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getReportPins(
        ctx.asCaller.supabase,
        ctx.auditUserId,
        ctx.company.id
      )
    );
  }
});

/**
 * Upsert report pin
 *
 * @mcp
 */
export const upsertReportPinTool = defineServiceFn({
  input: z.looseObject({ reportKey: z.string(), pinned: z.boolean() }),
  permission: { create: "accounting", update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertReportPin(
        ctx.asCaller.supabase,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * The leaf accounts inside a report's account scope — the universe the per-report account multi-select filters within
 *
 * @mcp read
 */
export const getAccountsInScopeTool = defineServiceFn({
  input: z.looseObject({
    scope: z.union([
      z.looseObject({
        classes: z.array(
          z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"])
        )
      }),
      z.looseObject({
        types: z.array(
          z.enum([
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
          ])
        )
      }),
      z.looseObject({ source: z.literal("scrapAccounts") })
    ]),
    scrapAccountIds: z.array(z.string()).optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAccountsInScope(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        stamp(ctx, input.scope, ["companyId"]) as never,
        stamp(ctx, input.scrapAccountIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get dimension pivot
 *
 * @mcp read
 */
export const getDimensionPivotTool = defineServiceFn({
  input: z.looseObject({
    report: z.looseObject({
      key: z.enum([
        "revenue",
        "expenses",
        "assets",
        "inventory-change",
        "scrap"
      ]),
      accountScope: z.union([
        z.looseObject({
          classes: z.array(
            z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"])
          )
        }),
        z.looseObject({
          types: z.array(
            z.enum([
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
            ])
          )
        }),
        z.looseObject({ source: z.literal("scrapAccounts") })
      ]),
      defaultRows: z.array(z.string())
    }),
    scrapAccountIds: z.array(z.string()).optional(),
    startDate: z.string(),
    endDate: z.string(),
    periodEnds: z.array(z.string()).optional(),
    state: z.looseObject({
      rows: z.array(z.string().min(1)).max(2).default([]),
      columnAxis: z
        .union([
          z.looseObject({
            type: z.literal("period"),
            bucket: z.enum(["month", "quarter", "year"])
          }),
          z.looseObject({
            type: z.literal("dimension"),
            dimensionId: z.string().min(1)
          })
        ])
        .default({ type: "period", bucket: "month" }),
      measure: z.enum(["amount", "quantity", "count"]).default("amount"),
      percentOfTotal: z.boolean().default(false),
      sort: z
        .looseObject({
          key: z.string().min(1),
          direction: z.enum(["asc", "desc"])
        })
        .nullable()
        .default(null),
      filters: z
        .array(
          z.looseObject({
            dimensionId: z.string().min(1),
            valueIds: z.array(z.string()).min(1)
          })
        )
        .default([]),
      accountIds: z.array(z.string().min(1)).default([])
    })
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDimensionPivot(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "companyGroupId"]) as never
      )
    );
  }
});

/**
 * Drill-through: the journal lines behind one pivot cell
 *
 * @mcp read
 */
export const getDimensionPivotLinesTool = defineServiceFn({
  input: z.looseObject({
    report: z.looseObject({
      key: z.enum([
        "revenue",
        "expenses",
        "assets",
        "inventory-change",
        "scrap"
      ]),
      accountScope: z.union([
        z.looseObject({
          classes: z.array(
            z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"])
          )
        }),
        z.looseObject({
          types: z.array(
            z.enum([
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
            ])
          )
        }),
        z.looseObject({ source: z.literal("scrapAccounts") })
      ]),
      defaultRows: z.array(z.string())
    }),
    scrapAccountIds: z.array(z.string()).optional(),
    startDate: z.string(),
    endDate: z.string(),
    filters: z.array(
      z.looseObject({ dimensionId: z.string(), valueIds: z.array(z.string()) })
    ),
    rowDimension1: z.string().optional(),
    rowValue1: z.string().optional(),
    rowValue1IsNull: z.boolean().optional(),
    rowDimension2: z.string().optional(),
    rowValue2: z.string().optional(),
    rowValue2IsNull: z.boolean().optional(),
    columnDimension: z.string().optional(),
    columnValue: z.string().optional(),
    columnValueIsNull: z.boolean().optional(),
    columnPeriodStart: z.string().optional(),
    columnPeriodEnd: z.string().optional(),
    accountIds: z.array(z.string()).optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDimensionPivotLines(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "companyGroupId"]) as never
      )
    );
  }
});

/**
 * Get purchase line pivot
 *
 * @mcp read
 */
export const getPurchaseLinePivotTool = defineServiceFn({
  input: z.looseObject({
    startDate: z.string(),
    endDate: z.string(),
    periodEnds: z.array(z.string()).optional(),
    state: z.looseObject({
      rows: z.array(z.string().min(1)).max(2).default([]),
      columnAxis: z
        .union([
          z.looseObject({
            type: z.literal("period"),
            bucket: z.enum(["month", "quarter", "year"])
          }),
          z.looseObject({
            type: z.literal("dimension"),
            dimensionId: z.string().min(1)
          })
        ])
        .default({ type: "period", bucket: "month" }),
      measure: z.enum(["amount", "quantity", "count"]).default("amount"),
      percentOfTotal: z.boolean().default(false),
      sort: z
        .looseObject({
          key: z.string().min(1),
          direction: z.enum(["asc", "desc"])
        })
        .nullable()
        .default(null),
      filters: z
        .array(
          z.looseObject({
            dimensionId: z.string().min(1),
            valueIds: z.array(z.string()).min(1)
          })
        )
        .default([]),
      accountIds: z.array(z.string().min(1)).default([])
    })
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseLinePivot(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get purchase line pivot lines
 *
 * @mcp read
 */
export const getPurchaseLinePivotLinesTool = defineServiceFn({
  input: z.looseObject({
    startDate: z.string(),
    endDate: z.string(),
    rowField1: z.string().optional(),
    rowValue1: z.string().optional(),
    rowField2: z.string().optional(),
    rowValue2: z.string().optional(),
    columnField: z.string().optional(),
    columnValue: z.string().optional(),
    columnPeriodStart: z.string().optional(),
    columnPeriodEnd: z.string().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPurchaseLinePivotLines(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get report views
 *
 * @mcp read
 */
export const getReportViewsTool = defineServiceFn({
  input: z.looseObject({ reportKey: z.string().optional() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getReportViews(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Create a report view
 *
 * @remarks
 * Upsert report view
 *
 * @mcp
 */
export const upsertReportViewCreateTool = defineServiceFn({
  input: z.looseObject({
    view: z.looseObject({
      reportKey: z.string(),
      name: z.string(),
      visibility: z.enum(["Private", "Company"]),
      config: z.unknown()
    })
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertReportView(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.view,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a report view
 *
 * @remarks
 * Upsert report view
 *
 * @mcp
 */
export const upsertReportViewUpdateTool = defineServiceFn({
  input: z.looseObject({
    view: z.looseObject({
      id: z.string(),
      reportKey: z.string(),
      name: z.string(),
      visibility: z.enum(["Private", "Company"]),
      config: z.unknown()
    })
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertReportView(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.view,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Delete report view
 *
 * @mcp destructive
 */
export const deleteReportViewTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteReportView(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get companies in group
 *
 * @mcp read
 */
export const getCompaniesInGroupTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getCompaniesInGroup(ctx.asCaller.supabase, ctx.company.groupId)
    );
  }
});

/**
 * Delete account
 *
 * @mcp destructive
 */
export const deleteAccountTool = defineServiceFn({
  input: z.looseObject({ accountId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteAccount(ctx.asCaller.supabase, input.accountId as never)
    );
  }
});

/**
 * Delete payment term
 *
 * @mcp destructive
 */
export const deletePaymentTermTool = defineServiceFn({
  input: z.looseObject({ paymentTermId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deletePaymentTerm(
        ctx.asCaller.supabase,
        input.paymentTermId as never
      )
    );
  }
});

/**
 * Get account
 *
 * @mcp read
 */
export const getAccountTool = defineServiceFn({
  input: z.looseObject({ accountId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAccount(ctx.asCaller.supabase, input.accountId as never)
    );
  }
});

/**
 * Get accounts list
 *
 * @mcp read
 */
export const getAccountsListTool = defineServiceFn({
  input: z.looseObject({
    isGroup: z.boolean().nullable().optional(),
    incomeBalance: z
      .enum(["Balance Sheet", "Income Statement"])
      .nullable()
      .optional(),
    classes: z
      .array(z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"]))
      .optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAccountsList(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get group accounts
 *
 * @mcp read
 */
export const getGroupAccountsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getGroupAccounts(ctx.asCaller.supabase, ctx.company.groupId)
    );
  }
});

/**
 * Get base currency
 *
 * @mcp read
 */
export const getBaseCurrencyTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getBaseCurrency(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get chart of accounts
 *
 * @mcp read
 */
export const getChartOfAccountsTool = defineServiceFn({
  input: z.looseObject({
    incomeBalance: z.enum(["Income Statement", "Balance Sheet"]).nullable(),
    startDate: z.string().nullable(),
    endDate: z.string().nullable()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getChartOfAccounts(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get currency
 *
 * @mcp read
 */
export const getCurrencyTool = defineServiceFn({
  input: z.looseObject({ currencyId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCurrency(ctx.asCaller.supabase, input.currencyId as never)
    );
  }
});

/**
 * Get currency by code
 *
 * @mcp read
 */
export const getCurrencyByCodeTool = defineServiceFn({
  input: z.looseObject({ currencyCode: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCurrencyByCode(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        input.currencyCode as never
      )
    );
  }
});

/**
 * The one sanctioned answer to "how many units of `currencyCode` per 1 unit of THIS company's base currency, right now"
 *
 * @mcp read
 */
export const getExchangeRateTool = defineServiceFn({
  input: z.looseObject({ currencyCode: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getExchangeRate(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Every active currency of the company's group, resolved for THIS company, with provenance: 'base' | 'override' | 'market' | 'missing'
 *
 * @mcp read
 */
export const getExchangeRatesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getExchangeRates(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get currencies
 *
 * @mcp read
 */
export const getCurrenciesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCurrencies(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * The full ISO currency list for pickers, carrying the company group's configured `decimalPlaces` where the currency has been set up
 *
 * @mcp read
 */
export const getCurrenciesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getCurrenciesList(ctx.asCaller.supabase, ctx.company.groupId)
    );
  }
});

/**
 * Get accounting periods
 *
 * @mcp read
 */
export const getAccountingPeriodsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getAccountingPeriods(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get accounting period deletability
 *
 * @mcp read
 */
export const getAccountingPeriodDeletabilityTool = defineServiceFn({
  input: z.looseObject({ periodId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAccountingPeriodDeletability(
        ctx.asCaller.supabase,
        input.periodId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Delete accounting period
 *
 * @mcp destructive
 */
export const deleteAccountingPeriodTool = defineServiceFn({
  input: z.looseObject({ periodId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return plain(
      ctx,
      await deleteAccountingPeriod(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get fiscal calendar committed
 *
 * @mcp read
 */
export const getFiscalCalendarCommittedTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getFiscalCalendarCommitted(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Create fiscal year periods
 *
 * @mcp
 */
export const createFiscalYearPeriodsTool = defineServiceFn({
  input: z.looseObject({ fiscalYear: z.number() }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return plain(
      ctx,
      await createFiscalYearPeriods(
        ctx.asCaller.supabase,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId"
        ]) as never
      )
    );
  }
});

/**
 * Idempotently instantiate the checklist for a period from active definitions, then overlay live readiness
 *
 * @mcp
 */
export const getPeriodCloseChecklistTool = defineServiceFn({
  input: z.looseObject({ periodId: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPeriodCloseChecklist(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "userId", "companyGroupId"]) as never
      )
    );
  }
});

/**
 * Get default accounts
 *
 * @mcp read
 */
export const getDefaultAccountsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getDefaultAccounts(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * The GL account ids scrap postings offset to, for the scrap analytics report's account scope (accountScope.source === "scrapAccounts")
 *
 * @mcp read
 */
export const getScrapAccountIdsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getScrapAccountIds(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get fiscal year settings
 *
 * @mcp read
 */
export const getFiscalYearSettingsTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getFiscalYearSettings(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get payment term
 *
 * @mcp read
 */
export const getPaymentTermTool = defineServiceFn({
  input: z.looseObject({ paymentTermId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getPaymentTerm(ctx.asCaller.supabase, input.paymentTermId as never)
    );
  }
});

/**
 * Get payment terms
 *
 * @mcp read
 */
export const getPaymentTermsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getPaymentTerms(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get payment terms list
 *
 * @mcp read
 */
export const getPaymentTermsListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getPaymentTermsList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Save both defaults sections atomically after validating the effective mapping
 *
 * @mcp
 */
export const updateDefaultAccountsTool = defineServiceFn({
  input: z.looseObject({
    rawMaterialsAccount: z.string().min(1),
    finishedGoodsAccount: z.string().min(1),
    goodsReceivedNotInvoicedAccount: z.string().min(1),
    workInProgressAccount: z.string().min(1),
    receivablesAccount: z.string().min(1),
    bankCashAccount: z.string().min(1),
    bankLocalCurrencyAccount: z.string().min(1),
    bankForeignCurrencyAccount: z.string().min(1),
    assetAquisitionCostAccount: z.string().min(1),
    assetAquisitionCostOnDisposalAccount: z.string().min(1),
    accumulatedDepreciationAccount: z.string().min(1),
    accumulatedDepreciationOnDisposalAccount: z.string().min(1),
    prepaymentAccount: z.string().min(1),
    supplierPrepaymentAccount: z.string().min(1),
    payablesAccount: z.string().min(1),
    employeeReimbursementsPayableAccount: z.string().optional(),
    salesTaxPayableAccount: z.string().min(1),
    purchaseTaxPayableAccount: z.string().min(1),
    reverseChargeSalesTaxPayableAccount: z.string().min(1),
    retainedEarningsAccount: z.string().min(1),
    currencyTranslationAccount: z.string().min(1),
    deferredTaxLiabilityAccountId: z.string().min(1),
    migrationClearingAccount: z.string().optional(),
    deferredRevenueAccount: z.string().optional(),
    contractAssetAccount: z.string().optional(),
    netInvestmentInLeasesAccount: z.string().optional(),
    rightOfUseAssetAccount: z.string().optional(),
    accumulatedRightOfUseAmortizationAccount: z.string().optional(),
    leaseLiabilityAccount: z.string().optional(),
    salesAccount: z.string().min(1),
    salesShippingRevenueAccount: z.string().min(1).optional(),
    salesDiscountAccount: z.string().min(1),
    costOfGoodsSoldAccount: z.string().min(1),
    purchaseVarianceAccount: z.string().min(1),
    inventoryAdjustmentVarianceAccount: z.string().min(1),
    scrapAccount: z.string().optional(),
    materialVarianceAccount: z.string().min(1),
    laborAndMachineVarianceAccount: z.string().min(1),
    overheadVarianceAccount: z.string().min(1),
    lotSizeVarianceAccount: z.string().min(1),
    subcontractingVarianceAccount: z.string().min(1),
    laborAbsorptionAccount: z.string().min(1),
    overheadAbsorptionAccount: z.string().optional(),
    indirectCostAccount: z.string().min(1),
    maintenanceAccount: z.string().min(1),
    assetDepreciationExpenseAccount: z.string().min(1),
    assetGainOnDisposalAccount: z.string().min(1),
    assetLossOnDisposalAccount: z.string().min(1),
    serviceChargeAccount: z.string().min(1),
    interestAccount: z.string().min(1),
    supplierPaymentDiscountAccount: z.string().min(1),
    customerPaymentDiscountAccount: z.string().min(1),
    customerWriteOffAccount: z.string().min(1),
    supplierWriteOffAccount: z.string().min(1),
    realizedExchangeGainAccount: z.string().min(1),
    realizedExchangeLossAccount: z.string().min(1),
    roundingAccount: z.string().min(1),
    deferredTaxExpenseAccountId: z.string().min(1),
    rentalIncomeAccount: z.string().optional(),
    leaseRevenueAccount: z.string().optional(),
    leaseInterestIncomeAccount: z.string().optional(),
    operatingLeaseExpenseAccount: z.string().optional(),
    variableLeaseExpenseAccount: z.string().optional(),
    rightOfUseAmortizationExpenseAccount: z.string().optional(),
    leaseInterestExpenseAccount: z.string().optional()
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateDefaultAccounts(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update fiscal year settings
 *
 * @mcp
 */
export const updateFiscalYearSettingsTool = defineServiceFn({
  input: z.looseObject({
    startMonth: z.enum([
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December"
    ]),
    taxStartMonth: z.enum([
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December"
    ])
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateFiscalYearSettings(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Create a account
 *
 * @remarks
 * Upsert account
 *
 * @mcp
 */
export const upsertAccountCreateTool = defineServiceFn({
  input: z.looseObject({
    number: z.string().min(1).nullable().optional(),
    name: z.string().min(1),
    parentId: z.string().optional(),
    isGroup: z.boolean().optional(),
    accountType: z
      .enum([
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
      ])
      .optional(),
    incomeBalance: z.enum(["Balance Sheet", "Income Statement"]),
    class: z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"]),
    consolidatedRate: z.enum(["Average", "Current", "Historical"]),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertAccount(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy", "companyGroupId"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a account
 *
 * @remarks
 * Upsert account
 *
 * @mcp
 */
export const upsertAccountUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      number: z.string().min(1).nullable().optional(),
      name: z.string().min(1),
      parentId: z.string().optional(),
      isGroup: z.boolean().optional(),
      accountType: z
        .enum([
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
        ])
        .optional(),
      incomeBalance: z.enum(["Balance Sheet", "Income Statement"]),
      class: z.enum(["Asset", "Liability", "Equity", "Revenue", "Expense"]),
      consolidatedRate: z.enum(["Average", "Current", "Historical"]),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertAccount(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy", "companyGroupId"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Create a payment term
 *
 * @remarks
 * Upsert payment term
 *
 * @mcp
 */
export const upsertPaymentTermCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    daysDue: z.number().min(0),
    daysDiscount: z.number().min(0),
    discountPercentage: z.number().min(0).max(100),
    calculationMethod: z.enum(["Net", "End of Month", "Day of Month"]),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPaymentTerm(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a payment term
 *
 * @remarks
 * Upsert payment term
 *
 * @mcp
 */
export const upsertPaymentTermUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      daysDue: z.number().min(0),
      daysDiscount: z.number().min(0),
      discountPercentage: z.number().min(0).max(100),
      calculationMethod: z.enum(["Net", "End of Month", "Day of Month"]),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertPaymentTerm(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Delete cost center
 *
 * @mcp destructive
 */
export const deleteCostCenterTool = defineServiceFn({
  input: z.looseObject({ costCenterId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteCostCenter(ctx.asCaller.supabase, input.costCenterId as never)
    );
  }
});

/**
 * Get cost center
 *
 * @mcp read
 */
export const getCostCenterTool = defineServiceFn({
  input: z.looseObject({ costCenterId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getCostCenter(ctx.asCaller.supabase, input.costCenterId as never)
    );
  }
});

/**
 * Get cost centers list
 *
 * @mcp read
 */
export const getCostCentersListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getCostCentersList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Get cost centers tree
 *
 * @mcp read
 */
export const getCostCentersTreeTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getCostCentersTree(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Create a cost center
 *
 * @remarks
 * Upsert cost center
 *
 * @mcp
 */
export const upsertCostCenterCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    parentCostCenterId: z.string().optional(),
    ownerId: z.string().min(1),
    customFields: z.unknown().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertCostCenter(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a cost center
 *
 * @remarks
 * Upsert cost center
 *
 * @mcp
 */
export const upsertCostCenterUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      parentCostCenterId: z.string().optional(),
      ownerId: z.string().min(1),
      customFields: z.unknown().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertCostCenter(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Delete project
 *
 * @mcp destructive
 */
export const deleteProjectTool = defineServiceFn({
  input: z.looseObject({ projectId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteProject(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.projectId as never,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Get project
 *
 * @mcp read
 */
export const getProjectTool = defineServiceFn({
  input: z.looseObject({ projectId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getProject(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.projectId as never
      )
    );
  }
});

/**
 * Get projects
 *
 * @mcp read
 */
export const getProjectsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getProjects(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Create a project
 *
 * @remarks
 * Upsert project
 *
 * @mcp
 */
export const upsertProjectCreateTool = defineServiceFn({
  input: z.looseObject({
    name: z.string().min(1),
    description: z.string().optional(),
    id: z
      .string()
      .describe("Send to update that record; omit to create a new one.")
      .optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertProject(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a project
 *
 * @remarks
 * Upsert project
 *
 * @mcp
 */
export const upsertProjectUpdateTool = defineServiceFn({
  input: z
    .looseObject({
      name: z.string().min(1),
      description: z.string().optional(),
      id: z
        .string()
        .describe("Send to update that record; omit to create a new one.")
        .optional()
    })
    .required({ id: true }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertProject(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Get dimensions
 *
 * @mcp read
 */
export const getDimensionsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getDimensions(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get dimension
 *
 * @mcp read
 */
export const getDimensionTool = defineServiceFn({
  input: z.looseObject({ dimensionId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDimension(ctx.asCaller.supabase, input.dimensionId as never)
    );
  }
});

/**
 * Create a dimension
 *
 * @remarks
 * Upsert dimension
 *
 * @mcp destructive
 */
export const upsertDimensionCreateTool = defineServiceFn({
  input: z.looseObject({
    dimension: z.looseObject({
      name: z.string().min(1),
      entityType: z.enum([
        "CostCenter",
        "Custom",
        "Customer",
        "CustomerType",
        "Department",
        "Employee",
        "FixedAssetClass",
        "Item",
        "ItemPostingGroup",
        "Location",
        "Process",
        "Project",
        "ScrapReason",
        "Supplier",
        "SupplierType",
        "WorkCenter"
      ]),
      active: z.boolean().optional(),
      required: z.boolean().optional()
    }),
    dimensionValues: z.array(z.string()).optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertDimension(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.dimension,
          ["companyId", "createdBy", "updatedBy", "companyGroupId"],
          "create"
        ) as never,
        stamp(
          ctx,
          input.dimensionValues,
          ["companyId", "createdBy", "updatedBy", "companyGroupId"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a dimension
 *
 * @remarks
 * Upsert dimension
 *
 * @mcp destructive
 */
export const upsertDimensionUpdateTool = defineServiceFn({
  input: z.looseObject({
    dimension: z.looseObject({
      name: z.string().min(1),
      entityType: z.enum([
        "CostCenter",
        "Custom",
        "Customer",
        "CustomerType",
        "Department",
        "Employee",
        "FixedAssetClass",
        "Item",
        "ItemPostingGroup",
        "Location",
        "Process",
        "Project",
        "ScrapReason",
        "Supplier",
        "SupplierType",
        "WorkCenter"
      ]),
      active: z.boolean().optional(),
      required: z.boolean().optional(),
      id: z.string()
    }),
    dimensionValues: z.array(z.string()).optional()
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertDimension(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.dimension,
          ["companyId", "createdBy", "updatedBy", "companyGroupId"],
          "update"
        ) as never,
        stamp(
          ctx,
          input.dimensionValues,
          ["companyId", "createdBy", "updatedBy", "companyGroupId"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Delete dimension
 *
 * @mcp destructive
 */
export const deleteDimensionTool = defineServiceFn({
  input: z.looseObject({ dimensionId: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteDimension(ctx.asCaller.supabase, input.dimensionId as never)
    );
  }
});

/**
 * Get active dimensions with values
 *
 * @mcp read
 */
export const getActiveDimensionsWithValuesTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getActiveDimensionsWithValues(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.company.id
      )
    );
  }
});

/**
 * Get journal line dimensions
 *
 * @mcp read
 */
export const getJournalLineDimensionsTool = defineServiceFn({
  input: z.looseObject({ journalLineIds: z.array(z.string()) }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJournalLineDimensions(
        ctx.asCaller.supabase,
        stamp(ctx, input.journalLineIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Save journal line dimensions
 *
 * @mcp destructive
 */
export const saveJournalLineDimensionsTool = defineServiceFn({
  input: z.looseObject({
    journalLineId: z.string(),
    dimensions: z.array(
      z.looseObject({ dimensionId: z.string(), valueId: z.string() })
    )
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await saveJournalLineDimensions(
        ctx.asCaller.supabase,
        input.journalLineId as never,
        ctx.company.id,
        stamp(ctx, input.dimensions, ["companyId"]) as never
      )
    );
  }
});

/**
 * Translate company balances
 *
 * @mcp
 */
export const translateCompanyBalancesTool = defineServiceFn({
  input: z.looseObject({
    targetCurrency: z.string(),
    periodEnd: z.string(),
    periodStart: z.string(),
    balances: z.array(
      z.looseObject({
        id: z.string(),
        balanceAtDate: z.number(),
        consolidatedRate: z.string().nullable(),
        isGroup: z.boolean().nullable(),
        class: z.string().nullable()
      })
    )
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await translateCompanyBalances(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.company.id,
        input.targetCurrency as never,
        input.periodEnd as never,
        input.periodStart as never,
        stamp(ctx, input.balances, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get intercompany transactions
 *
 * @mcp read
 */
export const getIntercompanyTransactionsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    status: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getIntercompanyTransactions(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Create intercompany transaction
 *
 * @mcp
 */
export const createIntercompanyTransactionTool = defineServiceFn({
  input: z.looseObject({
    sourceCompanyId: z.string().min(1),
    targetCompanyId: z.string().min(1),
    amount: z.number().gt(0),
    currencyCode: z.string().min(1),
    description: z.string().min(1),
    debitAccountId: z.string().min(1),
    creditAccountId: z.string().min(1),
    postingDate: z.string().optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await createIntercompanyTransaction(
        ctx.asCaller.supabase,
        stamp(ctx, input, [
          "companyId",
          "createdBy",
          "updatedBy",
          "userId",
          "companyGroupId"
        ]) as never
      )
    );
  }
});

/**
 * Run intercompany matching
 *
 * @mcp
 */
export const runIntercompanyMatchingTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { update: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await runIntercompanyMatching(ctx.asCaller.supabase, ctx.company.groupId)
    );
  }
});

/**
 * Generate eliminations
 *
 * @mcp
 */
export const generateEliminationsTool = defineServiceFn({
  input: z.looseObject({ regenerate: z.boolean().optional() }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await generateEliminations(
        ctx.asCaller.supabase,
        ctx.company.groupId,
        ctx.auditUserId,
        input.regenerate as never
      )
    );
  }
});

/**
 * Market-rate history for the chart on the exchange-rates page
 *
 * @mcp read
 */
export const getExchangeRateHistoryTool = defineServiceFn({
  input: z.looseObject({ currencyCode: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getExchangeRateHistory(
        ctx.asCaller.supabase,
        input.currencyCode as never
      )
    );
  }
});

/**
 * Get journal entries
 *
 * @mcp read
 */
export const getJournalEntriesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getJournalEntries(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get journal entry
 *
 * @mcp read
 */
export const getJournalEntryTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getJournalEntry(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete journal entry
 *
 * @mcp destructive
 */
export const deleteJournalEntryTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteJournalEntry(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Post journal entry
 *
 * @mcp
 */
export const postJournalEntryTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await postJournalEntry(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.auditUserId
      )
    );
  }
});

/**
 * Reverse journal entry
 *
 * @mcp
 */
export const reverseJournalEntryTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    data: z.looseObject({ journalEntryId: z.string().optional() })
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await reverseJournalEntry(
        ctx.asCaller.supabase,
        input.id as never,
        stamp(ctx, input.data, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * Get fixed asset classes
 *
 * @mcp read
 */
export const getFixedAssetClassesTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getFixedAssetClasses(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get fixed asset class
 *
 * @mcp read
 */
export const getFixedAssetClassTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getFixedAssetClass(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get fixed asset classes list
 *
 * @mcp read
 */
export const getFixedAssetClassesListTool = defineServiceFn({
  input: z.record(z.string(), z.unknown()),
  permission: { view: "accounting" },
  async run(ctx) {
    return envelope(
      ctx,
      await getFixedAssetClassesList(ctx.asCaller.supabase, ctx.company.id)
    );
  }
});

/**
 * Create a fixed asset class
 *
 * @remarks
 * Upsert fixed asset class
 *
 * @mcp
 */
export const upsertFixedAssetClassCreateTool = defineServiceFn({
  input: z.looseObject({ data: z.unknown() }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertFixedAssetClass(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.data,
          ["companyId", "createdBy", "updatedBy"],
          "create"
        ) as never
      )
    );
  }
});

/**
 * Update a fixed asset class
 *
 * @remarks
 * Upsert fixed asset class
 *
 * @mcp
 */
export const upsertFixedAssetClassUpdateTool = defineServiceFn({
  input: z.looseObject({ data: z.looseObject({ id: z.string() }) }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await upsertFixedAssetClass(
        ctx.asCaller.supabase,
        stamp(
          ctx,
          input.data,
          ["companyId", "createdBy", "updatedBy"],
          "update"
        ) as never
      )
    );
  }
});

/**
 * Delete fixed asset class
 *
 * @mcp destructive
 */
export const deleteFixedAssetClassTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteFixedAssetClass(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get fixed assets
 *
 * @mcp read
 */
export const getFixedAssetsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    status: z
      .enum([
        "Draft",
        "Active",
        "Fully Depreciated",
        "Disposed",
        "Under Construction"
      ])
      .nullable()
      .optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getFixedAssets(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get fixed asset
 *
 * @mcp read
 */
export const getFixedAssetTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getFixedAsset(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Insert fixed asset
 *
 * @mcp
 */
export const insertFixedAssetTool = defineServiceFn({
  input: z.looseObject({
    fixedAssetId: z.string().optional(),
    fixedAssetClassId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    serialNumber: z.string().optional(),
    depreciationMethod: z.string(),
    usefulLifeMonths: z.number(),
    residualValuePercent: z.number(),
    assetLifetimeUsage: z.number().nullable().optional(),
    locationId: z.string().optional(),
    workCenterId: z.string().nullable().optional(),
    status: z.string().optional(),
    taxDepreciationMethod: z.string().nullable().optional(),
    taxUsefulLifeMonths: z.number().nullable().optional(),
    taxResidualValuePercent: z.number().nullable().optional(),
    macrsPropertyClass: z.string().nullable().optional(),
    macrsConvention: z.string().nullable().optional(),
    bonusDepreciationPercent: z.number().nullable().optional()
  }),
  permission: { create: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await insertFixedAsset(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "createdBy", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Update fixed asset
 *
 * @mcp
 */
export const updateFixedAssetTool = defineServiceFn({
  input: z.looseObject({
    id: z.string(),
    fixedAssetClassId: z.string().optional(),
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    serialNumber: z.string().nullable().optional(),
    depreciationMethod: z
      .enum(["Straight Line", "Declining Balance", "Units of Production"])
      .optional(),
    usefulLifeMonths: z.number().optional(),
    residualValuePercent: z.number().optional(),
    assetLifetimeUsage: z.number().nullable().optional(),
    locationId: z.string().nullable().optional(),
    workCenterId: z.string().nullable().optional(),
    taxDepreciationMethod: z
      .enum(["Straight Line", "Declining Balance", "MACRS"])
      .nullable()
      .optional(),
    taxUsefulLifeMonths: z.number().nullable().optional(),
    taxResidualValuePercent: z.number().nullable().optional(),
    macrsPropertyClass: z
      .enum(["3", "5", "7", "10", "15", "20", "27.5", "39"])
      .nullable()
      .optional(),
    macrsConvention: z.enum(["Half-Year", "Mid-Quarter"]).nullable().optional(),
    bonusDepreciationPercent: z.number().nullable().optional()
  }),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await updateFixedAsset(
        ctx.asCaller.supabase,
        stamp(ctx, input, ["companyId", "updatedBy"]) as never
      )
    );
  }
});

/**
 * Delete fixed asset
 *
 * @mcp destructive
 */
export const deleteFixedAssetTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteFixedAsset(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Delete depreciation run
 *
 * @mcp destructive
 */
export const deleteDepreciationRunTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { delete: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await deleteDepreciationRun(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get depreciation runs
 *
 * @mcp read
 */
export const getDepreciationRunsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getDepreciationRuns(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get depreciation run
 *
 * @mcp read
 */
export const getDepreciationRunTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDepreciationRun(ctx.asCaller.supabase, input.id as never)
    );
  }
});

/**
 * Get depreciation run lines
 *
 * @mcp read
 */
export const getDepreciationRunLinesTool = defineServiceFn({
  input: z.looseObject({ depreciationRunId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDepreciationRunLines(
        ctx.asCaller.supabase,
        input.depreciationRunId as never
      )
    );
  }
});

/**
 * Get revenue recognition run
 *
 * @mcp read
 */
export const getRevenueRecognitionRunTool = defineServiceFn({
  input: z.looseObject({ id: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRevenueRecognitionRun(
        ctx.asCaller.supabase,
        input.id as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get revenue recognition run lines
 *
 * @mcp read
 */
export const getRevenueRecognitionRunLinesTool = defineServiceFn({
  input: z.looseObject({ runId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRevenueRecognitionRunLines(
        ctx.asCaller.supabase,
        input.runId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * The documents around a depreciation or revenue recognition run that its own row doesn't name: the accounting period its `periodEnd` falls in (the one posting r…
 *
 * @mcp read
 */
export const getPeriodRunRelatedItemsTool = defineServiceFn({
  input: z.looseObject({
    periodEnd: z.string(),
    journalIds: z.array(z.string())
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return plain(
      ctx,
      await getPeriodRunRelatedItems(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.periodEnd as never,
        stamp(ctx, input.journalIds, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get deferred revenue waterfall
 *
 * @mcp read
 */
export const getDeferredRevenueWaterfallTool = defineServiceFn({
  input: z.looseObject({ asOf: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getDeferredRevenueWaterfall(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Time and dollar utilization of the rental fleet over `[from, to]` (inclusive `YYYY-MM-DD`)
 *
 * @mcp read
 */
export const getRentalUtilizationTool = defineServiceFn({
  input: z.looseObject({
    from: z.string(),
    to: z.string(),
    fixedAssetClassId: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getRentalUtilization(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * The lessor's net investment in sales-type leases as of `asOf` (spec §4)
 *
 * @mcp read
 */
export const getLeaseNetInvestmentTool = defineServiceFn({
  input: z.looseObject({ asOf: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLeaseNetInvestment(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * The lessee's Lease Liabilities report (spec §11, ASC 842-20-50): the balances, maturity analysis and weighted averages as of `asOf` (`summarizeLeaseLiabilities…
 *
 * @mcp read
 */
export const getLeaseLiabilitiesTool = defineServiceFn({
  input: z.looseObject({
    asOf: z.string(),
    from: z.string().optional(),
    to: z.string().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getLeaseLiabilities(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get asset depreciation history
 *
 * @mcp read
 */
export const getAssetDepreciationHistoryTool = defineServiceFn({
  input: z.looseObject({ fixedAssetId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAssetDepreciationHistory(
        ctx.asCaller.supabase,
        input.fixedAssetId as never
      )
    );
  }
});

/**
 * Get fixed asset disposal
 *
 * @mcp read
 */
export const getFixedAssetDisposalTool = defineServiceFn({
  input: z.looseObject({ fixedAssetId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getFixedAssetDisposal(
        ctx.asCaller.supabase,
        input.fixedAssetId as never
      )
    );
  }
});

/**
 * Get fleet assets
 *
 * @mcp read
 */
export const getFleetAssetsTool = defineServiceFn({
  input: z.looseObject({
    limit: z
      .number()
      .int()
      .describe("Rows per page. Left out, the read is not paged.")
      .optional(),
    offset: z.number().int().default(0),
    search: z.string().nullable().optional(),
    fleetStatus: z.string().nullable().optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return paged(
      ctx,
      await getFleetAssets(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * Get fixed asset transfers
 *
 * @mcp read
 */
export const getFixedAssetTransfersTool = defineServiceFn({
  input: z.looseObject({ fixedAssetId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getFixedAssetTransfers(
        ctx.asCaller.supabase,
        input.fixedAssetId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Get fixed asset cip costs
 *
 * @mcp read
 */
export const getFixedAssetCipCostsTool = defineServiceFn({
  input: z.looseObject({ fixedAssetId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getFixedAssetCipCosts(
        ctx.asCaller.supabase,
        input.fixedAssetId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * The capital tied up in a work center: every non-disposed asset assigned to it, with its net book value and — for straight-line assets — the depreciation it car…
 *
 * @mcp read
 */
export const getWorkCenterCapitalCostTool = defineServiceFn({
  input: z.looseObject({ workCenterId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getWorkCenterCapitalCost(
        ctx.asCaller.supabase,
        input.workCenterId as never,
        ctx.company.id
      )
    );
  }
});

/**
 * Capitalize a unit, return an asset to inventory, attach a job to a CIP asset or capitalize a CIP asset — the `post-asset-transfer` server function, run as the…
 *
 * @mcp
 */
export const invokeAssetTransferTool = defineServiceFn({
  input: z.unknown(),
  permission: { update: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await invokeAssetTransfer(
        ctx.asCaller.supabase,
        ctx.asSystem.pg,
        stamp(ctx, input, ["companyId", "userId"]) as never
      )
    );
  }
});

/**
 * The tie-out grid: every persisted cell for the company, joined with account and period identity, newest period first
 *
 * @mcp read
 */
export const getAccountingSyncTieOutTool = defineServiceFn({
  input: z.looseObject({
    integration: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
    accountingPeriodId: z.string().nullable().optional(),
    accountId: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional()
  }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAccountingSyncTieOut(
        ctx.asCaller.supabase,
        ctx.company.id,
        stamp(ctx, input, ["companyId"]) as never
      )
    );
  }
});

/**
 * One tie-out cell plus its drill-down: the posted journals dated inside the cell's period with at least one line on the cell's account, each with the latest acc…
 *
 * @mcp read
 */
export const getAccountingSyncTieOutCellTool = defineServiceFn({
  input: z.looseObject({ cellId: z.string() }),
  permission: { view: "accounting" },
  async run(ctx, input) {
    return envelope(
      ctx,
      await getAccountingSyncTieOutCell(
        ctx.asCaller.supabase,
        ctx.company.id,
        input.cellId as never
      )
    );
  }
});
