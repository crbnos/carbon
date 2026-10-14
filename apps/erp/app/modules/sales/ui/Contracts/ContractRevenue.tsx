// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  IconButton,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import {
  type ContractPositionMonth,
  type ContractRevenueRow,
  CUSTOMER_CONTRACT_REVENUE_STATUS_COLOR_MAP,
  contractPositionPreview,
  equals,
  lineRevenueDates,
  round
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { Table as DataTable, DateTime } from "~/components";
import { setupGridHeight } from "~/components/Setup";
import { useDateFormatter } from "~/hooks";
import ContractMoney from "./ContractMoney";
import ContractRevenueGrid, {
  ContractRecognitionGrid
} from "./ContractRevenueGrid";
import { contractLineName, lineColumnKey } from "./contractGrid";
import type { ContractLine, ContractRouteData } from "./types";

type ContractRevenueProps = Pick<
  ContractRouteData,
  | "contract"
  | "lines"
  | "schedule"
  | "credits"
  | "revenue"
  | "revenueRows"
  | "revenueIsStored"
  | "revenueResiduals"
>;

type RevenueStatus = ContractRevenueRow["status"];

/** A month's status: every line's, or Partial when some of its lines are
 *  recognized and some are still planned. */
type MonthStatus = RevenueStatus | "Partial";

/** One month of a stored plan: the month, its status, one amount per line
 *  (`line0`, …) and the month's total. */
type MonthRow = {
  periodStart: string;
  status: MonthStatus;
  total: number;
} & Record<string, string | number | null>;

const isRecognized = (status: RevenueStatus) =>
  status === "Recognized" || status === "Recognized Externally";

/** Each line's revenue by month and the invoiced / recognized / deferred
 *  position. A Draft's plan is edited as a grid; a confirmed contract shows
 *  its stored plan, or — confirmed before revenue was stored — a preview
 *  computed from the lines. */
