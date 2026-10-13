// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The chart of accounts import (.ai/specs/2026-10-12-chart-of-accounts-import.md).
// Two files: the customer's chart of accounts (what exists) and the default
// accounts (which customer account each default role and fixed asset class
// account uses). The Carbon account behind a default becomes the customer
// account it maps to, keeping its id and history; a Carbon account whose
// number is in the chart is the same account; every other Carbon account is
// deleted, and every chart row nobody claimed is created. Only before
// accounting is activated, so nothing has Posted history yet.
// `planAccountImport` is pure, so the review page and the apply server
// function compute the same plan. The reads live in ./account-import-reads.

import type { AccountDefaultColumn } from "./accounting-cutover/shared.ts";
import { ACCOUNT_DEFAULT_COLUMNS } from "./accounting-cutover/shared.ts";
import { hasDefaultFallback } from "./journal-posting-status.ts";
import type { AccountClass } from "./ledger.ts";
import { Constants } from "./types.ts";

export type { AccountDefaultColumn };
export { ACCOUNT_DEFAULT_COLUMNS };

export type AccountType =
  (typeof Constants)["public"]["Enums"]["accountType"][number];

export const ACCOUNT_TYPES: readonly AccountType[] =
  Constants.public.Enums.accountType;

export const ACCOUNT_CLASSES: readonly AccountClass[] = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense"
];

/** The type a new row gets when the sheet leaves `Type` empty. */
export const DEFAULT_ACCOUNT_TYPE_BY_CLASS: Record<AccountClass, AccountType> =
  {
    Asset: "Other Current Asset",
    Liability: "Other Current Liability",
    Equity: "Equity - No Close",
    Revenue: "Income",
    Expense: "Expense"
  };

export function incomeBalanceOf(
  accountClass: AccountClass
): "Balance Sheet" | "Income Statement" {
  return accountClass === "Revenue" || accountClass === "Expense"
    ? "Income Statement"
    : "Balance Sheet";
}

/**
 * Each default role by the name the Default Accounts page shows. A sheet may
 * name a Carbon account by its role ("Accounts Receivable" works too, below).
 * Plain English: the sheet is data, not UI.
 */
