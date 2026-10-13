// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The chart of accounts import (.ai/specs/2026-10-12-chart-of-accounts-import.md).
// Two files: the customer's chart of accounts (what exists) and the default
// accounts (which customer account each default role and fixed asset class
// account uses). The Carbon account behind a default becomes the customer
// account it maps to, keeping its id and history; a Carbon account whose
// number is in the chart is the same account; every other Carbon account is
// deleted, or merged into the row the review picks while documents or
// journals use it; every chart row nobody claimed is created. Only before
// accounting is activated, so nothing has Posted history yet.
// `planAccountImport` is pure, so the review page and the apply server
// function compute the same plan. The reads live in ./account-import-reads.

import type { AccountDefaultColumn } from "./accounting-cutover/shared.ts";
import { ACCOUNT_DEFAULT_COLUMNS } from "./accounting-cutover/shared.ts";
import { MIGRATION_CLEARING_ACCOUNT_CLASS } from "./accounting-cutover.ts";
import { hasDefaultFallback } from "./journal-posting-status.ts";
import type { AccountClass } from "./ledger.ts";
import { Constants } from "./types.ts";

export type { AccountDefaultColumn };
export { ACCOUNT_DEFAULT_COLUMNS };

export type AccountType =
  (typeof Constants)["public"]["Enums"]["accountType"][number];

export const ACCOUNT_TYPES: readonly AccountType[] =
  Constants.public.Enums.accountType;

/** The type a row gets when the chart file gives none. */
const DEFAULT_ACCOUNT_TYPE_BY_CLASS: Record<AccountClass, AccountType> = {
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

/** Each default role by the name the Default Accounts page shows. */
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
  rightOfUseAssetAccount: "Right-of-Use Assets",
  accumulatedRightOfUseAmortizationAccount:
    "Accumulated Amortization – Right-of-Use Assets",
  payablesAccount: "Payables",
  supplierPrepaymentAccount: "Supplier Prepayments",
  goodsReceivedNotInvoicedAccount: "GR/IR Clearing",
  supplierWriteOffAccount: "Supplier Write-Off Income",
  employeeReimbursementsPayableAccount: "Employee Reimbursements Payable",
  intercompanyReceivablesAccount: "Intercompany Receivables",
  intercompanyPayablesAccount: "Intercompany Payables",
  leaseLiabilityAccount: "Lease Liabilities",
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
  operatingLeaseExpenseAccount: "Operating Lease Expense",
  variableLeaseExpenseAccount: "Variable Lease Expense",
  rightOfUseAmortizationExpenseAccount: "Amortization – Right-of-Use Assets",
  leaseInterestExpenseAccount: "Interest Expense – Leases",
  serviceChargeAccount: "Service Charges",
  interestAccount: "Interest",
  roundingAccount: "Rounding Account",
  deferredTaxExpenseAccountId: "Deferred Tax Expense",
  realizedExchangeLossAccount: "Realized Exchange Loss"
} as const satisfies Record<AccountDefaultColumn, string>;

/** The roles activation readiness demands: every default with no fallback. */
export function requiredRoles(): AccountDefaultColumn[] {
  return ACCOUNT_DEFAULT_COLUMNS.filter((role) => !hasDefaultFallback(role));
}

/**
 * How a merge treats one column that names an account:
 * - `repoint`: every row moves to the target.
 * - `repoint-if-status`: a row moves while its own `status` is listed.
 * - `repoint-if-parent-status`: a row moves while its parent's is listed.
 * - `history`: never moves; an account with such a row cannot be removed.
 */
export type AccountReference = { table: string; column: string } & (
  | { policy: "repoint" | "history" }
  | { policy: "repoint-if-status"; statuses: readonly string[] }
  | {
      policy: "repoint-if-parent-status";
      parentTable: string;
      parentColumn: string;
      statuses: readonly string[];
    }
);

