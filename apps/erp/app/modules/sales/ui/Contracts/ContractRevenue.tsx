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
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { lineRevenueDates } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, useEffect, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { DateTime } from "~/components";
import { useDateFormatter } from "~/hooks";
import ContractMoney from "./ContractMoney";
import type { ContractLine, ContractRouteData } from "./types";

type ContractRevenueProps = Pick<
  ContractRouteData,
  "contract" | "lines" | "revenue"
>;

/** Each line's revenue by month and the invoiced / recognized / deferred
 *  position — a preview computed from the lines (plan decision 1). */
const ContractRevenue = ({
  contract,
  lines,
  revenue
}: ContractRevenueProps) => {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const projectNames = useProjectNames(lines);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const currencyCode = contract.currencyCode;
  const methodLabels: Record<ContractLine["revenueMethod"], string> = {
    Daily: t`Daily`,
    "Even Period": t`Even Period`
  };
  const monthLabel = (date: string) =>
    formatDate(date, { month: "short", year: "numeric" });

  const monthsByLine = new Map<string, typeof revenue.lines>();
  for (const month of revenue.lines) {
    const months = monthsByLine.get(month.lineId) ?? [];
    months.push(month);
    monthsByLine.set(month.lineId, months);
  }

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
                  <Th className="w-10" />
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
                  const months = monthsByLine.get(line.id) ?? [];
                  const total = months.reduce(
                    (sum, month) => sum + month.amount,
                    0
                  );
                  const isExpanded = expanded.has(line.id);
                  return (
                    <Fragment key={line.id}>
                      <Tr>
                        <Td>
                          {months.length > 0 && (
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
                        <Td>
                          <span className="line-clamp-1">
                            {line.description || line.item?.name || line.itemId}
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
                            value={total}
                            currencyCode={currencyCode}
                          />
                        </Td>
                      </Tr>
                      {isExpanded &&
                        months.map((month) => (
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

            {revenue.position.length > 0 && (
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
                  {revenue.position.map((month) => (
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
              <Trans>
                Preview. Until line-level revenue arrives, posted revenue
                follows each invoice line's service period by day.
              </Trans>
            </p>
          </VStack>
        )}
      </CardContent>
    </Card>
  );
};

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
