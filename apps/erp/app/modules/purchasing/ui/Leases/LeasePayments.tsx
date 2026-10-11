// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
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
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuCirclePlus,
  LuEllipsisVertical,
  LuPencil,
  LuRefreshCw,
  LuTrash
} from "react-icons/lu";
import { DateTime, Hyperlink } from "~/components";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { PurchaseInvoicingStatus } from "~/modules/invoicing/ui/PurchaseInvoice";
import { path } from "~/utils/path";
import LeaseMoney from "./LeaseMoney";
import LeasePaymentForm from "./LeasePaymentForm";
import { LeasePaymentStatus } from "./LeaseStatus";
import type { Lease, LeasePayment, LeasePaymentInvoiceLinks } from "./types";
import { useLeasePaymentTypeLabel } from "./useLeaseLabels";

type LeasePaymentsProps = {
  lease: Lease;
  payments: LeasePayment[];
  paymentInvoices: LeasePaymentInvoiceLinks;
};

/** The payment rows: what the lease pays and when. Editable while the lease
 *  is Draft (activation values the liability from these rows); afterwards
 *  each row shows its status and the purchase invoice that billed it. */
const LeasePayments = ({
  lease,
  payments,
  paymentInvoices
}: LeasePaymentsProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const paymentTypeLabel = useLeasePaymentTypeLabel();
  const leaseId = lease.id!;
  const currencyCode = lease.currencyCode ?? "";

  const isDraft = lease.status === "Draft";
  const canEdit = isDraft && permissions.can("update", "purchasing");

  const [editing, setEditing] = useState<LeasePayment | null>(null);
  const [deleting, setDeleting] = useState<LeasePayment | null>(null);
  const addDisclosure = useDisclosure();
  const regenerateDisclosure = useDisclosure();

  const total = payments.reduce(
    (sum, payment) => sum + Number(payment.amount),
    0
  );

  return (
    <>
      <Card id="payments">
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Payments</Trans>
            </CardTitle>
            <CardDescription>
              {isDraft ? (
                <Trans>
                  Cut from the payment terms. Change a row, add one or delete
                  one before activating.
                </Trans>
              ) : (
                <Trans>
                  A purchase invoice is drafted for each payment on its due
                  date.
                </Trans>
              )}
            </CardDescription>
          </CardHeader>
          {isDraft && (
            <CardAction>
              <HStack>
                <Button
                  variant="secondary"
                  leftIcon={<LuRefreshCw />}
                  isDisabled={!canEdit}
                  onClick={regenerateDisclosure.onOpen}
                >
                  <Trans>Regenerate from Terms</Trans>
                </Button>
                <Button
                  variant="secondary"
                  leftIcon={<LuCirclePlus />}
                  isDisabled={!canEdit}
                  onClick={addDisclosure.onOpen}
                >
                  <Trans>Add Payment</Trans>
                </Button>
              </HStack>
            </CardAction>
          )}
        </HStack>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                No payment rows. Regenerate them from the terms or add one.
              </Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th className="text-right">#</Th>
                  <Th>
                    <Trans>Type</Trans>
                  </Th>
                  <Th>
                    <Trans>Period</Trans>
                  </Th>
                  <Th>
                    <Trans>Due</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Amount</Trans>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                  <Th>
                    <Trans>Invoice</Trans>
                  </Th>
                  {canEdit && <Th className="w-8" />}
                </Tr>
              </Thead>
              <Tbody>
                {payments.map((payment, index) => {
                  const invoice = payment.purchaseInvoiceLineId
                    ? paymentInvoices[payment.purchaseInvoiceLineId]
                    : undefined;
                  return (
                    <Tr key={payment.id}>
                      <Td className="text-right tabular-nums text-muted-foreground">
                        {index + 1}
                      </Td>
                      <Td>{paymentTypeLabel(payment.paymentType)}</Td>
                      <Td>
                        <span className="whitespace-nowrap">
                          <DateTime
                            value={payment.periodStart}
                            variant="date"
                          />
                          {" – "}
                          <DateTime value={payment.periodEnd} variant="date" />
                        </span>
                      </Td>
                      <Td>
                        <DateTime value={payment.dueDate} variant="date" />
                      </Td>
                      <Td className="text-right">
                        <LeaseMoney
                          value={payment.amount}
                          currencyCode={currencyCode}
                        />
                      </Td>
                      <Td>
                        <LeasePaymentStatus status={payment.status} />
                      </Td>
                      <Td>
                        {invoice ? (
                          <HStack spacing={2}>
                            <Hyperlink
                              to={path.to.purchaseInvoiceDetails(invoice.id)}
                            >
                              {invoice.invoiceId ?? t`Invoice`}
                            </Hyperlink>
                            <PurchaseInvoicingStatus
                              status={
                                invoice.status as Parameters<
                                  typeof PurchaseInvoicingStatus
                                >[0]["status"]
                              }
                            />
                          </HStack>
                        ) : (
                          "—"
                        )}
                      </Td>
                      {canEdit && (
                        <Td>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton
                                aria-label={t`Payment actions`}
                                icon={<LuEllipsisVertical />}
                                size="sm"
                                variant="ghost"
                              />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => setEditing(payment)}
                              >
                                <DropdownMenuIcon icon={<LuPencil />} />
                                <Trans>Edit Payment</Trans>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                destructive
                                onClick={() => setDeleting(payment)}
                              >
                                <DropdownMenuIcon icon={<LuTrash />} />
                                <Trans>Delete Payment</Trans>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </Td>
                      )}
                    </Tr>
                  );
                })}
                <Tr>
                  <Td />
                  <Td className="font-medium">
                    <Trans>Total</Trans>
                  </Td>
                  <Td />
                  <Td />
                  <Td className="text-right font-medium">
                    <LeaseMoney value={total} currencyCode={currencyCode} />
                  </Td>
                  <Td />
                  <Td />
                  {canEdit && <Td />}
                </Tr>
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {addDisclosure.isOpen && (
        <LeasePaymentForm
          initialValues={{
            leaseId,
            paymentType: "Rent",
            periodStart: lease.commencementDate ?? "",
            periodEnd: lease.commencementDate ?? "",
            dueDate: lease.commencementDate ?? "",
            amount: Number(lease.paymentAmount ?? 0)
          }}
          currencyCode={currencyCode}
          onClose={addDisclosure.onClose}
        />
      )}

      {editing && (
        <LeasePaymentForm
          initialValues={{
            id: editing.id,
            leaseId,
            paymentType: editing.paymentType,
            periodStart: editing.periodStart,
            periodEnd: editing.periodEnd,
            dueDate: editing.dueDate,
            amount: Number(editing.amount)
          }}
          currencyCode={currencyCode}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDelete
          action={path.to.leasePaymentDelete(leaseId, deleting.id)}
          isOpen
          name={t`this payment`}
          text={t`Are you sure you want to delete this payment row?`}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}

      {regenerateDisclosure.isOpen && (
        <Confirm
          action={path.to.leasePaymentsRegenerate(leaseId)}
          title={t`Regenerate payments from the terms?`}
          text={t`Every payment row is cut again from the payment terms. Rows you edited, added or deleted are replaced.`}
          confirmText={t`Regenerate`}
          confirmVariant="destructive"
          onCancel={regenerateDisclosure.onClose}
          onSubmit={regenerateDisclosure.onClose}
        />
      )}
    </>
  );
};

export default LeasePayments;
