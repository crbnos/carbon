// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The status an automatic posting writes, and the account a line takes when
// its account default is empty (.ai/specs/implemented/2026-10-08-accounting-cutover.md
// section 1). Server-only: it reads the database. The status lists live in
// ./accounting-posting, which client bundles import.

import type { Kysely, Transaction } from "kysely";
import type { KyselyDatabase } from "./client";

export type AutomaticJournalStatus = "Provisional" | "Posted";

/** Before the company's cutover a posting is Provisional; after it, Posted. */
export function postingStatusFor(
  cutoverDate: string | null | undefined
): AutomaticJournalStatus {
  return cutoverDate ? "Posted" : "Provisional";
}

/**
 * Reads the company's cutover with FOR SHARE. Call it inside the posting
 * transaction: the enable takes FOR UPDATE on the same row, so no posting can
 * write a Provisional journal after the enable commits.
 */
export async function journalPostingStatus(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  companyId: string
): Promise<AutomaticJournalStatus> {
  return postingStatusFor(await readAccountingCutoverDate(db, companyId));
}

/**
 * The company's cutover date, or null before the enable. Reads with FOR
 * SHARE, as `journalPostingStatus` does.
 */
export async function readAccountingCutoverDate(
  db: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  companyId: string
): Promise<string | null> {
  const settings = await db
    .selectFrom("companySettings")
    .select("accountingCutoverDate")
    .where("id", "=", companyId)
    .forShare()
    .executeTakeFirst();
  if (!settings) throw new Error("Company settings not found");
  return settings.accountingCutoverDate;
}

/** A posting read one status before its transaction and another inside it. */
export const POSTING_STATUS_CHANGED_ERROR =
  "Accounting was just set up. Post the document again.";

/**
 * Reads the status again inside the posting transaction, where FOR SHARE
 * holds it until commit, and refuses when it differs from the status the
 * function read before the transaction (and resolved its period for).
 */
export async function assertPostingStatusUnchanged(
  trx: Kysely<KyselyDatabase> | Transaction<KyselyDatabase>,
  companyId: string,
  expected: AutomaticJournalStatus
): Promise<void> {
  if ((await journalPostingStatus(trx, companyId)) !== expected) {
    throw new Error(POSTING_STATUS_CHANGED_ERROR);
  }
}

/** The nullable account defaults a posting may find empty. */
export const OPTIONAL_DEFAULT_ROLES = [
  "contractAssetAccount",
  "deferredRevenueAccount",
  "deferredTaxExpenseAccountId",
  "deferredTaxLiabilityAccountId",
  "employeeReimbursementsPayableAccount",
  "intercompanyPayablesAccount",
  "intercompanyReceivablesAccount",
  "laborAbsorptionAccount",
  "leaseInterestIncomeAccount",
  "leaseRevenueAccount",
  "netInvestmentInLeasesAccount",
  "overheadAbsorptionAccount",
  "rentalIncomeAccount",
  "salesReturnsAccount",
  "salesShippingRevenueAccount",
  "scrapAccount",
  "migrationClearingAccount"
] as const;
export type OptionalDefaultRole = (typeof OPTIONAL_DEFAULT_ROLES)[number];

/**
 * The optional defaults that fall back to a required default when empty, in
 * every company state. A posting never writes a stand-in for them, and the
 * enable does not require them.
 */
export const DEFAULT_FALLBACKS = {
  employeeReimbursementsPayableAccount: "payablesAccount",
  intercompanyPayablesAccount: "payablesAccount",
  intercompanyReceivablesAccount: "receivablesAccount",
  salesReturnsAccount: "salesAccount",
  scrapAccount: "inventoryAdjustmentVarianceAccount"
} as const satisfies Partial<Record<OptionalDefaultRole, string>>;
type FallbackRole = keyof typeof DEFAULT_FALLBACKS;

/** Does an empty `role` fall back to another default? */
export function hasDefaultFallback(role: string): role is FallbackRole {
  return role in DEFAULT_FALLBACKS;
}

