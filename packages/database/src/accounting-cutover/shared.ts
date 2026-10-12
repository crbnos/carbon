// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What every cutover read shares: the handle type, the company and its
// account defaults, account classes, and the guard of the writes made before
// the enable. Server-only.

import type { Kysely, Selectable, Transaction } from "kysely";
import type { AccountClass } from "../accounting-cutover";
import type { KyselyDatabase } from "../client";
import { readAccountingCutoverDate } from "../journal-posting-status";
import { isAccountClass } from "../ledger";

export type CutoverDb = Kysely<KyselyDatabase> | Transaction<KyselyDatabase>;

export type CutoverArgs = { companyId: string; cutoverDate: string };

export const ACCOUNTING_ALREADY_SET_UP = "Accounting is already set up.";

export const OPENING_BALANCE_SOURCE = "Opening Balance" as const;

export async function withTransaction<T>(
  db: CutoverDb,
  fn: (trx: Transaction<KyselyDatabase>) => Promise<T>
): Promise<T> {
  if (db.isTransaction) return fn(db as Transaction<KyselyDatabase>);
  return db.transaction().execute(fn);
}

export async function getCompany(db: CutoverDb, companyId: string) {
  const company = await db
    .selectFrom("company")
    .select(["id", "name", "companyGroupId", "baseCurrencyCode"])
    .where("id", "=", companyId)
    .executeTakeFirst();
  if (!company?.companyGroupId) throw new Error("Company not found");
  return { ...company, companyGroupId: company.companyGroupId };
}

export type CutoverCompany = Awaited<ReturnType<typeof getCompany>>;

export type AccountDefaults = Selectable<KyselyDatabase["accountDefault"]>;

export async function getAccountDefaults(
  db: CutoverDb,
  companyId: string
): Promise<AccountDefaults> {
  const defaults = await db
    .selectFrom("accountDefault")
    .selectAll()
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!defaults) throw new Error("Account defaults are not set up");
  return defaults;
}

/**
 * The account columns of `accountDefault`: every one the readiness check
 * requires set to an active account. Listed, not derived from the row, so a
 * new non-account column cannot become a required default; the type below
 * fails the build when a column of the table is in neither this list nor
 * the keys.
 */
export const ACCOUNT_DEFAULT_COLUMNS = [
  "salesAccount",
  "salesDiscountAccount",
  "costOfGoodsSoldAccount",
  "purchaseVarianceAccount",
  "inventoryAdjustmentVarianceAccount",
  "materialVarianceAccount",
  "laborAndMachineVarianceAccount",
  "indirectCostAccount",
  "maintenanceAccount",
  "assetDepreciationExpenseAccount",
  "serviceChargeAccount",
  "interestAccount",
  "supplierPaymentDiscountAccount",
  "customerPaymentDiscountAccount",
  "roundingAccount",
  "assetAquisitionCostAccount",
  "assetAquisitionCostOnDisposalAccount",
  "accumulatedDepreciationAccount",
  "accumulatedDepreciationOnDisposalAccount",
  "workInProgressAccount",
  "receivablesAccount",
  "bankCashAccount",
  "bankLocalCurrencyAccount",
  "bankForeignCurrencyAccount",
  "prepaymentAccount",
  "payablesAccount",
  "salesTaxPayableAccount",
  "purchaseTaxPayableAccount",
  "reverseChargeSalesTaxPayableAccount",
  "retainedEarningsAccount",
  "goodsReceivedNotInvoicedAccount",
  "overheadVarianceAccount",
  "lotSizeVarianceAccount",
  "subcontractingVarianceAccount",
  "currencyTranslationAccount",
  "laborAbsorptionAccount",
  "deferredTaxLiabilityAccountId",
  "deferredTaxExpenseAccountId",
  "customerWriteOffAccount",
  "supplierWriteOffAccount",
  "realizedExchangeGainAccount",
  "realizedExchangeLossAccount",
  "intercompanyReceivablesAccount",
  "overheadAbsorptionAccount",
  "supplierPrepaymentAccount",
  "rawMaterialsAccount",
  "finishedGoodsAccount",
  "assetGainOnDisposalAccount",
  "assetLossOnDisposalAccount",
  "scrapAccount",
  "intercompanyPayablesAccount",
  "salesShippingRevenueAccount",
  "salesReturnsAccount",
  "employeeReimbursementsPayableAccount",
  "deferredRevenueAccount",
  "contractAssetAccount",
  "rentalIncomeAccount",
  "leaseRevenueAccount",
  "leaseInterestIncomeAccount",
  "netInvestmentInLeasesAccount",
  "migrationClearingAccount"
] as const satisfies readonly (keyof AccountDefaults)[];

export type AccountDefaultColumn = (typeof ACCOUNT_DEFAULT_COLUMNS)[number];

/** The `accountDefault` columns that are not accounts. */
type AccountDefaultKey = "companyId" | "updatedBy";

/** Accepts only `never`: a type argument that is not fails the build. */
type Never<T extends never> = T;

/**
 * Every `accountDefault` column the two lists miss. It must be `never`: a new
 * column of the table that is in neither list fails the build here.
 */
export type UnlistedAccountDefaultColumn = Never<
  Exclude<keyof AccountDefaults, AccountDefaultKey | AccountDefaultColumn>
>;

export type CutoverAccount = {
  id: string;
  class: string | null;
  active: boolean;
  isGroup: boolean;
  name: string;
};

/** Accounts of the company group by id, with their class. One query. */
export async function getAccounts(
  db: CutoverDb,
  companyGroupId: string,
  accountIds: Iterable<string>
): Promise<Map<string, CutoverAccount>> {
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom("account")
    .select(["id", "class", "active", "isGroup", "name"])
    .where("companyGroupId", "=", companyGroupId)
    .where("id", "in", ids)
    .execute();
  return new Map(rows.map((row) => [row.id, row]));
}

export function requireClass(
  accounts: ReadonlyMap<string, CutoverAccount>,
  accountId: string
): AccountClass {
  const accountClass = accounts.get(accountId)?.class ?? null;
  if (!isAccountClass(accountClass)) {
    throw new Error(`Account ${accountId} has no account class`);
  }
  return accountClass;
}

export function addTo(
  map: Map<string, number>,
  key: string | null,
  value: number
) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + value);
}

/**
 * Refuses a write made before the enable once the company has a cutover.
 * Reads the cutover FOR SHARE, so a write that passes commits before the
 * enable (which takes FOR UPDATE on the same row) can promote anything.
 */
export async function refuseAfterCutover(
  db: Transaction<KyselyDatabase>,
  companyId: string
) {
  if (await readAccountingCutoverDate(db, companyId)) {
    throw new Error(ACCOUNTING_ALREADY_SET_UP);
  }
}

/** The company and its account defaults, read once per request. */
export type CutoverContext = CutoverArgs & {
  company: CutoverCompany;
  defaults: AccountDefaults;
};

export async function loadCutoverContext(
  db: CutoverDb,
  { companyId, cutoverDate }: CutoverArgs
): Promise<CutoverContext> {
  const [company, defaults] = await Promise.all([
    getCompany(db, companyId),
    getAccountDefaults(db, companyId)
  ]);
  return { companyId, cutoverDate, company, defaults };
}