export const ROLE_NAMES = {
  bankCashAccount: "Bank - Cash",
  bankLocalCurrencyAccount: "Bank - Local Currency",
  bankForeignCurrencyAccount: "Bank - Foreign Currency",
  receivablesAccount: "Receivables",
  prepaymentAccount: "Prepayments",
  customerWriteOffAccount: "Customer Write-Off (Bad Debt)",
  deferredRevenueAccount: "Deferred Revenue",
  contractAssetAccount: "Contract Assets",
  netInvestmentInLeasesAccount: "Net Investment in Leases",
  rawMaterialsAccount: "Raw Materials",
  finishedGoodsAccount: "Finished Goods",
  workInProgressAccount: "Work in Progress (WIP)",
  assetAquisitionCostAccount: "Asset Acquisition Cost",
  assetAquisitionCostOnDisposalAccount: "Asset Cost on Disposal",
  accumulatedDepreciationAccount: "Accumulated Depreciation",
  accumulatedDepreciationOnDisposalAccount:
    "Accumulated Depreciation on Disposal",
  payablesAccount: "Payables",
  supplierPrepaymentAccount: "Supplier Prepayments",
  goodsReceivedNotInvoicedAccount: "GR/IR Clearing",
  supplierWriteOffAccount: "Supplier Write-Off Income",
  employeeReimbursementsPayableAccount: "Employee Reimbursements Payable",
  intercompanyReceivablesAccount: "Intercompany Receivables",
  intercompanyPayablesAccount: "Intercompany Payables",
  salesTaxPayableAccount: "Sales Tax Payable",
  purchaseTaxPayableAccount: "Purchase Tax Payable",
  reverseChargeSalesTaxPayableAccount: "Reverse Charge Sales Tax",
  deferredTaxLiabilityAccountId: "Deferred Tax Liability",
  retainedEarningsAccount: "Retained Earnings",
  currencyTranslationAccount: "Currency Translation",
  migrationClearingAccount: "Migration Clearing",
  salesAccount: "Sales",
  salesShippingRevenueAccount: "Shipping Revenue",
  salesDiscountAccount: "Sales Discounts",
  salesReturnsAccount: "Sales Returns",
  customerPaymentDiscountAccount: "Customer Payment Discounts",
  realizedExchangeGainAccount: "Realized Exchange Gain",
  rentalIncomeAccount: "Rental Income",
  leaseRevenueAccount: "Lease Revenue",
  leaseInterestIncomeAccount: "Interest Income – Leases",
  costOfGoodsSoldAccount: "Cost of Goods Sold",
  indirectCostAccount: "Indirect Materials & Services",
  supplierPaymentDiscountAccount: "Supplier Payment Discounts",
  laborAbsorptionAccount: "Labor & Machine Absorption",
  overheadAbsorptionAccount: "Overhead Absorption",
  purchaseVarianceAccount: "Purchase Price Variance",
  inventoryAdjustmentVarianceAccount: "Inventory Adjustment",
  scrapAccount: "Scrap / Cost of Quality",
  materialVarianceAccount: "Material Usage Variance",
  laborAndMachineVarianceAccount: "Labor & Machine Variance",
  overheadVarianceAccount: "Overhead Variance",
  lotSizeVarianceAccount: "Lot Size Variance",
  subcontractingVarianceAccount: "Subcontracting Variance",
  maintenanceAccount: "Maintenance Expense",
  assetDepreciationExpenseAccount: "Depreciation Expense",
  assetGainOnDisposalAccount: "Gain on Disposal",
  assetLossOnDisposalAccount: "Loss on Disposal",
  serviceChargeAccount: "Service Charges",
  interestAccount: "Interest",
  roundingAccount: "Rounding Account",
  deferredTaxExpenseAccountId: "Deferred Tax Expense",
  realizedExchangeLossAccount: "Realized Exchange Loss"
} as const satisfies Record<AccountDefaultColumn, string>;

/** Other names a sheet commonly uses for a role. */
const ROLE_ALIASES: Record<string, AccountDefaultColumn> = {
  "accounts receivable": "receivablesAccount",
  "accounts payable": "payablesAccount",
  inventory: "rawMaterialsAccount",
  "work in progress": "workInProgressAccount",
  wip: "workInProgressAccount",
  "goods received not invoiced": "goodsReceivedNotInvoicedAccount",
  cogs: "costOfGoodsSoldAccount"
};

/**
 * The roles activation readiness demands: every default with no fallback. An
 * account that holds one can only retire into a target.
 */
export function requiredRoles(): AccountDefaultColumn[] {
  return ACCOUNT_DEFAULT_COLUMNS.filter((role) => !hasDefaultFallback(role));
}

export type ReferencePolicy =
  | "repoint"
  | "repoint-if-draft"
  | "repoint-if-unposted-journal"
  | "history";

export type ReferenceParent = {
  /** The row whose status decides; `null` means the row itself. */
  table: string | null;
  /** The column of the referencing row that holds the parent's id. */
  column: string | null;
  statuses: readonly string[];
};

export type AccountReference = {
  table: string;
  column: string;
  policy: ReferencePolicy;
  parent?: ReferenceParent;
  /** Columns that must stay unique per group after a re-point. */
  dedupeOn?: readonly string[];
};

const draft = (table: string | null, column: string | null) =>
  ({ table, column, statuses: ["Draft"] }) as const;

/**
 * Every foreign key to `account` other than `accountDefault` and
 * `fixedAssetClass` (both set from the default accounts file) and
 * `account.parentId` (leaves have no children). A merge moves
 * the rows a policy allows; a row it does not move is a history reference,
 * and the plan refuses to remove an account that has one. The
 * apply-account-import live-database test compares this list with the catalog,
 * so a new account column fails that test until it is classified here.
 *
 * The projects branch (projects-wbs-research-spec) adds 5 more. Whichever of
 * the two branches merges second adds them here:
 *   project.costAccountId, projectElement.costAccountId: repoint
 *   indirectPool.appliedAccountId: repoint
 *   indirectPoolAccount.accountId: repoint,
 *     dedupeOn ["indirectPoolId", "accountId", "dimensionValueId", "role"]
 *   indirectExpenseStatement.accountId: history (a period snapshot)
 */
