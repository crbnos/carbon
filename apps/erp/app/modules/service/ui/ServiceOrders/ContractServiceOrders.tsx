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
import { DateTime, Hyperlink } from "~/components";
import { useCurrencyFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type { ServiceOrderStatus as ServiceOrderStatusType } from "../../service.models";
import { ServiceOrderStatus } from "../ServiceStatus";

export type ContractServiceOrderRow = {
  id: string;
  serviceOrderId: string;
  status: ServiceOrderStatusType;
  serial: string | null;
  customerAssetId: string | null;
  site: string | null;
  createdAt: string;
  completedAt: string | null;
  /** The order's posted cost, or null when it could not be read. */
  actual: number | null;
  /** What has been billed, or null when the contract has no project. */
  billed: number | null;
};

/**
 * The service orders a customer contract covers, one row each, with the cost
 * posted to each order and what has been billed (base currency).
 */
export default function ContractServiceOrders({
  rows
}: {
  rows: ContractServiceOrderRow[];
}) {
  const formatMoney = useCurrencyFormatter();
  const money = (value: number | null) =>
    value === null ? "—" : formatMoney.format(value);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Service Orders</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>The service orders this contract covers.</Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No service order names this contract.</Trans>
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Service Order</Trans>
                </Th>
                <Th>
                  <Trans>Status</Trans>
                </Th>
                <Th>
                  <Trans>Serial</Trans>
                </Th>
                <Th>
                  <Trans>Site</Trans>
                </Th>
                <Th>
                  <Trans>Created</Trans>
                </Th>
                <Th>
                  <Trans>Completed</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Actual Cost</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Billed</Trans>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Hyperlink to={path.to.serviceOrderDetails(row.id)}>
                      <span className="whitespace-nowrap">
                        {row.serviceOrderId}
                      </span>
                    </Hyperlink>
                  </Td>
                  <Td>
                    <ServiceOrderStatus status={row.status} />
                  </Td>
                  <Td>
                    {row.customerAssetId ? (
                      <Hyperlink
                        to={path.to.customerAsset(row.customerAssetId)}
                      >
                        <span className="whitespace-nowrap">
                          {row.serial ?? "—"}
                        </span>
                      </Hyperlink>
                    ) : (
                      <span className="whitespace-nowrap">
                        {row.serial ?? "—"}
                      </span>
                    )}
                  </Td>
                  <Td className="max-w-48 truncate">{row.site ?? "—"}</Td>
                  <Td className="whitespace-nowrap">
                    <DateTime value={row.createdAt} variant="date" />
                  </Td>
                  <Td className="whitespace-nowrap">
                    <DateTime
                      value={row.completedAt}
                      variant="date"
                      fallback="—"
                    />
                  </Td>
                  <Td className="text-right tabular-nums">
                    {money(row.actual)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {money(row.billed)}
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
