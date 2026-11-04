// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Hyperlink } from "~/components";
import { useCurrencyFormatter, useUser } from "~/hooks";
import { usePercentFormatter } from "~/hooks/usePercentFormatter";
import { path } from "~/utils/path";

type ProgressRevenue = {
  id: string;
  periodStart: string;
  amount: number;
  earnedToDate: number | null;
  estimateAtCompletion: number | null;
  transactionPrice: number | null;
  progress: number | null;
};

type ProgressContractLine = {
  id: string;
  description: string | null;
  customerContractId: string;
  contract: { id: string; customerContractId: string } | null;
  element: { id: string; readableId: string; name: string } | null;
};

export type ProjectRevenueRunLine = {
  id: string;
  amount: number;
  schedule: {
    type: string;
    customerContractLineId: string | null;
    revenue: ProgressRevenue | null;
    contractLine: ProgressContractLine | null;
  } | null;
};

type ProgressRow = {
  contractLine: ProgressContractLine;
  /** The latest progress month in the run (the snapshot it was built from). */
  snapshot: ProgressRevenue | null;
  thisMonth: number;
  costRelieved: number;
  lossProvision: number;
};

/**
 * One row per contract line the run recognizes by progress: the progress
 * months (Right to Invoice and Percent Complete write `earnedToDate`), and the
 * Cost Relief and Loss Provision rows. A line with none of them has no row.
 */
export function projectRevenueRows(lines: ProjectRevenueRunLine[]) {
  const rows = new Map<string, ProgressRow>();
  const counted = new Set<string>();
  for (const line of lines) {
    const schedule = line.schedule;
    const contractLine = schedule?.contractLine;
    if (!schedule || !contractLine) continue;
    const isProgressMonth =
      schedule.revenue !== null && schedule.revenue.earnedToDate !== null;
    const isProjectRow =
      schedule.type === "Cost Relief" || schedule.type === "Loss Provision";
    if (!isProgressMonth && !isProjectRow) continue;

    const row = rows.get(contractLine.id) ?? {
      contractLine,
      snapshot: null,
      thisMonth: 0,
      costRelieved: 0,
      lossProvision: 0
    };
    if (schedule.type === "Cost Relief")
      row.costRelieved += Number(line.amount);
    if (schedule.type === "Loss Provision")
      row.lossProvision += Number(line.amount);
    // A month splits into a Deferral and an Accrual row; count it once.
    const revenue = schedule.revenue;
    if (isProgressMonth && revenue && !counted.has(revenue.id)) {
      counted.add(revenue.id);
      row.thisMonth += Number(revenue.amount);
      if (!row.snapshot || revenue.periodStart > row.snapshot.periodStart) {
        row.snapshot = revenue;
      }
    }
    rows.set(contractLine.id, row);
  }
  return [...rows.values()];
}

/**
 * The project revenue review of a revenue recognition run: per progress line,
 * the estimate at completion, the price, the progress, the revenue earned to
 * date and this month, the cost relieved from Project WIP and the loss
 * provision change. A Right to Invoice line has no EAC, price or progress.
 */
export default function ProjectRevenueProgress({
  lines
}: {
  lines: ProjectRevenueRunLine[];
}) {
  const { company } = useUser();
  const formatMoney = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });
  const formatPercent = usePercentFormatter();
  const rows = projectRevenueRows(lines);
  if (rows.length === 0) return null;

  const money = (value: number | null | undefined) =>
    value === null || value === undefined
      ? "—"
      : formatMoney.format(Number(value));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Project Revenue</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            The progress behind each project contract line in this run.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="min-h-0 overflow-auto rounded-lg border border-border w-full">
          <Table full>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Contract Line</Trans>
                </Th>
                <Th>
                  <Trans>Billing Element</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>EAC</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Price</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Progress</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Earned to Date</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>This Month</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Cost Relieved</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Loss Provision</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => {
                const { contractLine, snapshot } = row;
                return (
                  <Tr key={contractLine.id}>
                    <Td>
                      <span className="flex min-w-0 items-center gap-2">
                        {contractLine.contract && (
                          <Hyperlink
                            className="shrink-0 whitespace-nowrap"
                            to={path.to.contractDetails(
                              contractLine.contract.id
                            )}
                          >
                            {contractLine.contract.customerContractId}
                          </Hyperlink>
                        )}
                        <Hyperlink
                          className="truncate"
                          to={path.to.contractLineBilling(
                            contractLine.customerContractId,
                            contractLine.id
                          )}
                        >
                          {contractLine.description || contractLine.id}
                        </Hyperlink>
                      </span>
                    </Td>
                    <Td>
                      {contractLine.element ? (
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 whitespace-nowrap font-medium">
                            {contractLine.element.readableId}
                          </span>
                          <span className="truncate">
                            {contractLine.element.name}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {money(snapshot?.estimateAtCompletion)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {money(snapshot?.transactionPrice)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {snapshot?.progress === null ||
                      snapshot?.progress === undefined
                        ? "—"
                        : formatPercent.format(Number(snapshot.progress))}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {money(snapshot?.earnedToDate)}
                    </Td>
                    <Td className="text-right tabular-nums font-medium">
                      {snapshot ? money(row.thisMonth) : "—"}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {money(row.costRelieved)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {money(row.lossProvision)}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