export const REFERENCE_POLICY: readonly AccountReference[] = [
  { table: "shippingMethod", column: "carrierAccountId", policy: "repoint" },
  { table: "purchaseOrderLine", column: "accountId", policy: "repoint" },
  { table: "salesOrderLine", column: "accountId", policy: "repoint" },
  { table: "supplierQuoteLine", column: "accountId", policy: "repoint" },
  // A Posted row's journal stays on the old account, so only Planned rows move.
  {
    table: "revenueRecognitionSchedule",
    column: "debitAccountId",
    policy: "repoint-if-draft",
    parent: { table: null, column: null, statuses: ["Planned"] }
  },
  {
    table: "revenueRecognitionSchedule",
    column: "creditAccountId",
    policy: "repoint-if-draft",
    parent: { table: null, column: null, statuses: ["Planned"] }
  },
  {
    table: "salesInvoiceLine",
    column: "accountId",
    policy: "repoint-if-draft",
    parent: draft("salesInvoice", "invoiceId")
  },
  {
    table: "purchaseInvoiceLine",
    column: "accountId",
    policy: "repoint-if-draft",
    parent: draft("purchaseInvoice", "invoiceId")
  },
  {
    table: "chargeLine",
    column: "accountId",
    policy: "repoint-if-draft",
    parent: draft("charge", "chargeId")
  },
  {
    table: "charge",
    column: "cardAccountId",
    policy: "repoint-if-draft",
    parent: draft(null, null)
  },
  {
    table: "charge",
    column: "offsetAccountId",
    policy: "repoint-if-draft",
    parent: draft(null, null)
  },
  {
    table: "reimbursementLine",
    column: "accountId",
    policy: "repoint-if-draft",
    parent: draft("reimbursement", "reimbursementId")
  },
  {
    table: "reimbursement",
    column: "payableAccountId",
    policy: "repoint-if-draft",
    parent: draft(null, null)
  },
  {
    table: "payment",
    column: "bankAccount",
    policy: "repoint-if-draft",
    parent: draft(null, null)
  },
  {
    table: "memo",
    column: "reasonAccount",
    policy: "repoint-if-draft",
    parent: draft(null, null)
  },
  {
    table: "journalLine",
    column: "accountId",
    policy: "repoint-if-unposted-journal",
    parent: {
      table: "journal",
      column: "journalId",
      statuses: ["Draft", "Provisional"]
    }
  },
  { table: "accountingPeriodBalance", column: "accountId", policy: "history" },
  { table: "accountingSyncTieOut", column: "accountId", policy: "history" }
];

/**
 * The references with no foreign key. The apply handles each by hand:
 * - intercompanyEliminationLine.accountId follows its journal line when that
 *   line's journal is Draft or Provisional.
 * - externalIntegrationMapping rows with entityType 'account' for the source
 *   are deleted; the target keeps its own mapping.
 * - companyIntegration.metadata.paymentFeeAccount is re-pointed.
 */
export const SOFT_REFERENCES = [
  "intercompanyEliminationLine.accountId",
  "externalIntegrationMapping.entityId",
  "companyIntegration.metadata.paymentFeeAccount"
] as const;

/** The `fixedAssetClass` columns that name an account. All NOT NULL. */
export const FIXED_ASSET_CLASS_COLUMNS = [
  "assetAccountId",
  "accumulatedDepreciationAccountId",
  "depreciationExpenseAccountId",
  "writeOffAccountId",
  "writeDownAccountId",
  "lossOnDisposalAccountId",
  "gainOnDisposalAccountId"
] as const;
export type FixedAssetClassColumn = (typeof FIXED_ASSET_CLASS_COLUMNS)[number];

