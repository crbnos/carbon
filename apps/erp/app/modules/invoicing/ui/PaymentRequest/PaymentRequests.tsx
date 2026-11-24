// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuEllipsisVertical, LuPlus } from "react-icons/lu";
import { DateTime, Empty } from "~/components";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import {
  canTransitionPaymentRequest,
  type PaymentRequestStatus
} from "~/modules/invoicing/invoicing.models";
import type {
  PaymentRequestRow,
  PaymentRequestsData,
  PaymentRequestTarget
} from "~/modules/invoicing/types";
import type { action as paymentRequestAction } from "~/routes/x+/payment-request";
import { path } from "~/utils/path";
import PaymentRequestFigure from "./PaymentRequestFigure";
import PaymentRequestForm from "./PaymentRequestForm";

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

export default function PaymentRequests({
  data,
  target,
  currencyCode,
  variant = "invoice"
}: {
  data: PaymentRequestsData;
  target: PaymentRequestTarget;
  currencyCode: string;
  variant?: "invoice" | "order";
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "invoicing");
  const canCreate = permissions.can("create", "invoicing");
  const formatter = useCurrencyFormatter({ currency: currencyCode });
  const [editing, setEditing] = useState<PaymentRequestRow | "new" | null>(
    null
  );
  const fetcher = useAction<typeof paymentRequestAction>({
    onSuccess: (result) => {
      const warning = (result as { data?: { warning?: string | null } })?.data
        ?.warning;
      if (warning) toast.warning(warning);
    }
  });

  const act = (intent: "ready" | "planned" | "cancel", id: string) =>
    fetcher.submit(
      { intent, id },
      { method: "post", action: path.to.paymentRequestAction }
    );

  return (
    <Card>
      <HStack className="w-full justify-between items-start">
        <CardHeader>
          <CardTitle>
            {variant === "order" ? (
              <Trans>Deposit requests</Trans>
            ) : (
              <Trans>Payment requests</Trans>
            )}
          </CardTitle>
          <CardDescription>
            {variant === "order" ? (
              <Trans>
                Deposits to pay the supplier before an invoice exists. A Ready
                request goes to Ramp as its own bill.
              </Trans>
            ) : (
              <Trans>
                Parts of the open balance to pay by a date. A Ready request goes
                to Ramp as its own bill.
              </Trans>
            )}
          </CardDescription>
        </CardHeader>
        {canCreate && (
          <CardAction>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              onClick={() => setEditing("new")}
              isDisabled={data.allowance <= 0}
            >
              <Trans>Add request</Trans>
            </Button>
          </CardAction>
        )}
      </HStack>
      <CardContent className="flex flex-col gap-4">
        <HStack spacing={6} className="text-sm">
          <PaymentRequestFigure
            label={
              variant === "order" ? t`Unpaid order total` : t`Open balance`
            }
            value={formatter.format(data.openBalance)}
          />
          <PaymentRequestFigure
            label={t`Planned`}
            value={formatter.format(data.planned)}
          />
          <PaymentRequestFigure
            label={t`Still to request`}
            value={formatter.format(data.allowance)}
          />
        </HStack>
        {data.requests.length === 0 ? (
          <Empty />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>#</Th>
                <Th>
                  <Trans>Status</Trans>
                </Th>
                <Th>
                  <Trans>Due</Trans>
                </Th>
                <Th>
                  <Trans>Description</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Amount</Trans>
                </Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {data.requests.map((r) => {
                // Hints only: the operations refuse a move the lifecycle forbids.
                const editable = r.status === "Planned" || r.status === "Ready";
                return (
                  <Tr key={r.id}>
                    <Td>{r.requestNumber}</Td>
                    <Td>
                      <HStack spacing={1}>
                        <Badge variant={statusColor[r.status]}>
                          {r.status}
                        </Badge>
                        {r.isAutomatic && (
                          <Badge variant="outline">
                            <Trans>Automatic</Trans>
                          </Badge>
                        )}
                      </HStack>
                    </Td>
                    <Td>
                      {r.dueDate ? (
                        <DateTime value={r.dueDate} variant="date" />
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="max-w-[240px] truncate">
                      {r.description ?? ""}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {r.amount == null
                        ? "—"
                        : formatter.format(Number(r.amount))}
                    </Td>
                    <Td className="text-right">
                      {canUpdate && r.status !== "Paid" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              aria-label={t`Request actions`}
                              icon={<LuEllipsisVertical />}
                              variant="ghost"
                              isDisabled={fetcher.isPending}
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {editable && (
                              <DropdownMenuItem onClick={() => setEditing(r)}>
                                <Trans>Edit</Trans>
                              </DropdownMenuItem>
                            )}
                            {canTransitionPaymentRequest(r.status, "Ready") &&
                              r.amount != null &&
                              r.dueDate != null && (
                                <DropdownMenuItem
                                  onClick={() => act("ready", r.id)}
                                >
                                  <Trans>Mark Ready</Trans>
                                </DropdownMenuItem>
                              )}
                            {canTransitionPaymentRequest(
                              r.status,
                              "Planned"
                            ) && (
                              <DropdownMenuItem
                                onClick={() => act("planned", r.id)}
                              >
                                <Trans>Move back to Planned</Trans>
                              </DropdownMenuItem>
                            )}
                            {canTransitionPaymentRequest(
                              r.status,
                              "Cancelled"
                            ) && (
                              <DropdownMenuItem
                                destructive
                                onClick={() => act("cancel", r.id)}
                              >
                                <Trans>Cancel request</Trans>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </CardContent>
      {editing && (
        <PaymentRequestForm
          key={editing === "new" ? "new" : editing.id}
          request={editing === "new" ? null : editing}
          target={target}
          currencyCode={currencyCode}
          allowance={
            editing === "new"
              ? data.allowance
              : data.allowance + Number(editing.amount ?? 0)
          }
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}
