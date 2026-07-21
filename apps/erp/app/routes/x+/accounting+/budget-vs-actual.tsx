import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Badge, Heading, HStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useSearchParams } from "react-router";
import type { BudgetVsActualRow } from "~/modules/accounting";
import {
  getBudgetsList,
  getBudgetVsActual,
  getCostCentersList
} from "~/modules/accounting";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Budget vs Actual",
  to: path.to.budgetVsActual
};

const isDebitNormal = (accountClass: string | null) =>
  accountClass === "Asset" || accountClass === "Expense";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  const budgetId = url.searchParams.get("budgetId");
  const costCenterId = url.searchParams.get("costCenterId");
  const fromPeriod = Number(url.searchParams.get("from") ?? 1);
  const toPeriod = Number(url.searchParams.get("to") ?? 12);

  const [budgets, costCenters] = await Promise.all([
    getBudgetsList(client, companyId),
    getCostCentersList(client, companyId)
  ]);

  if (budgets.error) {
    throw redirect(
      path.to.accounting,
      await flash(request, error(budgets.error, "Failed to load budgets"))
    );
  }

  // Default to the most recently approved budget, else the first budget.
  const defaultBudget =
    budgets.data?.find((b) => b.status === "Approved") ?? budgets.data?.[0];
  const selectedBudgetId = budgetId ?? defaultBudget?.id ?? null;

  let rows: BudgetVsActualRow[] = [];
  let untaggedActual = 0;

  if (selectedBudgetId) {
    const result = await getBudgetVsActual(client, {
      companyId,
      budgetId: selectedBudgetId,
      costCenterId,
      rollup: true
    });
    if (result.error) {
      throw redirect(
        path.to.accounting,
        await flash(
          request,
          error(result.error, "Failed to load budget vs actual")
        )
      );
    }
    rows = (result.data ?? []).filter(
      (r) => r.periodNumber >= fromPeriod && r.periodNumber <= toPeriod
    );

    if (costCenterId) {
      const untagged = await getBudgetVsActual(client, {
        companyId,
        budgetId: selectedBudgetId,
        untagged: true
      });
      untaggedActual = (untagged.data ?? [])
        .filter(
          (r) => r.periodNumber >= fromPeriod && r.periodNumber <= toPeriod
        )
        .reduce(
          (sum, r) => sum + (isDebitNormal(r.class) ? 1 : -1) * r.actual,
          0
        );
    }
  }

  // Aggregate per account over the period range, natural-signed per class.
  const byAccount = new Map<
    string,
    {
      number: string;
      name: string;
      class: string | null;
      budget: number;
      actual: number;
    }
  >();
  for (const row of rows) {
    const sign = isDebitNormal(row.class) ? 1 : -1;
    const entry = byAccount.get(row.accountId) ?? {
      number: row.number,
      name: row.name,
      class: row.class,
      budget: 0,
      actual: 0
    };
    entry.budget += sign * row.budget;
    entry.actual += sign * row.actual;
    byAccount.set(row.accountId, entry);
  }

  return {
    budgets: budgets.data ?? [],
    costCenters: costCenters.data ?? [],
    selectedBudgetId,
    costCenterId,
    fromPeriod,
    toPeriod,
    untaggedActual,
    accounts: Array.from(byAccount.entries()).map(([accountId, v]) => ({
      accountId,
      ...v,
      variance: v.actual - v.budget,
      variancePercent:
        v.budget !== 0
          ? ((v.actual - v.budget) / Math.abs(v.budget)) * 100
          : null
    }))
  };
}

export default function BudgetVsActualRoute() {
  const {
    budgets,
    costCenters,
    selectedBudgetId,
    costCenterId,
    fromPeriod,
    toPeriod,
    untaggedActual,
    accounts
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  };

  const format = (n: number) =>
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  return (
    <div className="w-full">
      <div className="flex px-4 py-3 items-center gap-2 justify-between bg-card border-b border-border w-full flex-wrap">
        <Heading size="h3">Budget vs Actual</Heading>
        <HStack>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={selectedBudgetId ?? ""}
            onChange={(e) => setParam("budgetId", e.target.value)}
          >
            {budgets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} (FY{b.fiscalYear}
                {b.status === "Approved" ? ", approved" : ""})
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={costCenterId ?? ""}
            onChange={(e) => setParam("costCenterId", e.target.value)}
          >
            <option value="">All cost centers</option>
            {costCenters.map((cc) => (
              <option key={cc.id} value={cc.id}>
                {cc.name}
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={String(fromPeriod)}
            onChange={(e) => setParam("from", e.target.value)}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>
                From P{p}
              </option>
            ))}
          </select>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm"
            value={String(toPeriod)}
            onChange={(e) => setParam("to", e.target.value)}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>
                To P{p}
              </option>
            ))}
          </select>
        </HStack>
      </div>

      {costCenterId && untaggedActual !== 0 && (
        <div className="px-4 py-2 text-sm bg-muted text-muted-foreground border-b border-border">
          {format(Math.abs(untaggedActual))} of actuals in this range are not
          tagged to any cost center and are excluded from this view.
        </div>
      )}

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border h-11">
              <th className="text-left px-6 font-medium text-foreground/80">
                Account
              </th>
              <th className="text-right px-6 font-medium text-foreground/80">
                Budget
              </th>
              <th className="text-right px-6 font-medium text-foreground/80">
                Actual
              </th>
              <th className="text-right px-6 font-medium text-foreground/80">
                Variance
              </th>
              <th className="text-right px-6 font-medium text-foreground/80">
                Variance %
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr
                key={a.accountId}
                className="border-b border-border hover:bg-accent/50"
              >
                <td className="px-6 py-2">
                  <span className="font-medium">{a.number}</span>{" "}
                  <span className="text-muted-foreground">{a.name}</span>
                </td>
                <td className="px-6 py-2 text-right tabular-nums">
                  {format(a.budget)}
                </td>
                <td className="px-6 py-2 text-right tabular-nums">
                  {format(a.actual)}
                </td>
                <td
                  className={`px-6 py-2 text-right tabular-nums ${
                    a.class === "Expense" && a.variance > 0
                      ? "text-destructive"
                      : ""
                  }`}
                >
                  {format(a.variance)}
                </td>
                <td className="px-6 py-2 text-right tabular-nums">
                  {a.variancePercent === null ? (
                    <Badge variant="outline">No budget</Badge>
                  ) : (
                    `${a.variancePercent.toFixed(1)}%`
                  )}
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-10 text-muted-foreground text-sm"
                >
                  No data for this selection.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
