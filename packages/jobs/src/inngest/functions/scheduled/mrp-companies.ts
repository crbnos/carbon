/**
 * Which companies a scheduled MRP run should plan for. A company with no
 * `companyPlan` row still runs — MRP is not a paid feature.
 *
 * `plans` is null when there are none to consider (not Cloud, or the lookup
 * failed), which means plan for everyone: planning for a cancelled company
 * wastes a little work, planning for nobody is the bug this function exists for.
 */
export function selectCompaniesForMrp<T extends { id: string }>(
  companies: T[],
  plans: { id: string; stripeSubscriptionStatus: string | null }[] | null
): T[] {
  if (!plans) return companies;

  // Only "Canceled" — the status the weekly job deletes on. "Inactive" (e.g.
  // payment past due) still plans.
  const cancelled = new Set(
    plans
      .filter((plan) => plan.stripeSubscriptionStatus === "Canceled")
      .map((plan) => plan.id)
  );

  return companies.filter((company) => !cancelled.has(company.id));
}
