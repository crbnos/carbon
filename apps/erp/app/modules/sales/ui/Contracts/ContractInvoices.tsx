// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  Status,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment, useState } from "react";
import { LuChevronDown, LuChevronRight } from "react-icons/lu";
import { DateTime, Hyperlink } from "~/components";
import { useRouteData, useUser } from "~/hooks";
import { path } from "~/utils/path";
import ContractInvoiceGrid from "./ContractInvoiceGrid";
import ContractMoney from "./ContractMoney";
import type {
  ContractInvoiceStatusType,
  ContractLine,
  ContractRouteData
} from "./types";

type ContractInvoicesProps = Pick<
  ContractRouteData,
  "contract" | "lines" | "schedule" | "credits" | "computedSchedule"
>;

const lineName = (line: ContractLine | undefined, fallback: string) =>
  line ? line.description || line.item?.name || line.itemId : fallback;

/** The invoice schedule: a Draft's is worked on as a grid; a confirmed
 *  contract's is read here — every planned invoice with its lines, the sales
 *  invoice it was drafted as, and any cancellation credit. */
const ContractInvoices = ({
  contract,
  lines,
  schedule,
  credits,
  computedSchedule
}: ContractInvoicesProps) => {
  const { t } = useLingui();
  const { company } = useUser();

  const contractId = contract.id ?? "";
  const routeData = useRouteData<ContractRouteData>(
    path.to.contract(contractId)
  );
  const invoiceLinks = routeData?.invoiceLinks ?? {};
  const creditMemoLinks = routeData?.creditMemoLinks ?? {};

  const currencyCode = contract.currencyCode ?? company.baseCurrencyCode;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // A Draft's schedule is worked on as a grid (the setup wizard's Invoicing
  // step uses the same one); a confirmed contract's is read here.
  if (contract.status === "Draft") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Invoices</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ContractInvoiceGrid
            contract={contract}
            lines={lines}
            schedule={schedule}
            computedSchedule={computedSchedule}
            lineTotals={routeData?.lineTotals ?? {}}
          />
        </CardContent>
      </Card>
    );
  }

  const lineById = new Map(lines.map((line) => [line.id, line]));
  const nameOf = (lineId: string) =>
    lineName(lineById.get(lineId), t`Removed line`);

  const invoices = schedule.map((invoice) => {
    const rows = invoice.customerContractInvoiceLine.map((row) => ({
      id: row.id,
      lineId: row.customerContractLineId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      amount: Number(row.amount),
      isAdjustment: row.isAdjustment
    }));
    return {
      id: invoice.id,
      invoiceDate: invoice.invoiceDate,
      status: invoice.status,
      isEdited: invoice.isEdited,
      salesInvoiceId: invoice.salesInvoiceId,
      rows,
      total: rows.reduce((sum, row) => sum + row.amount, 0)
    };
  });

  const creditsByMemo = new Map<string, typeof credits>();
  for (const row of credits) {
    const key = row.memoId ?? "";
    creditsByMemo.set(key, [...(creditsByMemo.get(key) ?? []), row]);
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Invoices</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <VStack spacing={4}>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No invoices planned.</Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th className="w-8" />
                  <Th>
                    <Trans>Date</Trans>
                  </Th>
                  <Th>
                    <Trans>Lines</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Total</Trans>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                  <Th>
                    <Trans>Invoice</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {invoices.map((invoice) => {
                  const isOpen = expanded.has(invoice.id);
                  const link = invoice.salesInvoiceId
                    ? invoiceLinks[invoice.salesInvoiceId]
                    : undefined;
                  return (
                    <Fragment key={invoice.id}>
                      <Tr>
                        <Td>
                          <IconButton
                            aria-label={isOpen ? t`Hide lines` : t`Show lines`}
                            icon={
                              isOpen ? <LuChevronDown /> : <LuChevronRight />
                            }
                            variant="ghost"
                            size="sm"
                            onClick={() => toggle(invoice.id)}
                          />
                        </Td>
                        <Td>
                          <HStack spacing={2} className="flex-wrap">
                            <span className="whitespace-nowrap">
                              <DateTime
                                value={invoice.invoiceDate}
                                variant="date"
                              />
                            </span>
                            {invoice.isEdited && (
                              <Badge variant="secondary">
                                <Trans>Edited</Trans>
                              </Badge>
                            )}
                          </HStack>
                        </Td>
                        <Td className="tabular-nums">
                          {invoice.rows.length === 1 ? (
                            <Trans>1 line</Trans>
                          ) : (
                            <Trans>{invoice.rows.length} lines</Trans>
                          )}
                        </Td>
                        <Td className="text-right">
                          <ContractMoney
                            value={invoice.total}
                            currencyCode={currencyCode}
                          />
                        </Td>
                        <Td>
                          <ContractInvoiceStatus status={invoice.status} />
                        </Td>
                        <Td>
                          {link ? (
                            <HStack spacing={2}>
                              <Hyperlink
                                to={path.to.salesInvoiceDetails(link.id)}
                              >
                                {link.invoiceId}
                              </Hyperlink>
                              {link.status === "Draft" &&
                                link.automationHoldReason && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="orange">
                                        <Trans>Held</Trans>
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {link.automationHoldReason}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                            </HStack>
                          ) : (
                            "—"
                          )}
                        </Td>
                      </Tr>
                      {isOpen &&
                        invoice.rows.map((row) => (
                          <Tr key={row.id} className="bg-muted/30">
                            <Td />
                            <Td className="text-muted-foreground">
                              <span className="whitespace-nowrap">
                                <DateTime
                                  value={row.periodStart}
                                  variant="date"
                                />{" "}
                                –{" "}
                                <DateTime
                                  value={row.periodEnd}
                                  variant="date"
                                />
                              </span>
                            </Td>
                            <Td>
                              <HStack spacing={2} className="flex-wrap">
                                <span className="line-clamp-1">
                                  {nameOf(row.lineId)}
                                </span>
                                {row.isAdjustment && (
                                  <Badge variant="orange">
                                    <Trans>Adjustment</Trans>
                                  </Badge>
                                )}
                              </HStack>
                            </Td>
                            <Td className="text-right">
                              <ContractMoney
                                value={row.amount}
                                currencyCode={currencyCode}
                              />
                            </Td>
                            <Td />
                            <Td />
                          </Tr>
                        ))}
                    </Fragment>
                  );
                })}
              </Tbody>
            </Table>
          )}

          {creditsByMemo.size > 0 && (
            <VStack spacing={2}>
              {[...creditsByMemo.entries()].map(([memoKey, rows]) => {
                const memo = creditMemoLinks[memoKey];
                return (
                  <VStack key={memoKey} spacing={1}>
                    <span className="text-sm font-medium">
                      {memo ? (
                        <Trans>
                          Credited on{" "}
                          <Hyperlink to={path.to.memo(memo.id)}>
                            {memo.memoId}
                          </Hyperlink>
                        </Trans>
                      ) : (
                        <Trans>Credited</Trans>
                      )}
                    </span>
                    {rows.map((row) => (
                      <HStack
                        key={row.id}
                        className="w-full text-sm text-muted-foreground"
                      >
                        <span className="flex-1 min-w-0 truncate">
                          {nameOf(row.customerContractLineId)}
                        </span>
                        <span className="shrink-0 whitespace-nowrap">
                          <DateTime value={row.periodStart} variant="date" /> –{" "}
                          <DateTime value={row.periodEnd} variant="date" />
                        </span>
                        <span className="shrink-0 w-28 text-right">
                          <ContractMoney
                            value={Number(row.amount)}
                            currencyCode={currencyCode}
                          />
                        </span>
                      </HStack>
                    ))}
                  </VStack>
                );
              })}
            </VStack>
          )}
        </VStack>
      </CardContent>
    </Card>
  );
};

/** Planned / Invoiced / Billed externally. */
const ContractInvoiceStatus = ({
  status
}: {
  status: ContractInvoiceStatusType;
}) => {
  switch (status) {
    case "Planned":
      return (
        <Status color="gray">
          <Trans>Planned</Trans>
        </Status>
      );
    case "Invoiced":
      return (
        <Status color="green">
          <Trans>Invoiced</Trans>
        </Status>
      );
    case "Billed Externally":
      return (
        <Status color="blue">
          <Trans>Billed Externally</Trans>
        </Status>
      );
    default:
      return null;
  }
};

export default ContractInvoices;
