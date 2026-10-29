// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export type CompanyCandidate = {
  id: string;
  name: string;
  createdAt: string;
  companyGroupId: string | null;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Companies the weekly cleanup may delete, oldest first: no plan row anywhere in
 * the company's group, older than a week, and not protected.
 *
 * The group is the unit. A paying customer's second company (Settings → New
 * Company) never gets its own `companyPlan` row, and Carbon-owned or bypass-user
 * groups get plan access with no row at all (`getStripeCustomerByCompanyId`), so
 * "this company has no row" alone would delete all three.
 */
export function selectInactiveCompanies({
  companies,
  planCompanyIds,
  protectedCompanyIds,
  protectedGroupIds,
  now,
  limit
}: {
  companies: CompanyCandidate[];
  planCompanyIds: Set<string>;
  protectedCompanyIds: Set<string>;
  protectedGroupIds: Set<string>;
  now: number;
  limit: number;
}): CompanyCandidate[] {
  const payingGroups = new Set(
    companies
      .filter((c) => c.companyGroupId && planCompanyIds.has(c.id))
      .map((c) => c.companyGroupId)
  );
  const cutoff = now - WEEK_MS;

  return companies
    .filter(
      (c) =>
        !planCompanyIds.has(c.id) &&
        !protectedCompanyIds.has(c.id) &&
        !(c.companyGroupId && payingGroups.has(c.companyGroupId)) &&
        !(c.companyGroupId && protectedGroupIds.has(c.companyGroupId)) &&
        Date.parse(c.createdAt) < cutoff
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .slice(0, limit);
}

/**
 * A warning older than this no longer counts, and the company is warned again. A
 * warning that could not be cleared when its company regained a plan therefore
 * cannot qualify it for deletion months later without a fresh email.
 */
const WARNING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What the `inactive-company-warning` marker records. `deleteAfter` is the UTC
 * date (`YYYY-MM-DD`) the email named; nothing is deleted before it.
 */
export type Warning = {
  warnedAt?: string;
  deleteAfter?: string;
  failedAt?: string;
  /** The group owner the email went to; a purge requires the same owner. */
  ownerId?: string;
};

/** Now as an instant (ms) and as today's UTC date (`YYYY-MM-DD`). */
export type Clock = { now: number; today: string };

const liveWarning = (warning: Warning | undefined, { now }: Clock) =>
  warning?.warnedAt !== undefined &&
  Date.parse(warning.warnedAt) > now - WARNING_TTL_MS;

/**
 * The date the owner was told has arrived, and the warning has not expired.
 * `YYYY-MM-DD` strings compare chronologically.
 */
export const isDueForDeletion = (warning: Warning | undefined, clock: Clock) =>
  liveWarning(warning, clock) &&
  warning?.deleteAfter !== undefined &&
  warning.deleteAfter <= clock.today;

/**
 * Split inactive companies (oldest first) by their warning: no live warning →
 * warn now; its `deleteAfter` date reached → delete; otherwise → wait. A company
 * is never deleted without a warning, and each list is capped at `limit`.
 * A company whose last send failed goes after the rest, so a bad address cannot
 * hold the front of the capped list every week.
 */
export function splitByWarning({
  inactive,
  warnings,
  clock,
  limit
}: {
  inactive: CompanyCandidate[];
  warnings: Map<string, Warning>;
  clock: Clock;
  limit: number;
}): { toWarn: CompanyCandidate[]; toDelete: CompanyCandidate[] } {
  const toWarn: CompanyCandidate[] = [];
  const retryWarn: CompanyCandidate[] = [];
  const toDelete: CompanyCandidate[] = [];
  for (const company of inactive) {
    const warning = warnings.get(company.id);
    if (isDueForDeletion(warning, clock)) toDelete.push(company);
    else if (liveWarning(warning, clock)) continue;
    else if (warning?.failedAt) retryWarn.push(company);
    else toWarn.push(company);
  }
  return {
    toWarn: [...toWarn, ...retryWarn].slice(0, limit),
    toDelete: toDelete.slice(0, limit)
  };
}