/**
 * The name of each optional default as the Default Accounts page shows it.
 * Plain English: the ERP translates its own UI, and this text reaches the
 * user only in an error message.
 */
export const OPTIONAL_DEFAULT_LABELS: Record<OptionalDefaultRole, string> = {
  contractAssetAccount: "Contract Assets",
  deferredRevenueAccount: "Deferred Revenue",
  deferredTaxExpenseAccountId: "Deferred Tax Expense",
  deferredTaxLiabilityAccountId: "Deferred Tax Liability",
  employeeReimbursementsPayableAccount: "Employee Reimbursements Payable",
  intercompanyPayablesAccount: "Intercompany Payables",
  intercompanyReceivablesAccount: "Intercompany Receivables",
  laborAbsorptionAccount: "Labor & Machine Absorption",
  leaseInterestIncomeAccount: "Interest Income – Leases",
  leaseRevenueAccount: "Lease Revenue",
  netInvestmentInLeasesAccount: "Net Investment in Leases",
  overheadAbsorptionAccount: "Overhead Absorption",
  rentalIncomeAccount: "Rental Income",
  salesReturnsAccount: "Sales Returns",
  salesShippingRevenueAccount: "Shipping Revenue",
  scrapAccount: "Scrap / Cost of Quality",
  migrationClearingAccount: "Migration Clearing"
};

/** "Set the Deferred Revenue account in Accounting → Default Accounts." */
export function missingDefaultMessage(role: OptionalDefaultRole): string {
  return `Set the ${OPTIONAL_DEFAULT_LABELS[role]} account in Accounting → Default Accounts.`;
}

/**
 * A posting needs an account default that is empty. `status` 400: the user
 * fixes it in the account defaults, so it is a refusal, not a server failure
 * (`toServerFnError` reads `status`).
 */
export class MissingAccountDefaultError extends Error {
  readonly status = 400;
  readonly role: OptionalDefaultRole;

  constructor(role: OptionalDefaultRole) {
    super(missingDefaultMessage(role));
    this.name = "MissingAccountDefaultError";
    this.role = role;
  }
}

/** The defaults `resolveDefaultAccount` reads for `role`: the role itself,
 *  retained earnings, and the fallback when the role has one. */
export type DefaultsFor<R extends OptionalDefaultRole> = Partial<
  Record<R, string | null>
> & { retainedEarningsAccount: string } & (R extends FallbackRole
    ? Record<(typeof DEFAULT_FALLBACKS)[R], string>
    : unknown);

/**
 * The account a default resolves to without a stand-in: the default when it
 * is set, else its fallback, else null.
 */
export function configuredDefaultAccount<R extends OptionalDefaultRole>(
  defaults: DefaultsFor<R>,
  role: R
): string | null {
  const accountId = (defaults as Partial<Record<string, string | null>>)[role];
  if (accountId) return accountId;
  if (hasDefaultFallback(role)) {
    return (
      (defaults as Partial<Record<string, string | null>>)[
        DEFAULT_FALLBACKS[role]
      ] ?? null
    );
  }
  return null;
}

/**
 * The account for a line that needs an optional default. A set default is
 * used as is, and an empty one with a fallback (DEFAULT_FALLBACKS) uses the
 * fallback, in every company state. Before the cutover, an empty default
 * with no fallback becomes a stand-in line on retained earnings that names
 * the default it wanted, which the enable re-points; a Provisional journal
 * counts nowhere, so the stand-in moves no balance. After the cutover it
 * refuses the posting.
 */
export function resolveDefaultAccount<R extends OptionalDefaultRole>(
  defaults: DefaultsFor<R>,
  role: R,
  postingStatus: AutomaticJournalStatus
): { accountId: string; accountDefaultRole: OptionalDefaultRole | null } {
  const accountId = configuredDefaultAccount(defaults, role);
  if (accountId) return { accountId, accountDefaultRole: null };
  if (postingStatus === "Provisional") {
    return {
      accountId: defaults.retainedEarningsAccount,
      accountDefaultRole: role
    };
  }
  throw new MissingAccountDefaultError(role);
}
