import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getAccountingPeriodsForFiscalYear,
  getBudget,
  getBudgetLines,
  getCostCentersList
} from "~/modules/accounting";
import { BudgetMatrix } from "~/modules/accounting/ui/Budgets";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Budgets",
  to: path.to.budgets
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      view: "accounting",
      role: "employee"
    });

  const { budgetId } = params;
  if (!budgetId) throw notFound("Budget ID was not found");

  const budget = await getBudget(client, budgetId, companyId);
  if (budget.error || !budget.data) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(budget.error, "Failed to get budget"))
    );
  }

  const [accounts, periods, lines, costCenters] = await Promise.all([
    // Posting (leaf) accounts only — `isGroup = false`. The chart of accounts
    // is scoped by companyGroupId (shared across the group).
    client
      .from("accounts")
      .select("id, number, name, class, incomeBalance")
      .eq("companyGroupId", companyGroupId)
      .eq("active", true)
      .eq("isGroup", false)
      .order("number", { ascending: true }),
    getAccountingPeriodsForFiscalYear(
      client,
      companyId,
      budget.data.fiscalYear
    ),
    getBudgetLines(client, budgetId, companyId),
    getCostCentersList(client, companyId)
  ]);

  if (accounts.error) {
    throw redirect(
      path.to.budgets,
      await flash(request, error(accounts.error, "Failed to load accounts"))
    );
  }
  if (periods.error || !periods.data || periods.data.length === 0) {
    throw redirect(
      path.to.budgets,
      await flash(
        request,
        error(
          periods.error,
          `No accounting periods exist for fiscal year ${budget.data.fiscalYear}`
        )
      )
    );
  }

  return {
    budget: budget.data,
    accounts: (accounts.data ?? []).filter((a) => a.id !== null),
    periods: periods.data,
    lines: lines.data ?? [],
    costCenters: costCenters.data ?? [],
    companyId,
    userId
  };
}

export default function BudgetMatrixRoute() {
  const { budget, accounts, periods, lines, costCenters, companyId, userId } =
    useLoaderData<typeof loader>();

  return (
    <BudgetMatrix
      budget={budget}
      accounts={accounts as any}
      periods={periods}
      lines={lines}
      costCenters={costCenters}
      companyId={companyId}
      userId={userId}
    />
  );
}