export const FIXED_ASSET_CLASS_COLUMN_NAMES: Record<
  FixedAssetClassColumn,
  string
> = {
  assetAccountId: "Asset",
  accumulatedDepreciationAccountId: "Accumulated Depreciation",
  depreciationExpenseAccountId: "Depreciation Expense",
  writeOffAccountId: "Write-Off",
  writeDownAccountId: "Write-Down",
  lossOnDisposalAccountId: "Loss on Disposal",
  gainOnDisposalAccountId: "Gain on Disposal"
};

/** The key of a fixed asset class account in the default accounts file. */
export function assetClassKey(
  className: string,
  column: FixedAssetClassColumn
) {
  return `asset-class:${className}:${column}`;
}

/** The label of a fixed asset class account in the default accounts file. */
export function assetClassLabel(
  className: string,
  column: FixedAssetClassColumn
) {
  return `${className} – ${FIXED_ASSET_CLASS_COLUMN_NAMES[column]}`;
}

const CLASS_OF_TYPE: Record<AccountType, AccountClass> = {
  Bank: "Asset",
  Cash: "Asset",
  "Accounts Receivable": "Asset",
  Inventory: "Asset",
  "Fixed Asset": "Asset",
  "Accumulated Depreciation": "Asset",
  "Other Current Asset": "Asset",
  "Other Asset": "Asset",
  Investments: "Asset",
  "Accounts Payable": "Liability",
  "Other Current Liability": "Liability",
  "Long Term Liability": "Liability",
  Tax: "Liability",
  "Equity - No Close": "Equity",
  "Equity - Close": "Equity",
  "Retained Earnings": "Equity",
  Income: "Revenue",
  "Other Income": "Revenue",
  "Cost of Goods Sold": "Expense",
  Expense: "Expense",
  "Other Expense": "Expense"
};

export function classOfAccountType(type: AccountType): AccountClass {
  return CLASS_OF_TYPE[type];
}

const key = (value: string) => value.trim().toLowerCase();

const CLASS_SYNONYMS: Record<string, AccountClass> = {
  asset: "Asset",
  assets: "Asset",
  liability: "Liability",
  liabilities: "Liability",
  equity: "Equity",
  revenue: "Revenue",
  revenues: "Revenue",
  income: "Revenue",
  "other income": "Revenue",
  expense: "Expense",
  expenses: "Expense",
  "other expense": "Expense",
  "cost of goods sold": "Expense",
  "cost of sales": "Expense"
};

/** An account class from the words a chart export uses, or null. */
export function normalizeAccountClass(value: string): AccountClass | null {
  return CLASS_SYNONYMS[key(value)] ?? null;
}

const TYPE_SYNONYMS: Record<string, AccountType> = {
  "accounts receivable (a/r)": "Accounts Receivable",
  "accounts payable (a/p)": "Accounts Payable",
  "current asset": "Other Current Asset",
  "current assets": "Other Current Asset",
  "other current assets": "Other Current Asset",
  "fixed assets": "Fixed Asset",
  "other assets": "Other Asset",
  "current liability": "Other Current Liability",
  "current liabilities": "Other Current Liability",
  "other current liabilities": "Other Current Liability",
  "credit card": "Other Current Liability",
  "long term liabilities": "Long Term Liability",
  "long-term liability": "Long Term Liability",
  equity: "Equity - No Close",
  "cost of sales": "Cost of Goods Sold",
  cogs: "Cost of Goods Sold",
  expenses: "Expense",
  "other expenses": "Other Expense",
  revenue: "Income"
};

/** A Carbon account type from the words a chart export uses, or null. */
export function normalizeAccountType(value: string): AccountType | null {
  const wanted = key(value);
  const exact = ACCOUNT_TYPES.find((t) => key(t) === wanted);
  return exact ?? TYPE_SYNONYMS[wanted] ?? null;
}

/** One row of the customer's chart of accounts. */
export type ChartImportRow = {
  /** The file line; the header is line 1. */
  line: number;
  number: string;
  name: string;
  class: AccountClass | null;
  accountType: AccountType | null;
  group: string;
};

