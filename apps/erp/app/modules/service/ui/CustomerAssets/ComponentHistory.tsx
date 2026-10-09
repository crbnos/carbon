// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { DateTime } from "~/components";
import { useCurrencyFormatter, useQuantityFormatter } from "~/hooks";
import type { ComponentHistoryRow } from "../../service.service";

/**
 * The service history of an asset by component, across all its orders:
 * hours, part cost and total cost charged to the nodes that name the
 * component, and the last day one of them was charged.
 */
export default function ComponentHistory({
  rows
}: {
  rows: ComponentHistoryRow[];
}) {
  const formatCurrency = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>History by Component</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            What each component has cost across every service order.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No service work has been charged to this asset yet.</Trans>
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Component</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Hours</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Part Cost</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Cost</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Orders</Trans>
                </Th>
                <Th>
                  <Trans>Last Service</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.key}>
                  <Td>
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{row.name}</span>
                      {row.serial && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {row.serial}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatQuantity(row.hours)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatCurrency.format(row.partCost)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatCurrency.format(row.cost)}
                  </Td>
                  <Td className="text-right tabular-nums">{row.orderCount}</Td>
                  <Td>
                    <DateTime
                      value={row.lastPostingDate}
                      variant="date"
                      fallback="—"
                    />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
