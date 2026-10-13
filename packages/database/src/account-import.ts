// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The chart of accounts import (.ai/specs/2026-10-12-chart-of-accounts-import.md).
// The uploaded sheet IS the chart: a row that names a Carbon account renames it
// in place, two names on one row merge, an empty name creates, and an active
// account no row names retires. `planAccountImport` turns the sheet and the
// group's current chart into a plan; it is pure, so the review page and the
// apply server function compute the same plan from the same inputs. The reads
// that build its context live in ./account-import-reads.

import type { AccountDefaultColumn } from "./accounting-cutover/shared.ts";
import { ACCOUNT_DEFAULT_COLUMNS } from "./accounting-cutover/shared.ts";
import { hasDefaultFallback } from "./journal-posting-status.ts";
import type { AccountClass } from "./ledger.ts";
import { equals, round } from "./precision.ts";
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
 * The roles whose account carries a subledger tie-out. Once the account has
 * posted lines the import may rename it, never merge or retire it.
 */
export const CONTROL_ROLES = [
  "receivablesAccount",
  "payablesAccount",
  "rawMaterialsAccount",
  "finishedGoodsAccount",
  "workInProgressAccount",
  "costOfGoodsSoldAccount",
  "goodsReceivedNotInvoicedAccount",
  "retainedEarningsAccount",
  "migrationClearingAccount",
  "intercompanyReceivablesAccount",
  "intercompanyPayablesAccount",
  "bankCashAccount",
  "bankLocalCurrencyAccount",
  "bankForeignCurrencyAccount"
] as const satisfies readonly AccountDefaultColumn[];

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
 * Every foreign key to `account` other than `accountDefault` (moved through
 * role moves) and `account.parentId` (leaves have no children). A merge moves
 * the rows a policy allows; a row it does not move is a history reference and
 * keeps the account, so the account is deactivated rather than deleted. The
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
  ...[
    "assetAccountId",
    "accumulatedDepreciationAccountId",
    "depreciationExpenseAccountId",
    "writeOffAccountId",
    "writeDownAccountId",
    "lossOnDisposalAccountId",
    "gainOnDisposalAccountId"
  ].map(
    (column) =>
      ({ table: "fixedAssetClass", column, policy: "repoint" }) as const
  ),
  { table: "shippingMethod", column: "carrierAccountId", policy: "repoint" },
  { table: "purchaseOrderLine", column: "accountId", policy: "repoint" },
  { table: "salesOrderLine", column: "accountId", policy: "repoint" },
  { table: "supplierQuoteLine", column: "accountId", policy: "repoint" },
  {
    table: "revenueRecognitionSchedule",
    column: "debitAccountId",
    policy: "repoint"
  },
  {
    table: "revenueRecognitionSchedule",
    column: "creditAccountId",
    policy: "repoint"
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

export type AccountImportRow = {
  /** The file line; the header is line 1. */
  line: number;
  number: string;
  name: string;
  class: AccountClass | null;
  accountType: string | null;
  group: string;
  /** Numbers or role names, split on ";" and trimmed. */
  carbonAccounts: string[];
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
  /**
   * Lines on Posted, Reversed or Superseded journals. Blocks a class change and
   * a control-account merge, and forces deactivate instead of delete.
   */
  hasPostedLines: boolean;
  /**
   * Σ amount on Posted and Reversed journals only (GL_JOURNAL_STATUSES), per
   * company, nonzero only. Superseded is excluded: activation replaced those
   * journals with the opening journal, so moving them would count twice.
   */
  reclassBalanceByCompany: Record<string, number>;
  /** Rows REFERENCE_POLICY moves, per company. */
  movableReferencesByCompany: Record<string, number>;
  /** Rows it never moves. */
  historyReferences: number;
};

export type AccountImportCompany = {
  id: string;
  name: string;
  hasCutover: boolean;
};

export type AccountDefaultsRow = Record<AccountDefaultColumn, string | null>;

export type AccountImportContext = {
  /** Active AND inactive accounts of the group, groups included. */
  chart: ChartAccount[];
  companies: AccountImportCompany[];
  defaultsByCompany: Record<string, AccountDefaultsRow>;
  /** By account id. An account with no entry has no usage. */
  usage: Record<string, AccountUsage>;
  importingCompanyId: string;
};

export type AccountImportResolutions = {
  /** Unclaimed account id → the line of the row it merges into. */
  targets: Record<string, number>;
};

export type AccountImportError =
  | { code: "duplicate-number"; line: number; firstLine: number; value: string }
  | { code: "duplicate-name"; line: number; firstLine: number; value: string }
  | { code: "unknown-carbon-account"; line: number; value: string }
  | {
      code: "carbon-account-claimed-twice";
      line: number;
      firstLine: number;
      accountId: string;
    }
  | { code: "class-mismatch"; line: number; accountId: string }
  | { code: "missing-class"; line: number }
  | { code: "invalid-type"; line: number; value: string }
  | { code: "class-change-with-history"; line: number; accountId: string }
  | {
      code: "control-account-with-history";
      accountId: string;
      role: AccountDefaultColumn;
    }
  | { code: "migration-clearing-not-equity"; line: number }
  | {
      code: "taken-by-inactive-account";
      line: number;
      field: "number" | "name";
      accountId: string;
      retiredByThisImport: boolean;
    }
  | { code: "group-class-mismatch"; line: number; group: string }
  | { code: "target-not-in-sheet"; accountId: string; line: number };

export type AccountNeedsTargetReason =
  | "references"
  | "required-role"
  | "balance";

export type AccountImportException = {
  code: "account-needs-target";
  accountId: string;
  reasons: AccountNeedsTargetReason[];
  companyIds: string[];
};

export type AccountImportPlan = {
  /** The Carbon account each row keeps (its first `Carbon Account`). */
  claims: { line: number; accountId: string }[];
  renames: {
    accountId: string;
    line: number;
    number: string;
    name: string;
    class: AccountClass;
    accountType: AccountType;
    group: string;
    reactivate: boolean;
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
  retires: { accountId: string; mode: "delete" | "deactivate" }[];
  /** `toLine` null clears the role (it has a fallback). */
  roleMoves: {
    companyId: string;
    role: AccountDefaultColumn;
    fromAccountId: string;
    toLine: number | null;
  }[];
  reclasses: {
    companyId: string;
    sourceId: string;
    targetLine: number;
    amount: number;
  }[];
  groupCreates: { name: string; class: AccountClass }[];
  companies: {
    companyId: string;
    repointedReferences: number;
    roleMoves: number;
    reclasses: number;
  }[];
  errors: AccountImportError[];
  exceptions: AccountImportException[];
};

const NO_USAGE: AccountUsage = {
  hasPostedLines: false,
  reclassBalanceByCompany: {},
  movableReferencesByCompany: {},
  historyReferences: 0
};

const key = (value: string) => value.trim().toLowerCase();

const isAccountType = (value: string): value is AccountType =>
  (ACCOUNT_TYPES as readonly string[]).includes(value);

/** Resolve one `Carbon Account` value to a leaf account id. */
function resolveCarbonAccount(
  value: string,
  leafByNumber: Map<string, ChartAccount>,
  defaults: AccountDefaultsRow | undefined
): string | null {
  const byNumber = leafByNumber.get(value.trim());
  if (byNumber) return byNumber.id;
  const wanted = key(value);
  let role: AccountDefaultColumn | undefined = ROLE_ALIASES[wanted];
  if (!role) {
    for (const column of ACCOUNT_DEFAULT_COLUMNS) {
      if (key(ROLE_NAMES[column]) === wanted || key(column) === wanted) {
        role = column;
        break;
      }
    }
  }
  if (!role || !defaults) return null;
  return defaults[role] ?? null;
}

export function planAccountImport(
  rows: AccountImportRow[],
  ctx: AccountImportContext,
  resolutions: AccountImportResolutions
): AccountImportPlan {
  const errors: AccountImportError[] = [];
  const exceptions: AccountImportException[] = [];
  const usageOf = (id: string) => ctx.usage[id] ?? NO_USAGE;

  const accountById = new Map(ctx.chart.map((a) => [a.id, a]));
  const leaves = ctx.chart.filter((a) => !a.isGroup);
  const groups = ctx.chart.filter((a) => a.isGroup);
  const leafByNumber = new Map<string, ChartAccount>();
  for (const leaf of leaves) {
    if (leaf.number) leafByNumber.set(leaf.number.trim(), leaf);
  }
  const groupByName = new Map(groups.map((g) => [key(g.name), g]));
  const rowByLine = new Map(rows.map((r) => [r.line, r]));
  const companyIds = ctx.companies.map((c) => c.id);
  const importingDefaults = ctx.defaultsByCompany[ctx.importingCompanyId];
  const required = new Set<string>(requiredRoles());

  /** Every (company, role) pair that points at an account. */
  const rolesOf = (accountId: string) => {
    const found: { companyId: string; role: AccountDefaultColumn }[] = [];
    for (const companyId of companyIds) {
      const defaults = ctx.defaultsByCompany[companyId];
      if (!defaults) continue;
      for (const role of ACCOUNT_DEFAULT_COLUMNS) {
        if (defaults[role] === accountId) found.push({ companyId, role });
      }
    }
    return found;
  };

  // 1. Row validation.
  const firstLineByNumber = new Map<string, number>();
  const firstLineByName = new Map<string, number>();
  for (const row of rows) {
    const numberKey = key(row.number);
    const nameKey = key(row.name);
    const numberSeen = firstLineByNumber.get(numberKey);
    if (numberSeen !== undefined) {
      errors.push({
        code: "duplicate-number",
        line: row.line,
        firstLine: numberSeen,
        value: row.number
      });
    } else firstLineByNumber.set(numberKey, row.line);
    const nameSeen = firstLineByName.get(nameKey);
    if (nameSeen !== undefined) {
      errors.push({
        code: "duplicate-name",
        line: row.line,
        firstLine: nameSeen,
        value: row.name
      });
    } else firstLineByName.set(nameKey, row.line);
    if (row.carbonAccounts.length === 0 && !row.class) {
      errors.push({ code: "missing-class", line: row.line });
    }
    if (row.accountType && !isAccountType(row.accountType)) {
      errors.push({
        code: "invalid-type",
        line: row.line,
        value: row.accountType
      });
    }
  }

  // 2–3. Resolve and claim.
  const claimsByLine = new Map<number, string[]>();
  const claimedBy = new Map<string, number>();
  for (const row of rows) {
    const claims: string[] = [];
    for (const value of row.carbonAccounts) {
      const id = resolveCarbonAccount(value, leafByNumber, importingDefaults);
      if (!id || !accountById.has(id)) {
        errors.push({ code: "unknown-carbon-account", line: row.line, value });
        continue;
      }
      if (claims.includes(id)) continue;
      const firstLine = claimedBy.get(id);
      if (firstLine !== undefined) {
        errors.push({
          code: "carbon-account-claimed-twice",
          line: row.line,
          firstLine,
          accountId: id
        });
        continue;
      }
      claimedBy.set(id, row.line);
      claims.push(id);
    }
    claimsByLine.set(row.line, claims);
  }

  /** The class a row ends with. */
  const rowClass = (row: AccountImportRow): AccountClass | null => {
    if (row.class) return row.class;
    const first = claimsByLine.get(row.line)?.[0];
    return first ? (accountById.get(first)?.class ?? null) : null;
  };

  // 4–5. Renames, creates, explicit merges, class checks.
  const claims: AccountImportPlan["claims"] = [];
  const renames: AccountImportPlan["renames"] = [];
  const creates: AccountImportPlan["creates"] = [];
  const merges: AccountImportPlan["merges"] = [];
  for (const row of rows) {
    const rowClaims = claimsByLine.get(row.line) ?? [];
    const finalClass = rowClass(row);
    if (rowClaims.length === 0) {
      if (!finalClass) continue;
      creates.push({
        line: row.line,
        number: row.number.trim(),
        name: row.name.trim(),
        class: finalClass,
        accountType:
          row.accountType && isAccountType(row.accountType)
            ? row.accountType
            : DEFAULT_ACCOUNT_TYPE_BY_CLASS[finalClass],
        group: row.group.trim()
      });
      continue;
    }
    const [targetId, ...sourceIds] = rowClaims;
    const target = accountById.get(targetId!)!;
    claims.push({ line: row.line, accountId: target.id });
    if (finalClass && target.class && finalClass !== target.class) {
      if (usageOf(target.id).hasPostedLines) {
        errors.push({
          code: "class-change-with-history",
          line: row.line,
          accountId: target.id
        });
      } else if (rolesOf(target.id).length > 0) {
        errors.push({
          code: "class-mismatch",
          line: row.line,
          accountId: target.id
        });
      }
    }
    const accountType =
      row.accountType && isAccountType(row.accountType)
        ? row.accountType
        : target.accountType && isAccountType(target.accountType)
          ? target.accountType
          : DEFAULT_ACCOUNT_TYPE_BY_CLASS[finalClass ?? "Asset"];
    const currentGroup = target.parentId
      ? (accountById.get(target.parentId)?.name ?? "")
      : "";
    const changed =
      (target.number ?? "") !== row.number.trim() ||
      target.name !== row.name.trim() ||
      key(currentGroup) !== key(row.group) ||
      (target.accountType ?? "") !== accountType ||
      (finalClass !== null && finalClass !== target.class) ||
      !target.active;
    if (changed && finalClass) {
      renames.push({
        accountId: target.id,
        line: row.line,
        number: row.number.trim(),
        name: row.name.trim(),
        class: finalClass,
        accountType,
        group: row.group.trim(),
        reactivate: !target.active
      });
    }
    for (const sourceId of sourceIds) {
      merges.push({ sourceId, targetLine: row.line });
    }
  }

  // 6–7. Unclaimed active leaves: a target, an exception, or a plain retire.
  const roleMoves: AccountImportPlan["roleMoves"] = [];
  const retireIds: string[] = [];
  for (const leaf of leaves) {
    if (!leaf.active || leaf.isSystem || claimedBy.has(leaf.id)) continue;
    const usage = usageOf(leaf.id);
    const roles = rolesOf(leaf.id);
    const reasons: AccountNeedsTargetReason[] = [];
    const involved = new Set<string>();
    for (const [companyId, count] of Object.entries(
      usage.movableReferencesByCompany
    )) {
      if (count > 0) involved.add(companyId);
    }
    if (involved.size > 0) reasons.push("references");
    const requiredRoleCompanies = roles.filter((r) => required.has(r.role));
    if (requiredRoleCompanies.length > 0) {
      reasons.push("required-role");
      for (const r of requiredRoleCompanies) involved.add(r.companyId);
    }
    const balances = Object.entries(usage.reclassBalanceByCompany).filter(
      ([, amount]) => !equals(round(amount), 0)
    );
    if (balances.length > 0) {
      reasons.push("balance");
      for (const [companyId] of balances) involved.add(companyId);
    }

    if (reasons.length === 0) {
      for (const { companyId, role } of roles) {
        roleMoves.push({
          companyId,
          role,
          fromAccountId: leaf.id,
          toLine: null
        });
      }
      retireIds.push(leaf.id);
      continue;
    }
    const targetLine = resolutions.targets[leaf.id];
    if (targetLine === undefined) {
      exceptions.push({
        code: "account-needs-target",
        accountId: leaf.id,
        reasons,
        companyIds: [...involved].sort()
      });
      continue;
    }
    if (!rowByLine.has(targetLine)) {
      errors.push({
        code: "target-not-in-sheet",
        accountId: leaf.id,
        line: targetLine
      });
      continue;
    }
    merges.push({ sourceId: leaf.id, targetLine });
  }

  // 8–10. Merges: class, roles, control accounts, reclasses.
  const reclasses: AccountImportPlan["reclasses"] = [];
  for (const merge of merges) {
    const source = accountById.get(merge.sourceId)!;
    const targetRow = rowByLine.get(merge.targetLine)!;
    const targetClass = rowClass(targetRow);
    if (source.class && targetClass && source.class !== targetClass) {
      errors.push({
        code: "class-mismatch",
        line: merge.targetLine,
        accountId: source.id
      });
    }
    for (const { companyId, role } of rolesOf(source.id)) {
      roleMoves.push({
        companyId,
        role,
        fromAccountId: source.id,
        toLine: merge.targetLine
      });
    }
    for (const [companyId, amount] of Object.entries(
      usageOf(source.id).reclassBalanceByCompany
    )) {
      const rounded = round(amount);
      if (equals(rounded, 0)) continue;
      reclasses.push({
        companyId,
        sourceId: source.id,
        targetLine: merge.targetLine,
        amount: rounded
      });
    }
    retireIds.push(source.id);
  }

  // Control accounts with posted lines cannot merge or retire.
  for (const id of retireIds) {
    if (!usageOf(id).hasPostedLines) continue;
    const control = rolesOf(id).find((r) =>
      (CONTROL_ROLES as readonly string[]).includes(r.role)
    );
    if (control) {
      errors.push({
        code: "control-account-with-history",
        accountId: id,
        role: control.role
      });
    }
  }

  // 11. Retires.
  const retires: AccountImportPlan["retires"] = retireIds.map((accountId) => {
    const usage = usageOf(accountId);
    return {
      accountId,
      mode:
        usage.historyReferences > 0 || usage.hasPostedLines
          ? "deactivate"
          : "delete"
    };
  });

  // 12. Numbers and names held by inactive accounts.
  const takenNumbers = new Map<
    string,
    { accountId: string; retired: boolean }
  >();
  const takenNames = new Map<string, { accountId: string; retired: boolean }>();
  const hold = (account: ChartAccount, retired: boolean) => {
    if (account.number) {
      takenNumbers.set(key(account.number), { accountId: account.id, retired });
    }
    takenNames.set(key(account.name), { accountId: account.id, retired });
  };
  for (const leaf of leaves) {
    if (!leaf.active && !claimedBy.has(leaf.id)) hold(leaf, false);
  }
  for (const retire of retires) {
    if (retire.mode === "deactivate")
      hold(accountById.get(retire.accountId)!, true);
  }
  for (const row of rows) {
    const byNumber = takenNumbers.get(key(row.number));
    if (byNumber) {
      errors.push({
        code: "taken-by-inactive-account",
        line: row.line,
        field: "number",
        accountId: byNumber.accountId,
        retiredByThisImport: byNumber.retired
      });
    }
    const byName = takenNames.get(key(row.name));
    if (byName) {
      errors.push({
        code: "taken-by-inactive-account",
        line: row.line,
        field: "name",
        accountId: byName.accountId,
        retiredByThisImport: byName.retired
      });
    }
  }

  // 13. Groups.
  const groupCreates: AccountImportPlan["groupCreates"] = [];
  const newGroupClass = new Map<string, AccountClass>();
  for (const row of rows) {
    const finalClass = rowClass(row);
    if (!finalClass) continue;
    const existing = groupByName.get(key(row.group));
    if (existing) {
      if (existing.class && existing.class !== finalClass) {
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
      newGroupClass.set(key(row.group), finalClass);
      groupCreates.push({ name: row.group.trim(), class: finalClass });
    } else if (planned !== finalClass) {
      errors.push({
        code: "group-class-mismatch",
        line: row.line,
        group: row.group
      });
    }
  }

  // 14. Migration Clearing ends on an Equity row.
  const clearingId = importingDefaults?.migrationClearingAccount ?? null;
  if (clearingId) {
    const line =
      claimedBy.get(clearingId) ??
      merges.find((m) => m.sourceId === clearingId)?.targetLine;
    const row = line === undefined ? undefined : rowByLine.get(line);
    if (row && rowClass(row) !== "Equity") {
      errors.push({ code: "migration-clearing-not-equity", line: row.line });
    }
  }

  // 15. The companies the import touches.
  const companies: AccountImportPlan["companies"] = [];
  for (const companyId of companyIds) {
    let repointedReferences = 0;
    for (const merge of merges) {
      repointedReferences +=
        usageOf(merge.sourceId).movableReferencesByCompany[companyId] ?? 0;
    }
    const moves = roleMoves.filter((m) => m.companyId === companyId).length;
    const journals = reclasses.filter((r) => r.companyId === companyId).length;
    if (repointedReferences + moves + journals > 0) {
      companies.push({
        companyId,
        repointedReferences,
        roleMoves: moves,
        reclasses: journals
      });
    }
  }

  const numberOf = (id: string) => accountById.get(id)?.number ?? "";
  const byAccount = (a: string, b: string) =>
    numberOf(a).localeCompare(numberOf(b));
  return {
    claims,
    renames: renames.sort((a, b) => a.line - b.line),
    creates: creates.sort((a, b) => a.line - b.line),
    merges: merges.sort(
      (a, b) => a.targetLine - b.targetLine || byAccount(a.sourceId, b.sourceId)
    ),
    retires: retires.sort((a, b) => byAccount(a.accountId, b.accountId)),
    roleMoves: roleMoves.sort(
      (a, b) =>
        a.companyId.localeCompare(b.companyId) || a.role.localeCompare(b.role)
    ),
    reclasses: reclasses.sort(
      (a, b) =>
        a.companyId.localeCompare(b.companyId) ||
        byAccount(a.sourceId, b.sourceId)
    ),
    groupCreates,
    companies,
    errors,
    exceptions: exceptions.sort((a, b) => byAccount(a.accountId, b.accountId))
  };
}

/** True when the plan can be applied. */
export function isApplicable(plan: AccountImportPlan): boolean {
  return plan.errors.length === 0 && plan.exceptions.length === 0;
}