/**
 * Every foreign key to `account` other than `accountDefault` and
 * `fixedAssetClass` (both set from the default accounts file) and
 * `account.parentId` (leaves have no children). The apply-account-import
 * live-database test compares this list with the catalog, so a new account
 * column fails that test until it is classified here. The references with no
 * foreign key are read and moved by hand: `intercompanyEliminationLine`,
 * `externalIntegrationMapping` and `companyIntegration.metadata`
 * (account-import-reads.ts, apply-account-import).
 *
 * The projects branch (projects-wbs-research-spec) adds 5 more. Whichever of
 * the two branches merges second adds them here:
 *   project.costAccountId, projectElement.costAccountId: repoint
 *   indirectPool.appliedAccountId: repoint
 *   indirectPoolAccount.accountId: repoint, and the apply must first remove
 *     the rows that would become duplicates (same pool, account, dimension
 *     value and role)
 *   indirectExpenseStatement.accountId: history (a period snapshot)
 */
export const REFERENCE_POLICY: readonly AccountReference[] = [
  { table: "shippingMethod", column: "carrierAccountId", policy: "repoint" },
  { table: "purchaseOrderLine", column: "accountId", policy: "repoint" },
  { table: "salesOrderLine", column: "accountId", policy: "repoint" },
  { table: "supplierQuoteLine", column: "accountId", policy: "repoint" },
  // A Posted row's journal stays on the old account, so only Planned rows
  // move. A run posts only after the cutover, so none is Posted here.
  {
    table: "revenueRecognitionSchedule",
    column: "debitAccountId",
    policy: "repoint-if-status",
    statuses: ["Planned"]
  },
  {
    table: "revenueRecognitionSchedule",
    column: "creditAccountId",
    policy: "repoint-if-status",
    statuses: ["Planned"]
  },
  // Posted documents move with their journal lines: the import runs only
  // before the cutover, so their journals are Provisional. The charge and
  // reimbursement guards let the import change these columns on a posted
  // row (app.account_import, 20261013035046).
  { table: "salesInvoiceLine", column: "accountId", policy: "repoint" },
  { table: "purchaseInvoiceLine", column: "accountId", policy: "repoint" },
  { table: "chargeLine", column: "accountId", policy: "repoint" },
  { table: "charge", column: "cardAccountId", policy: "repoint" },
  { table: "charge", column: "offsetAccountId", policy: "repoint" },
  { table: "reimbursementLine", column: "accountId", policy: "repoint" },
  { table: "reimbursement", column: "payableAccountId", policy: "repoint" },
  { table: "payment", column: "bankAccount", policy: "repoint" },
  { table: "memo", column: "reasonAccount", policy: "repoint" },
  {
    table: "journalLine",
    column: "accountId",
    policy: "repoint-if-parent-status",
    parentTable: "journal",
    parentColumn: "journalId",
    statuses: ["Draft", "Provisional"]
  },
  { table: "accountingPeriodBalance", column: "accountId", policy: "history" },
  { table: "accountingSyncTieOut", column: "accountId", policy: "history" }
];

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

