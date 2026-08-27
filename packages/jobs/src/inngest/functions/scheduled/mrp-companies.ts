/**
 * Which companies a scheduled MRP run should plan for.
 *
 * Kept free of Inngest and Supabase imports so it can be unit-tested directly,
 * the same way the workflow core in `src/workflows/` is.
 *
 * The rule that matters: a company with NO `companyPlan` row still runs. MRP is
 * not a paid feature, and the scheduler used to build its work list straight
 * from `companyPlan` — so every self-hosted, community and local-dev install,
 * where that table is always empty, silently never ran MRP at all.
 */
export function selectCompaniesForMrp<T extends { id: string }>(
  companies: T[],
  /**
   * Cloud subscription rows, or `null` when there are none to consider — not
   * Cloud, or the lookup failed. `null` means "plan for everyone": doing MRP for
   * a cancelled company wastes a little work, doing it for nobody is the bug.
   */
  plans: { id: string; stripeSubscriptionStatus: string | null }[] | null
): T[] {
  if (!plans) return companies;

  // Only "Canceled" is excluded: that is the status the weekly job deletes on,
  // so the company is on its way out. "Inactive" (e.g. payment past due) still
  // plans.
  const cancelled = new Set(
    plans
      .filter((plan) => plan.stripeSubscriptionStatus === "Canceled")
      .map((plan) => plan.id)
  );

  return companies.filter((company) => !cancelled.has(company.id));
}