/** One row of the default accounts file. */
export type DefaultImportRow = {
  line: number;
  /** An `accountDefault` column, or an `assetClassKey`. */
  key: string;
  /** The customer's account number, or null when left blank. */
  number: string | null;
};

export type ChartAccount = {
  id: string;
  number: string | null;
  name: string;
  class: AccountClass | null;
  accountType: string | null;
  incomeBalance: "Balance Sheet" | "Income Statement";
  parentId: string | null;
  isGroup: boolean;
  isSystem: boolean;
  active: boolean;
};

export type AccountUsage = {
  /** Rows REFERENCE_POLICY moves (Draft or Provisional), per company. */
  movableReferencesByCompany: Record<string, number>;
  /** Rows it never moves (posted history). None exist before activation. */
  historyReferences: number;
};

export type AccountImportCompany = {
  id: string;
  name: string;
  hasCutover: boolean;
};

export type AccountDefaultsRow = Record<AccountDefaultColumn, string | null>;

export type FixedAssetClassRow = {
  id: string;
  companyId: string;
  name: string;
  accounts: Record<FixedAssetClassColumn, string | null>;
};

export type AccountImportContext = {
  /** Every account of the group, groups included, active or not. */
  chart: ChartAccount[];
  companies: AccountImportCompany[];
  defaultsByCompany: Record<string, AccountDefaultsRow>;
  fixedAssetClasses: FixedAssetClassRow[];
  /** By account id. An account with no entry has no references. */
  usage: Record<string, AccountUsage>;
  importingCompanyId: string;
};

export type AccountImportResolutions = {
  /** A Carbon account no file keeps → the chart line it merges into. */
  targets: Record<string, number>;
};

export type AccountImportError =
  | { code: "accounting-activated"; companyId: string }
  | { code: "duplicate-number"; line: number; firstLine: number; value: string }
  | { code: "duplicate-name"; line: number; firstLine: number; value: string }
  | { code: "missing-class"; line: number }
  | { code: "group-class-mismatch"; line: number; group: string }
  | { code: "unknown-default"; line: number; value: string }
  | { code: "duplicate-default"; line: number; firstLine: number; key: string }
  | { code: "default-not-in-chart"; line: number; value: string }
  | { code: "default-missing"; key: string }
  | { code: "migration-clearing-not-equity"; line: number }
  | { code: "account-has-history"; accountId: string }
  | { code: "target-not-in-chart"; accountId: string; line: number };

export type AccountImportException = {
  code: "account-needs-target";
  accountId: string;
  companyIds: string[];
};

export type AccountImportPlan = {
  /** The Carbon account each kept chart line is. */
  claims: { line: number; accountId: string }[];
  updates: {
    accountId: string;
    line: number;
    number: string;
    name: string;
    class: AccountClass;
    accountType: AccountType;
    group: string;
  }[];
  creates: {
    line: number;
    number: string;
    name: string;
    class: AccountClass;
    accountType: AccountType;
    group: string;
  }[];
  merges: { sourceId: string; targetLine: number }[];
  deletes: string[];
  /** Every default role of every company; `toLine` null clears it. */
  roleMoves: {
    companyId: string;
    role: AccountDefaultColumn;
    toLine: number | null;
  }[];
  assetClassMoves: {
    classId: string;
    companyId: string;
    column: FixedAssetClassColumn;
    toLine: number;
  }[];
  groupCreates: { name: string; class: AccountClass }[];
  companies: { companyId: string; repointedReferences: number }[];
  errors: AccountImportError[];
  exceptions: AccountImportException[];
};

const NO_USAGE: AccountUsage = {
  movableReferencesByCompany: {},
  historyReferences: 0
};