const FIXED_ASSET_CLASS_COLUMN_NAMES: Record<FixedAssetClassColumn, string> = {
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

/** The label of any default accounts key, or the key itself if unknown. */
export function defaultKeyLabel(key: string) {
  if ((ACCOUNT_DEFAULT_COLUMNS as readonly string[]).includes(key)) {
    return ROLE_NAMES[key as AccountDefaultColumn];
  }
  const [prefix, className, column] = key.split(":");
  const isColumn = (FIXED_ASSET_CLASS_COLUMNS as readonly string[]).includes(
    column ?? ""
  );
  return prefix === "asset-class" && className && isColumn
    ? assetClassLabel(className, column as FixedAssetClassColumn)
    : key;
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

/** One row of the customer's chart of accounts. Values are trimmed. */
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
  accountType: AccountType | null;
  incomeBalance: "Balance Sheet" | "Income Statement";
  parentId: string | null;
  isGroup: boolean;
  isSystem: boolean;
  active: boolean;
};

export type AccountUsage = {
  /** Rows a merge moves (documents, Draft or Provisional journal lines). */
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
  accounts: Record<FixedAssetClassColumn, string>;
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
  | {
      code: "class-type-mismatch";
      line: number;
      class: AccountClass;
      accountType: AccountType;
    }
  | { code: "group-class-mismatch"; line: number; group: string }
  | { code: "unknown-default"; line: number; value: string }
  | { code: "duplicate-default"; line: number; firstLine: number; key: string }
  | { code: "default-not-in-chart"; line: number; value: string }
  | { code: "default-missing"; key: string }
  | { code: "migration-clearing-not-equity"; line: number }
  | { code: "account-has-history"; accountId: string }
  | { code: "target-not-in-chart"; accountId: string; line: number };

type ChartChange = {
  line: number;
  number: string;
  name: string;
  class: AccountClass;
  accountType: AccountType;
  group: string;
};

export type AccountImportPlan = {
  /** The Carbon account each kept chart line is. */
  claims: { line: number; accountId: string }[];
  updates: (ChartChange & { accountId: string })[];
  creates: ChartChange[];
  /** A Carbon account that goes into a kept row; its references move. */
  merges: { sourceId: string; targetLine: number }[];
  /** A Carbon account nothing uses, removed outright. */
  deletes: string[];
  /**
   * Every account no file keeps that documents or journals use. The review
   * picks the row each one merges into; `targetLine` is null until it does.
   */
  replacements: {
    accountId: string;
    companyIds: string[];
    targetLine: number | null;
  }[];
  /** Every default role, the same in every company; null clears it. */
  roleMoves: { role: AccountDefaultColumn; toLine: number | null }[];
  /** Every fixed asset class of every company, with all its accounts. */
  assetClassMoves: {
    classId: string;
    companyId: string;
    toLines: Record<FixedAssetClassColumn, number>;
  }[];
  groupCreates: { name: string; class: AccountClass }[];
  companies: { companyId: string; repointedReferences: number }[];
  errors: AccountImportError[];
};

const NO_USAGE: AccountUsage = {
  movableReferencesByCompany: {},
  historyReferences: 0
};

/** Resolve a default accounts file key or label to its canonical key. */
function resolveDefaultKey(
  value: string,
  assetClassNames: readonly string[]
): string | null {
  const wanted = key(value);
  for (const column of ACCOUNT_DEFAULT_COLUMNS) {
    if (key(column) === wanted || key(ROLE_NAMES[column]) === wanted) {
      return column;
    }
  }
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

/** 1. The chart: unique numbers and names. Returns the line of each number. */
function indexChart(rows: ChartImportRow[], errors: AccountImportError[]) {
  const lineByNumber = new Map<string, number>();
  const lineByName = new Map<string, number>();
  for (const row of rows) {
    const firstNumber = lineByNumber.get(key(row.number));
    if (firstNumber !== undefined) {
      errors.push({
        code: "duplicate-number",
        line: row.line,
        firstLine: firstNumber,
        value: row.number
      });
    } else lineByNumber.set(key(row.number), row.line);
    const firstName = lineByName.get(key(row.name));
    if (firstName !== undefined) {
      errors.push({
        code: "duplicate-name",
        line: row.line,
        firstLine: firstName,
        value: row.name
      });
    } else lineByName.set(key(row.name), row.line);
  }
  return lineByNumber;
}

/**
 * 2. The defaults: every key known, once, and every number in the chart.
 * Returns the chart line each key names; null for a key left blank.
 */
function resolveDefaults(
  rows: DefaultImportRow[],
  assetClassNames: readonly string[],
  lineByNumber: Map<string, number>,
  errors: AccountImportError[]
) {
  const targetByKey = new Map<string, number | null>();
  const keyLine = new Map<string, number>();
  for (const row of rows) {
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
    if (row.number === null) {
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
  return targetByKey;
}

/**
 * 3–4. Which Carbon leaf each kept chart line is. The Carbon account behind
 * a default becomes the line the default names; a second Carbon account named
 * onto a claimed line merges into it. Then a leaf whose number is an unclaimed
 * line is that line.
 */
function claimLines(
  ctx: AccountImportContext,
  leafById: Map<string, ChartAccount>,
  targetByKey: Map<string, number | null>,
  lineByNumber: Map<string, number>
) {
  const claimByLine = new Map<number, string>();
  const decided = new Set<string>();
  const merges: AccountImportPlan["merges"] = [];
  const decide = (
    accountId: string | null,
    line: number | null | undefined
  ) => {
    if (!accountId || line === null || line === undefined) return;
    if (decided.has(accountId) || !leafById.has(accountId)) return;
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
  for (const fac of ctx.fixedAssetClasses) {
    if (fac.companyId !== ctx.importingCompanyId) continue;
    for (const column of FIXED_ASSET_CLASS_COLUMNS) {
      decide(
        fac.accounts[column],
        targetByKey.get(assetClassKey(fac.name, column))
      );
    }
  }
  for (const leaf of leafById.values()) {
    if (decided.has(leaf.id) || !leaf.number) continue;
    const line = lineByNumber.get(key(leaf.number));
    if (line === undefined || claimByLine.has(line)) continue;
    decided.add(leaf.id);
    claimByLine.set(line, leaf.id);
  }
  return { claimByLine, decided, merges };
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
    replacements: [],
    roleMoves: [],
    assetClassMoves: [],
    groupCreates: [],
    companies: [],
    errors: []
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
  const leafById = new Map(
    ctx.chart.filter((a) => !a.isGroup && !a.isSystem).map((a) => [a.id, a])
  );
  const groupByName = new Map(
    ctx.chart.filter((a) => a.isGroup).map((g) => [key(g.name), g])
  );
  const rowByLine = new Map(chartRows.map((r) => [r.line, r]));

  const lineByNumber = indexChart(chartRows, errors);
  const assetClassNames = [
    ...new Set(ctx.fixedAssetClasses.map((c) => c.name))
  ];
  const targetByKey = resolveDefaults(
    defaultRows,
    assetClassNames,
    lineByNumber,
    errors
  );
  const { claimByLine, decided, merges } = claimLines(
    ctx,
    leafById,
    targetByKey,
    lineByNumber
  );

  // 5. Every other Carbon leaf goes: deleted when nothing uses it, else
  // merged into the row the review picks.
  for (const leaf of leafById.values()) {
    if (decided.has(leaf.id)) continue;
    const usage = usageOf(leaf.id);
    const companyIds = Object.entries(usage.movableReferencesByCompany)
      .filter(([, count]) => count > 0)
      .map(([companyId]) => companyId)
      .sort();
    if (companyIds.length === 0) {
      plan.deletes.push(leaf.id);
      continue;
    }
    const picked = resolutions.targets[leaf.id];
    const targetLine =
      picked !== undefined && rowByLine.has(picked) ? picked : null;
    if (picked !== undefined && targetLine === null) {
      errors.push({
        code: "target-not-in-chart",
        accountId: leaf.id,
        line: picked
      });
    }
    plan.replacements.push({ accountId: leaf.id, companyIds, targetLine });
    if (targetLine !== null) merges.push({ sourceId: leaf.id, targetLine });
  }
  plan.merges = merges;
  for (const accountId of [...plan.deletes, ...merges.map((m) => m.sourceId)]) {
    if (usageOf(accountId).historyReferences > 0) {
      errors.push({ code: "account-has-history", accountId });
    }
  }

  // 6. Each row's class: its own, its type's, or its claimed account's.
  const classByLine = new Map<number, AccountClass>();
  for (const row of chartRows) {
    const claimed = claimByLine.get(row.line);
    const rowClass =
      row.class ??
      (row.accountType ? classOfAccountType(row.accountType) : null) ??
      (claimed ? (accountById.get(claimed)?.class ?? null) : null);
    if (!rowClass) {
      errors.push({ code: "missing-class", line: row.line });
      continue;
    }
    if (row.accountType && classOfAccountType(row.accountType) !== rowClass) {
      errors.push({
        code: "class-type-mismatch",
        line: row.line,
        class: rowClass,
        accountType: row.accountType
      });
      continue;
    }
    classByLine.set(row.line, rowClass);
  }

  // 7. Kept rows update their account; the rest are created.
  for (const row of chartRows) {
    const rowClass = classByLine.get(row.line);
    if (!rowClass) continue;
    const accountId = claimByLine.get(row.line);
    const account = accountId ? accountById.get(accountId) : undefined;
    // A claimed account keeps its type when the row gives none and the class
    // still fits it.
    const accountType =
      row.accountType ??
      (account?.accountType &&
      classOfAccountType(account.accountType) === rowClass
        ? account.accountType
        : DEFAULT_ACCOUNT_TYPE_BY_CLASS[rowClass]);
    const change: ChartChange = {
      line: row.line,
      number: row.number,
      name: row.name,
      class: rowClass,
      accountType,
      group: row.group
    };
    if (!accountId || !account) {
      plan.creates.push(change);
      continue;
    }
    plan.claims.push({ line: row.line, accountId });
    const currentGroup = account.parentId
      ? (accountById.get(account.parentId)?.name ?? "")
      : "";
    const changed =
      (account.number ?? "") !== row.number ||
      account.name !== row.name ||
      account.class !== rowClass ||
      account.accountType !== accountType ||
      key(currentGroup) !== key(row.group) ||
      !account.active;
    if (changed) plan.updates.push({ ...change, accountId });
  }

  // 8. Defaults and fixed asset classes, for every company of the group.
  plan.roleMoves = ACCOUNT_DEFAULT_COLUMNS.map((role) => ({
    role,
    toLine: targetByKey.get(role) ?? null
  }));
  for (const fac of ctx.fixedAssetClasses) {
    const toLines: Partial<Record<FixedAssetClassColumn, number>> = {};
    for (const column of FIXED_ASSET_CLASS_COLUMNS) {
      const line = targetByKey.get(assetClassKey(fac.name, column));
      if (line !== null && line !== undefined) toLines[column] = line;
    }
    // Every column is required, so a class with a gap is already an error.
    if (Object.keys(toLines).length === FIXED_ASSET_CLASS_COLUMNS.length) {
      plan.assetClassMoves.push({
        classId: fac.id,
        companyId: fac.companyId,
        toLines: toLines as Record<FixedAssetClassColumn, number>
      });
    }
  }

  // 9. Groups, by name: an existing group or a new one holds one class.
  const newGroupClass = new Map<string, AccountClass>();
  for (const row of chartRows) {
    const rowClass = classByLine.get(row.line);
    if (!rowClass) continue;
    const existing = groupByName.get(key(row.group));
    const planned = newGroupClass.get(key(row.group));
    let groupClass = existing ? existing.class : planned;
    if (!existing && planned === undefined) {
      newGroupClass.set(key(row.group), rowClass);
      plan.groupCreates.push({ name: row.group, class: rowClass });
      groupClass = rowClass;
    }
    const fits = groupClass
      ? groupClass === rowClass
      : existing?.incomeBalance === incomeBalanceOf(rowClass);
    if (!fits) {
      errors.push({
        code: "group-class-mismatch",
        line: row.line,
        group: row.group
      });
    }
  }

  // 10. Migration Clearing must be Equity.
  const clearingLine = targetByKey.get("migrationClearingAccount");
  if (
    clearingLine !== null &&
    clearingLine !== undefined &&
    classByLine.has(clearingLine) &&
    classByLine.get(clearingLine) !== MIGRATION_CLEARING_ACCOUNT_CLASS
  ) {
    errors.push({ code: "migration-clearing-not-equity", line: clearingLine });
  }

  // 11. The companies whose documents or journals move.
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
  plan.replacements.sort((a, b) =>
    numberOf(a.accountId).localeCompare(numberOf(b.accountId))
  );
  return plan;
}

/** True when the plan can be applied. */
export function isApplicable(plan: AccountImportPlan): boolean {
  return (
    plan.errors.length === 0 &&
    plan.replacements.every((r) => r.targetLine !== null)
  );
}
