// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The status an automatic posting writes, and the account a line takes when
// its account default is empty (.ai/specs/2026-10-08-accounting-cutover.md
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
  const settings = await db
    .selectFrom("companySettings")
    .select("accountingCutoverDate")
    .where("id", "=", companyId)
    .forShare()
    .executeTakeFirst();
  if (!settings) throw new Error("Company settings not found");
  return postingStatusFor(settings.accountingCutoverDate);
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
 * The account for a line that needs an optional default. A set default is
 * used as is. Before the cutover, an empty one becomes a stand-in line on
 * retained earnings that names the default it wanted, which the enable
 * re-points; a Provisional journal counts nowhere, so the stand-in moves no
 * balance. After the cutover an empty default refuses the posting.
 */
export function resolveDefaultAccount(
  defaults: Partial<Record<OptionalDefaultRole, string | null>> & {
    retainedEarningsAccount: string;
  },
  role: OptionalDefaultRole,
  postingStatus: AutomaticJournalStatus
): { accountId: string; accountDefaultRole: OptionalDefaultRole | null } {
  const accountId = defaults[role];
  if (accountId) return { accountId, accountDefaultRole: null };
  if (postingStatus === "Provisional") {
    return {
      accountId: defaults.retainedEarningsAccount,
      accountDefaultRole: role
    };
  }
  throw new Error(`Set the ${role} account default in Accounting → Defaults.`);
}
