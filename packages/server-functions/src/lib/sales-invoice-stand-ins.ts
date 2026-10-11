// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The stand-in lines of a sales invoice journal
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 1).
//
// Before the cutover an empty optional default becomes a stand-in line on
// Retained Earnings that names the default it wanted (resolveDefaultAccount);
// the enable re-points it. The sales posting builders check an account's
// class, so a stand-in is a placeholder id that resolves to an account of the
// class the default must have, and is swapped for Retained Earnings and its
// role where a row is written. After the cutover an empty default stays
// empty, so the line that needs it refuses as it always has.
//
// A schedule row never takes a stand-in: the deferral, contract and rental
// defaults are required by the posting in every company state, and a default
// with a fallback (DEFAULT_FALLBACKS) uses the fallback. Neither is listed
// here.

import type { Database } from "@carbon/database";
import {
  type AutomaticJournalStatus,
  type OptionalDefaultRole,
  resolveDefaultAccount
} from "@carbon/database/journal-posting-status";
import type { SalesPostingAccount } from "@carbon/utils";

type AccountDefaults = Database["public"]["Tables"]["accountDefault"]["Row"];

/**
 * The optional defaults a sales invoice line may stand in for, with the class
 * each one must have. A stand-in line is signed for that class, so the enable
 * can re-point it without changing its amount.
 */
export const STAND_IN_CLASS = {
  leaseRevenueAccount: "Revenue",
  netInvestmentInLeasesAccount: "Asset",
  salesShippingRevenueAccount: "Revenue"
} as const satisfies Partial<Record<OptionalDefaultRole, string>>;
export type StandInRole = keyof typeof STAND_IN_CLASS;

/** The prefix of a placeholder id. Never an account id: those come from id('…'). */
export const STAND_IN_PREFIX = "stand-in:";

/** The stand-in bookkeeping of one sales invoice posting. */
export function salesInvoiceStandIns(
  defaults: Pick<AccountDefaults, StandInRole | "retainedEarningsAccount">,
  postingStatus: AutomaticJournalStatus
) {
  const roles = new Map<string, StandInRole>();

  /** The account a line takes for `role`: the default when it is set; a
   *  placeholder before the cutover; null after it. */
  const defaultId = (role: StandInRole): string | null => {
    if (defaults[role]) return defaults[role];
    if (postingStatus === "Posted") return null;
    const resolved = resolveDefaultAccount(defaults, role, postingStatus);
    if (!resolved.accountDefaultRole) return resolved.accountId;
    const placeholder = `${STAND_IN_PREFIX}${role}`;
    roles.set(placeholder, role);
    return placeholder;
  };

  const isPlaceholder = (id: string) => roles.has(id);

  /** The account id a row stores: Retained Earnings for a placeholder. */
  const storedAccountId = (id: string) =>
    roles.has(id) ? defaults.retainedEarningsAccount : id;

  /** A journal line as stored: a placeholder becomes Retained Earnings and
   *  the line names the default it stands in for. */
  const storedLine = <T extends { accountId?: string | null }>(line: T) =>
    line.accountId && roles.has(line.accountId)
      ? {
          ...line,
          accountId: defaults.retainedEarningsAccount,
          accountDefaultRole: roles.get(line.accountId)!
        }
      : line;

  /** One account per placeholder, of the class its default must have. */
  const placeholderAccounts = (companyGroupId: string): SalesPostingAccount[] =>
    [...roles].map(([placeholder, role]) => ({
      id: placeholder,
      class: STAND_IN_CLASS[role],
      active: true,
      isGroup: false,
      companyGroupId
    }));

  return {
    defaultId,
    isPlaceholder,
    storedAccountId,
    storedLine,
    placeholderAccounts
  };
}
