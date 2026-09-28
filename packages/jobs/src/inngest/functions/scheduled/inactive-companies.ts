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
 * A warning must be at least this old before the company is deleted. Six days,
 * not seven: warnings are stamped a few minutes into a weekly run, so a seven-day
 * cutoff would miss the next run by those minutes and delete a week late.
 */
const NOTICE_MS = 6 * 24 * 60 * 60 * 1000;

/**
 * Split inactive companies (oldest first) by their warning: never warned → warn
 * now; warned at least `NOTICE_MS` ago → delete; warned since → wait. A company
 * is never deleted without a warning, and each list is capped at `limit`.
 */
export function splitByWarning({
  inactive,
  warnedAt,
  now,
  limit
}: {
  inactive: CompanyCandidate[];
  warnedAt: Map<string, string>;
  now: number;
  limit: number;
}): { toWarn: CompanyCandidate[]; toDelete: CompanyCandidate[] } {
  const toWarn: CompanyCandidate[] = [];
  const toDelete: CompanyCandidate[] = [];
  for (const company of inactive) {
    const at = warnedAt.get(company.id);
    if (at === undefined) toWarn.push(company);
    else if (Date.parse(at) <= now - NOTICE_MS) toDelete.push(company);
  }
  return { toWarn: toWarn.slice(0, limit), toDelete: toDelete.slice(0, limit) };
}