const ContractRevenue = ({
  contract,
  lines,
  schedule,
  credits,
  revenue,
  revenueRows,
  revenueIsStored,
  revenueResiduals
}: ContractRevenueProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const projectNames = useProjectNames(lines);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const monthLabel = useCallback(
    (date: string) => formatDate(date, { month: "short", year: "numeric" }),
    [formatDate]
  );

  // A Draft's revenue plan is worked on as a grid (the setup wizard's
  // Revenue step uses the same one); a confirmed contract's is read here.
  if (contract.status === "Draft") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Revenue</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VStack spacing={8} className="w-full">
            <ContractRecognitionGrid contract={contract} lines={lines} />
            <ContractRevenueGrid
              contract={contract}
              lines={lines}
              revenueRows={revenueRows}
              revenueIsStored={revenueIsStored}
              revenueResiduals={revenueResiduals}
            />
          </VStack>
        </CardContent>
      </Card>
    );
  }

  const currencyCode = contract.currencyCode;
  const methodLabels: Record<ContractLine["revenueMethod"], string> = {
    Daily: t`Daily`,
    "Even Period": t`Even Period`
  };

  // A contract confirmed before revenue was stored has no rows until the
  // next invoicing run writes them; until then it shows the preview.
  const months: { lineId: string; periodStart: string; amount: number }[] =
    revenueIsStored ? revenueRows : revenue.lines;
  const monthsByLine = new Map<string, typeof months>();
  for (const month of months) {
    monthsByLine.set(month.lineId, [
      ...(monthsByLine.get(month.lineId) ?? []),
      month
    ]);
  }

  // The stored plan's position counts only what has happened: invoices
  // drafted or billed externally (and credits), and months recognized —
  // Planned months are still to come.
  const position: ContractPositionMonth[] = revenueIsStored
    ? contractPositionPreview(
        [
          ...schedule
            .filter((invoice) => invoice.status !== "Planned")
            .flatMap((invoice) =>
              invoice.customerContractInvoiceLine.map((row) => ({
                invoiceDate: invoice.invoiceDate,
                amount: Number(row.amount)
              }))
            ),
          ...credits.map((row) => ({
            invoiceDate: row.periodStart,
            amount: Number(row.amount)
          }))
        ],
        revenueRows.filter((row) => isRecognized(row.status))
      )
    : revenue.position;

  const toggle = (lineId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Revenue</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>Revenue is previewed once the contract has lines.</Trans>
          </p>
        ) : (
          <VStack spacing={8} className="w-full">
            <Table>
              <Thead>
                <Tr>
                  {!revenueIsStored && <Th className="w-10" />}
                  <Th>
                    <Trans>Line</Trans>
                  </Th>
                  <Th>
                    <Trans>Method</Trans>
                  </Th>
                  <Th>
                    <Trans>Project</Trans>
                  </Th>
                  <Th>
                    <Trans>Revenue Dates</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Revenue</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {lines.map((line) => {
                  const dates = lineRevenueDates(line);
                  const lineMonths = monthsByLine.get(line.id) ?? [];
                  const total = lineMonths.reduce(
                    (sum, month) => sum + month.amount,
                    0
                  );
                  const isExpanded = !revenueIsStored && expanded.has(line.id);
                  return (
                    <Fragment key={line.id}>
                      <Tr>
                        {!revenueIsStored && (
                          <Td>
                            {lineMonths.length > 0 && (
                              <IconButton
                                aria-label={
                                  isExpanded
                                    ? t`Hide monthly revenue`
                                    : t`Show monthly revenue`
                                }
                                icon={
                                  isExpanded ? (
                                    <LuChevronDown />
                                  ) : (
                                    <LuChevronRight />
                                  )
                                }
                                variant="ghost"
                                size="sm"
                                onClick={() => toggle(line.id)}
                              />
                            )}
                          </Td>
                        )}
                        <Td>
                          <span className="line-clamp-1">
                            {contractLineName(line)}
                          </span>
                        </Td>
                        <Td>{methodLabels[line.revenueMethod]}</Td>
                        <Td>
                          {line.projectId
                            ? (projectNames[line.projectId] ?? "…")
                            : "—"}
                        </Td>
                        <Td>
                          <span className="whitespace-nowrap">
                            <DateTime value={dates.start} variant="date" />
                            {" – "}
                            {dates.end ? (
                              <DateTime value={dates.end} variant="date" />
                            ) : (
                              <Trans>No end</Trans>
                            )}
                          </span>
                        </Td>
                        <Td className="text-right">
                          <ContractMoney
                            value={round(total)}
                            currencyCode={currencyCode}
                          />
                        </Td>
                      </Tr>
                      {isExpanded &&
                        lineMonths.map((month) => (
                          <Tr key={`${line.id}-${month.periodStart}`}>
                            <Td />
                            <Td
                              colSpan={4}
                              className="text-muted-foreground pl-6"
                            >
                              {monthLabel(month.periodStart)}
                            </Td>
                            <Td className="text-right text-muted-foreground">
                              <ContractMoney
                                value={month.amount}
                                currencyCode={currencyCode}
                              />
                            </Td>
                          </Tr>
                        ))}
                    </Fragment>
                  );
                })}
              </Tbody>
            </Table>

            {revenueIsStored && (
              <ContractRevenuePlan
                lines={lines}
                revenueRows={revenueRows}
                currencyCode={currencyCode}
                monthLabel={monthLabel}
              />
            )}

            {position.length > 0 && (
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Month</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Invoiced</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Recognized</Trans>
                    </Th>
                    <Th className="text-right">
                      <Trans>Deferred</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {position.map((month) => (
                    <Tr key={month.month}>
                      <Td className="whitespace-nowrap">
                        {monthLabel(month.month)}
                      </Td>
                      <Td className="text-right">
                        <ContractMoney
                          value={month.invoiced}
                          currencyCode={currencyCode}
                        />
                      </Td>
                      <Td className="text-right">
                        <ContractMoney
                          value={month.recognized}
                          currencyCode={currencyCode}
                        />
                      </Td>
                      <Td className="text-right">
                        {month.deferred < 0 ? (
                          <span className="flex flex-col items-end">
                            <ContractMoney
                              value={-month.deferred}
                              currencyCode={currencyCode}
                            />
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              <Trans>Earned, not billed</Trans>
                            </span>
                          </span>
                        ) : (
                          <ContractMoney
                            value={month.deferred}
                            currencyCode={currencyCode}
                          />
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}

            <p className="text-xs text-muted-foreground w-full">
              {revenueIsStored ? (
                <Trans>
                  The position counts invoices drafted or billed externally and
                  months recognized. Planned months are still to come.
                </Trans>
              ) : (
                <Trans>
                  Preview. Until line-level revenue arrives, posted revenue
                  follows each invoice line's service period by day.
                </Trans>
              )}
            </p>
          </VStack>
        )}
      </CardContent>
    </Card>
  );
};

/** A confirmed contract's stored revenue plan, read-only: a row per month
 *  with its status, a column per line, and what each line has recognized so
 *  far in the footer. The same shape as the Draft's `ContractRevenueGrid`. */
function ContractRevenuePlan({
  lines,
  revenueRows,
  currencyCode,
  monthLabel
}: {
  lines: ContractLine[];
  revenueRows: ContractRevenueRow[];
  currencyCode: string | null;
  monthLabel: (date: string) => string;
}) {
  const { t } = useLingui();

  const months = useMemo<MonthRow[]>(() => {
    const byMonth = new Map<string, ContractRevenueRow[]>();
    for (const row of revenueRows) {
      byMonth.set(row.periodStart, [
        ...(byMonth.get(row.periodStart) ?? []),
        row
      ]);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodStart, entries]) => {
        const month: MonthRow = {
          periodStart,
          status: monthStatus(entries),
          total: round(entries.reduce((sum, entry) => sum + entry.amount, 0))
        };
        lines.forEach((line, index) => {
          const amounts = entries.filter((entry) => entry.lineId === line.id);
          month[lineColumnKey(index)] =
            amounts.length > 0
              ? round(amounts.reduce((sum, entry) => sum + entry.amount, 0))
              : null;
        });
        return month;
      });
  }, [revenueRows, lines]);

  const recognizedByLine = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const row of revenueRows) {
      if (!isRecognized(row.status)) continue;
      totals[row.lineId] = (totals[row.lineId] ?? 0) + row.amount;
    }
    return totals;
  }, [revenueRows]);

  const columns = useMemo<ColumnDef<MonthRow>[]>(
    () => [
      {
        accessorKey: "periodStart",
        header: t`Month`,
        cell: ({ row }) => (
          <span className="whitespace-nowrap tabular-nums">
            {monthLabel(row.original.periodStart)}
          </span>
        ),
        footer: () => (
          <span className="text-muted-foreground">
            <Trans>Recognized to date</Trans>
          </span>
        )
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => (
          <ContractRevenueStatus status={row.original.status} />
        ),
        footer: () => null
      },
      ...lines.map<ColumnDef<MonthRow>>((line, index) => ({
        accessorKey: lineColumnKey(index),
        header: () => (
          <span className="block max-w-[160px] truncate">
            {contractLineName(line)}
          </span>
        ),
        cell: ({ row }) => {
          const value = row.original[lineColumnKey(index)];
          return typeof value === "number" ? (
            <ContractMoney value={value} currencyCode={currencyCode} />
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
        footer: () => (
          <ContractMoney
            value={round(recognizedByLine[line.id] ?? 0)}
            currencyCode={currencyCode}
          />
        )
      })),
      {
        id: "total",
        header: t`Total`,
        cell: ({ row }) => (
          <span className="font-medium">
            <ContractMoney
              value={row.original.total}
              currencyCode={currencyCode}
            />
          </span>
        ),
        footer: () => (
          <ContractMoney
            value={round(
              Object.values(recognizedByLine).reduce((sum, v) => sum + v, 0)
            )}
            currencyCode={currencyCode}
          />
        )
      }
    ],
    [t, lines, currencyCode, monthLabel, recognizedByLine]
  );

  if (months.length === 0) return null;

  return (
    <div
      className="w-full overflow-hidden rounded-lg border border-border"
      style={{ height: setupGridHeight(months.length) }}
    >
      <DataTable<MonthRow>
        compact
        columns={columns}
        data={months}
        count={months.length}
        withPagination={false}
        withSearch={false}
        withSimpleSorting={false}
        withSidebarTrigger={false}
        withColumnOrdering={false}
        withCsvExport={false}
        sort={null}
      />
    </div>
  );
}

/** Every line's status when they agree; a zero-amount row is ignored, since
 *  a recognition run never picks one up. */
function monthStatus(entries: ContractRevenueRow[]): MonthStatus {
  const counted = entries.filter((entry) => !equals(entry.amount, 0));
  const basis = counted.length > 0 ? counted : entries;
  if (basis.every((entry) => entry.status === "Recognized Externally")) {
    return "Recognized Externally";
  }
  if (basis.every((entry) => isRecognized(entry.status))) return "Recognized";
  if (basis.some((entry) => isRecognized(entry.status))) return "Partial";
  return "Planned";
}

/** Planned / Recognized / Recognized Externally, or Partly Recognized for a
 *  month whose lines are not all recognized yet. */
function ContractRevenueStatus({ status }: { status: MonthStatus }) {
  switch (status) {
    case "Planned":
      return (
        <Status color={CUSTOMER_CONTRACT_REVENUE_STATUS_COLOR_MAP.Planned}>
          <Trans>Planned</Trans>
        </Status>
      );
    case "Recognized":
      return (
        <Status color={CUSTOMER_CONTRACT_REVENUE_STATUS_COLOR_MAP.Recognized}>
          <Trans>Recognized</Trans>
        </Status>
      );
    case "Recognized Externally":
      return (
        <Status
          color={
            CUSTOMER_CONTRACT_REVENUE_STATUS_COLOR_MAP["Recognized Externally"]
          }
        >
          <Trans>Recognized Externally</Trans>
        </Status>
      );
    case "Partial":
      return (
        <Status color="yellow">
          <Trans>Partly Recognized</Trans>
        </Status>
      );
    default:
      return null;
  }
}

/** The names of the lines' projects, read in one query. The lines carry only
 *  `projectId`. */
function useProjectNames(lines: ContractLine[]): Record<string, string> {
  const { carbon } = useCarbon();
  const [names, setNames] = useState<Record<string, string>>({});
  const projectIds = [
    ...new Set(
      lines
        .map((line) => line.projectId)
        .filter((projectId): projectId is string => Boolean(projectId))
    )
  ].sort();
  const key = projectIds.join(",");

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the id list, not the array identity
  useEffect(() => {
    if (!carbon || projectIds.length === 0) return;
    let cancelled = false;
    carbon
      .from("project")
      .select("id, name")
      .in("id", projectIds)
      .then(({ data }) => {
        if (cancelled) return;
        setNames(
          Object.fromEntries(
            (data ?? []).map((project) => [project.id, project.name])
          )
        );
      });
    return () => {
      cancelled = true;
    };
  }, [carbon, key]);

  return names;
}

export default ContractRevenue;
