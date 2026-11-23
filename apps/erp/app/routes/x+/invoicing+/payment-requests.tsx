// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useSearchParams } from "react-router";
import { DateTime, Empty } from "~/components";
import {
  type PaymentRequestStatus,
  paymentRequestStatusTypes
} from "~/modules/invoicing/invoicing.models";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Payment Requests`,
  to: path.to.paymentRequests,
  module: "invoicing"
};

const PAGE = 100;

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const status = url.searchParams
    .getAll("status")
    .filter((s): s is PaymentRequestStatus =>
      (paymentRequestStatusTypes as readonly string[]).includes(s)
    );
  const api = await carbon(request);
  const result = await api.invoicing.getPaymentRequests({
    status,
    supplierId: url.searchParams.get("supplierId") ?? undefined,
    dueBefore: url.searchParams.get("dueBefore") ?? undefined,
    limit: PAGE,
    offset: 0
  });
  return {
    requests: result.data?.requests ?? [],
    hasMore: result.data?.hasMore ?? false
  };
}

const FILTERS = [
  { label: msg`To pay`, status: [] },
  { label: msg`Sent`, status: ["Sent"] },
  { label: msg`Paid`, status: ["Paid"] },
  { label: msg`Cancelled`, status: ["Cancelled"] }
] satisfies { label: unknown; status: PaymentRequestStatus[] }[];

const statusColor: Record<
  PaymentRequestStatus,
  "gray" | "blue" | "yellow" | "green" | "red"
> = {
  Planned: "gray",
  Ready: "blue",
  Sent: "yellow",
  Paid: "green",
  Cancelled: "red"
};

export default function PaymentRequestsRoute() {
  const { t } = useLingui();
  const { requests, hasMore } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const active = params.getAll("status").join(",");

  return (
    <div className="w-full h-full overflow-y-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Payment Requests</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              What is still to pay suppliers, earliest due first. Planned
              requests are reminders; Ready requests go to Ramp.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <HStack spacing={2}>
            {FILTERS.map((f) => {
              const search = new URLSearchParams(
                f.status.map((s): [string, string] => ["status", s])
              );
              const isActive = f.status.join(",") === active;
              return (
                <Link
                  key={f.status.join(",") || "open"}
                  to={`${path.to.paymentRequests}?${search}`}
                  className={
                    isActive
                      ? "text-sm font-medium underline"
                      : "text-sm text-muted-foreground hover:underline"
                  }
                >
                  {t(f.label)}
                </Link>
              );
            })}
          </HStack>
          {requests.length === 0 ? (
            <Empty />
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Due</Trans>
                  </Th>
                  <Th>
                    <Trans>Document</Trans>
                  </Th>
                  <Th>#</Th>
                  <Th>
                    <Trans>Supplier</Trans>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                  <Th>
                    <Trans>Description</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Amount</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {requests.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      {r.dueDate ? (
                        <DateTime value={r.dueDate} variant="date" />
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
                      <Link
                        className="text-primary hover:underline"
                        to={
                          r.purchaseInvoiceId
                            ? path.to.purchaseInvoiceDetails(
                                r.purchaseInvoiceId
                              )
                            : path.to.purchaseOrderDetails(r.purchaseOrderId!)
                        }
                      >
                        {r.invoiceReadableId ?? r.purchaseOrderReadableId}
                      </Link>
                    </Td>
                    <Td>{r.requestNumber}</Td>
                    <Td>{r.supplierName}</Td>
                    <Td>
                      <Badge variant={statusColor[r.status]}>{r.status}</Badge>
                    </Td>
                    <Td className="max-w-[280px] truncate">
                      {r.description ?? ""}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {r.amount == null
                        ? "—"
                        : new Intl.NumberFormat(undefined, {
                            style: "currency",
                            currency: r.currencyCode
                          }).format(Number(r.amount))}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
          {hasMore && (
            <p className="text-sm text-muted-foreground">
              <Trans>
                Showing the first {PAGE}. Narrow the filter to see more.
              </Trans>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