/** Resolve a default accounts file key or label to its canonical key. */
export function resolveDefaultKey(
  value: string,
  assetClassNames: readonly string[]
): string | null {
  const trimmed = value.trim();
  const wanted = key(trimmed);
  for (const column of ACCOUNT_DEFAULT_COLUMNS) {
    if (key(column) === wanted || key(ROLE_NAMES[column]) === wanted) {
      return column;
    }
  }
  if (ROLE_ALIASES[wanted]) return ROLE_ALIASES[wanted];
  for (const className of assetClassNames) {
    for (const column of FIXED_ASSET_CLASS_COLUMNS) {
      const k = assetClassKey(className, column);
      if (
        key(k) === wanted ||
        key(assetClassLabel(className, column)) === wanted
      ) {
        return k;
      }
    }
  }
  return null;
}

export function planAccountImport(
  chartRows: ChartImportRow[],
  defaultRows: DefaultImportRow[],
  ctx: AccountImportContext,
  resolutions: AccountImportResolutions
): AccountImportPlan {
  const plan: AccountImportPlan = {
    claims: [],
    updates: [],
    creates: [],
    merges: [],
    deletes: [],
    roleMoves: [],
    assetClassMoves: [],
    groupCreates: [],
    companies: [],
    errors: [],
    exceptions: []
  };
  const { errors } = plan;
  const usageOf = (id: string) => ctx.usage[id] ?? NO_USAGE;

  // 0. Only before accounting is activated: nothing has Posted history yet.
  for (const company of ctx.companies) {
    if (company.hasCutover) {
      errors.push({ code: "accounting-activated", companyId: company.id });
    }
  }
  if (errors.length > 0) return plan;

  const accountById = new Map(ctx.chart.map((a) => [a.id, a]));
  const leaves = ctx.chart.filter((a) => !a.isGroup && !a.isSystem);
  const groups = ctx.chart.filter((a) => a.isGroup);
  const groupByName = new Map(groups.map((g) => [key(g.name), g]));
  const rowByLine = new Map(chartRows.map((r) => [r.line, r]));

  // 1. The chart: unique numbers and names.
  const lineByNumber = new Map<string, number>();
  const lineByName = new Map<string, number>();
  for (const row of chartRows) {
    const n = key(row.number);
    const seenNumber = lineByNumber.get(n);
    if (seenNumber !== undefined) {
      errors.push({
        code: "duplicate-number",
        line: row.line,
        firstLine: seenNumber,
        value: row.number
      });
    } else lineByNumber.set(n, row.line);
    const seenName = lineByName.get(key(row.name));
    if (seenName !== undefined) {
      errors.push({
        code: "duplicate-name",
        line: row.line,
        firstLine: seenName,
        value: row.name
      });
    } else lineByName.set(key(row.name), row.line);
  }

  // 2. The defaults: every key known, once, and every number in the chart.
  const assetClassNames = [
    ...new Set(ctx.fixedAssetClasses.map((c) => c.name))
  ];
  const targetByKey = new Map<string, number | null>();
  const keyLine = new Map<string, number>();
  for (const row of defaultRows) {
    const k = resolveDefaultKey(row.key, assetClassNames);
    if (!k) {
      errors.push({ code: "unknown-default", line: row.line, value: row.key });
      continue;
    }
    const firstLine = keyLine.get(k);
    if (firstLine !== undefined) {
      errors.push({
        code: "duplicate-default",
        line: row.line,
        firstLine,
        key: k
      });
      continue;
    }
    keyLine.set(k, row.line);
    if (!row.number || row.number.trim() === "") {
      targetByKey.set(k, null);
      continue;
    }
    const line = lineByNumber.get(key(row.number));
    if (line === undefined) {
      errors.push({
        code: "default-not-in-chart",
        line: row.line,
        value: row.number
      });
      continue;
    }
    targetByKey.set(k, line);
  }
  const required = [
    ...requiredRoles(),
    ...assetClassNames.flatMap((name) =>
      FIXED_ASSET_CLASS_COLUMNS.map((column) => assetClassKey(name, column))
    )
  ];
  for (const k of required) {
    // A number missing from the chart was reported above.
    if (!keyLine.has(k) || targetByKey.get(k) === null) {
      errors.push({ code: "default-missing", key: k });
    }
  }

  // 3. Claims from the defaults: the Carbon account behind a default becomes
  // the customer account it maps to. A second Carbon account mapped to the
  // same customer account merges into it.
  const claimByLine = new Map<number, string>();
  const decided = new Set<string>();
  const merges: { sourceId: string; targetLine: number }[] = [];
  const decide = (
    accountId: string | null,
    line: number | null | undefined
  ) => {
    if (!accountId || line === null || line === undefined) return;
    if (decided.has(accountId) || !accountById.has(accountId)) return;
    decided.add(accountId);
    if (claimByLine.has(line))
      merges.push({ sourceId: accountId, targetLine: line });
    else claimByLine.set(line, accountId);
  };
  const importing = ctx.defaultsByCompany[ctx.importingCompanyId];
  if (importing) {
    for (const role of ACCOUNT_DEFAULT_COLUMNS) {
      decide(importing[role], targetByKey.get(role));
    }
  }
  for (const fac of ctx.fixedAssetClasses.filter(
    (c) => c.companyId === ctx.importingCompanyId
  )) {
    for (const column of FIXED_ASSET_CLASS_COLUMNS) {
      decide(
        fac.accounts[column],
        targetByKey.get(assetClassKey(fac.name, column))
      );
    }
  }

  // 4. A Carbon account whose number is in the chart is the same account.
  for (const leaf of leaves) {
    if (decided.has(leaf.id) || !leaf.number) continue;
    const line = lineByNumber.get(key(leaf.number));
    if (line === undefined || claimByLine.has(line)) continue;
    decided.add(leaf.id);
    claimByLine.set(line, leaf.id);
  }

  // 5. Every other Carbon account goes: deleted, or merged into the row the
  // review picked when Draft or Provisional records still use it.
  for (const leaf of leaves) {
    if (decided.has(leaf.id)) continue;
    const usage = usageOf(leaf.id);
    const companies = Object.entries(usage.movableReferencesByCompany)
      .filter(([, count]) => count > 0)
      .map(([companyId]) => companyId)
      .sort();
    if (companies.length === 0) {
      plan.deletes.push(leaf.id);
      continue;
    }
    const targetLine = resolutions.targets[leaf.id];
    if (targetLine === undefined) {
      plan.exceptions.push({
        code: "account-needs-target",
        accountId: leaf.id,
        companyIds: companies
      });
    } else if (!rowByLine.has(targetLine)) {
      errors.push({
        code: "target-not-in-chart",
        accountId: leaf.id,
        line: targetLine
      });
    } else {
      merges.push({ sourceId: leaf.id, targetLine });
    }
  }
  for (const merge of merges) plan.deletes.push(merge.sourceId);
  for (const accountId of plan.deletes) {
    if (usageOf(accountId).historyReferences > 0) {
      errors.push({ code: "account-has-history", accountId });
    }
  }
  plan.merges = merges;

  // 6. Kept rows update their account; the rest are created.
  const classOfRow = (row: ChartImportRow): AccountClass | null => {
    if (row.class) return row.class;
    if (row.accountType) return classOfAccountType(row.accountType);
    const claimed = claimByLine.get(row.line);
    return claimed ? (accountById.get(claimed)?.class ?? null) : null;
  };
  for (const row of chartRows) {
    const rowClass = classOfRow(row);
    if (!rowClass) {
      errors.push({ code: "missing-class", line: row.line });
      continue;
    }
    const accountId = claimByLine.get(row.line);
    if (!accountId) {
      plan.creates.push({
        line: row.line,
        number: row.number.trim(),
        name: row.name.trim(),
        class: rowClass,
        accountType: row.accountType ?? DEFAULT_ACCOUNT_TYPE_BY_CLASS[rowClass],
        group: row.group.trim()
      });
      continue;
    }
    plan.claims.push({ line: row.line, accountId });
    const account = accountById.get(accountId)!;
    const accountType =
      row.accountType ??
      (account.accountType &&
      isAccountType(account.accountType) &&
      classOfAccountType(account.accountType) === rowClass
        ? account.accountType
        : DEFAULT_ACCOUNT_TYPE_BY_CLASS[rowClass]);
    const currentGroup = account.parentId
      ? (accountById.get(account.parentId)?.name ?? "")
      : "";
    const changed =
      (account.number ?? "") !== row.number.trim() ||
      account.name !== row.name.trim() ||
      account.class !== rowClass ||
      account.accountType !== accountType ||
      key(currentGroup) !== key(row.group) ||
      !account.active;
    if (changed) {
      plan.updates.push({
        accountId,
        line: row.line,
        number: row.number.trim(),
        name: row.name.trim(),
        class: rowClass,
        accountType,
        group: row.group.trim()
      });
    }
  }

  // 7. Defaults and fixed asset classes for every company of the group.
  for (const companyId of Object.keys(ctx.defaultsByCompany).sort()) {
    for (const role of ACCOUNT_DEFAULT_COLUMNS) {
      plan.roleMoves.push({
        companyId,
        role,
        toLine: targetByKey.get(role) ?? null
      });
    }
  }
  for (const fac of ctx.fixedAssetClasses) {
    for (const column of FIXED_ASSET_CLASS_COLUMNS) {
      const line = targetByKey.get(assetClassKey(fac.name, column));
      if (line === null || line === undefined) continue;
      plan.assetClassMoves.push({
        classId: fac.id,
        companyId: fac.companyId,
        column,
        toLine: line
      });
    }
  }

  // 8. Groups, by name, under the root that matches the class.
  const newGroupClass = new Map<string, AccountClass>();
  for (const row of chartRows) {
    const rowClass = classOfRow(row);
    if (!rowClass) continue;
    const existing = groupByName.get(key(row.group));
    if (existing) {
      const fits = existing.class
        ? existing.class === rowClass
        : existing.incomeBalance === incomeBalanceOf(rowClass);
      if (!fits) {
        errors.push({
          code: "group-class-mismatch",
          line: row.line,
          group: row.group
        });
      }
      continue;
    }
    const planned = newGroupClass.get(key(row.group));
    if (planned === undefined) {
      newGroupClass.set(key(row.group), rowClass);
      plan.groupCreates.push({ name: row.group.trim(), class: rowClass });
    } else if (incomeBalanceOf(planned) !== incomeBalanceOf(rowClass)) {
      errors.push({
        code: "group-class-mismatch",
        line: row.line,
        group: row.group
      });
    }
  }

  // 9. Migration Clearing must be Equity.
  const clearingLine = targetByKey.get("migrationClearingAccount");
  if (clearingLine !== null && clearingLine !== undefined) {
    const row = rowByLine.get(clearingLine);
    if (row && classOfRow(row) !== "Equity") {
      errors.push({
        code: "migration-clearing-not-equity",
        line: clearingLine
      });
    }
  }

  // 10. The companies whose Draft or Provisional records move.
  for (const company of ctx.companies) {
    let repointedReferences = 0;
    for (const merge of merges) {
      repointedReferences +=
        usageOf(merge.sourceId).movableReferencesByCompany[company.id] ?? 0;
    }
    if (repointedReferences > 0) {
      plan.companies.push({ companyId: company.id, repointedReferences });
    }
  }

  const numberOf = (id: string) => accountById.get(id)?.number ?? "";
  plan.merges.sort(
    (a, b) =>
      a.targetLine - b.targetLine ||
      numberOf(a.sourceId).localeCompare(numberOf(b.sourceId))
  );
  plan.deletes.sort((a, b) => numberOf(a).localeCompare(numberOf(b)));
  plan.exceptions.sort((a, b) =>
    numberOf(a.accountId).localeCompare(numberOf(b.accountId))
  );
  return plan;
}

const isAccountType = (value: string): value is AccountType =>
  (ACCOUNT_TYPES as readonly string[]).includes(value);

/** True when the plan can be applied. */
export function isApplicable(plan: AccountImportPlan): boolean {
  return plan.errors.length === 0 && plan.exceptions.length === 0;
}
