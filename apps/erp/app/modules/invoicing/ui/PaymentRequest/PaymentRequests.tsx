// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
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
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast
} from "@carbon/react";
import { INPUT_FORMAT } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { nanoid } from "nanoid";
import { useState } from "react";
import { LuEllipsisVertical, LuPlus } from "react-icons/lu";
import { DateTime, Empty } from "~/components";
import {
  DatePicker,
  Hidden,
  Number as NumberField,
  Select,
  Submit,
  TextArea
} from "~/components/Form";
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import {
  canTransitionPaymentRequest,
  type PaymentRequestStatus,
  paymentRequestValidator
} from "~/modules/invoicing/invoicing.models";
import type { action as paymentRequestAction } from "~/routes/x+/payment-request";
import { path } from "~/utils/path";

export type PaymentRequestRow = {
  id: string;
  requestNumber: number;
  status: PaymentRequestStatus;
  amount: string | number | null;
  dueDate: string | null;
  description: string | null;
  isAutomatic: boolean;
  paymentId: string | null;
};

/** What `getPaymentRequestsForDocument` returns. The card computes none of it. */
export type PaymentRequestsData = {
  requests: PaymentRequestRow[];
  openBalance: number;
  requested: number;
  planned: number;
  allowance: number;
};

type Target = { purchaseInvoiceId: string } | { purchaseOrderId: string };

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
  target: Target;
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
          <Figure
            label={
              variant === "order" ? t`Unpaid order total` : t`Open balance`
            }
            value={formatter.format(data.openBalance)}
          />
          <Figure label={t`Planned`} value={formatter.format(data.planned)} />
          <Figure
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

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}

function PaymentRequestForm({
  request,
  target,
  currencyCode,
  allowance,
  onClose
}: {
  request: PaymentRequestRow | null;
  target: Target;
  currencyCode: string;
  /** From the API; the operation refuses a larger amount all the same. */
  allowance: number;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const formatter = useCurrencyFormatter({ currency: currencyCode });
  // One key per opened form: a double submit creates one request.
  const [idempotencyKey] = useState(() => nanoid());
  const fetcher = useAction<typeof paymentRequestAction>({
    onSuccess: () => {
      toast.success(request ? t`Request updated` : t`Request added`);
      onClose();
    }
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          method="post"
          action={path.to.paymentRequestAction}
          validator={paymentRequestValidator}
          fetcher={fetcher}
          defaultValues={{
            id: request?.id,
            ...target,
            amount:
              request?.amount == null ? undefined : Number(request.amount),
            dueDate: request?.dueDate ?? undefined,
            description: request?.description ?? undefined,
            status:
              request?.status === "Ready"
                ? ("Ready" as const)
                : ("Planned" as const)
          }}
        >
          <ModalHeader>
            <ModalTitle>
              {request ? (
                <Trans>Edit request {request.requestNumber}</Trans>
              ) : (
                <Trans>Add payment request</Trans>
              )}
            </ModalTitle>
            <ModalDescription>
              <Trans>
                Up to {formatter.format(allowance)} can still be requested.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            <Hidden name="intent" value="save" />
            <Hidden name="id" />
            {"purchaseInvoiceId" in target ? (
              <Hidden name="purchaseInvoiceId" />
            ) : (
              <Hidden name="purchaseOrderId" />
            )}
            {!request && (
              <Hidden name="idempotencyKey" value={idempotencyKey} />
            )}
            <NumberField
              name="amount"
              label={t`Amount`}
              formatOptions={INPUT_FORMAT.money(currencyCode, 2)}
            />
            <DatePicker name="dueDate" label={t`Due date`} />
            <Select
              name="status"
              label={t`Status`}
              options={[
                { value: "Planned", label: t`Planned: expected, not yet due` },
                { value: "Ready", label: t`Ready: due, send to Ramp` }
              ]}
            />
            <TextArea name="description" label={t`Description`} />
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button type="button" variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit withBlocker={false}>
                <Trans>Save</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
