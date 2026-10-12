// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuBookOpen,
  LuChevronDown,
  LuCirclePlus,
  LuCreditCard,
  LuEllipsisVertical,
  LuPanelLeft,
  LuPencilRuler,
  LuTrash,
  LuX
} from "react-icons/lu";
import { Link } from "react-router";
import { usePanels } from "~/components/Layout";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import {
  useCompanyToday,
  useDateFormatter,
  usePermissions,
  useRouteData
} from "~/hooks";
import { path } from "~/utils/path";
import LeaseInvoiceStatus from "./LeaseInvoiceStatus";
import LeaseModifyModal from "./LeaseModifyModal";
import LeaseStatus from "./LeaseStatus";
import { LesseeClassificationBadge } from "./LesseeClassificationBadge";
import type { LeaseRouteData } from "./types";
import { canCancelLease } from "./utils";

type LeaseHeaderProps = Pick<
  LeaseRouteData,
  | "lease"
  | "lines"
  | "payments"
  | "schedule"
  | "leasePolicy"
  | "purchaseInvoices"
  | "journals"
>;

type PendingAction = "invoice" | "cancel";

/** The lease's actions once it is set up: Modify and Cancel an Active lease,
 *  and Invoice Now while payments can still come due (Active, or ended with
 *  rows to bill). A Draft is activated from its setup. Terminate and
 *  Purchase act on one asset, from its page. The purchase invoices and
 *  journals that name the lease are listed here, as a rental agreement lists
 *  its shipments. */
const LeaseHeader = ({
  lease,
  lines,
  payments,
  schedule,
  purchaseInvoices,
  journals
}: LeaseHeaderProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { toggleExplorer } = usePanels();
  const today = useCompanyToday();
  const { formatDate } = useDateFormatter();

  const confirm = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const [action, setAction] = useState<PendingAction | null>(null);
  const modify = useDisclosure();

  const id = lease.id!;
  // The events are read by the shell route with the rest of the lease.
  const events = useRouteData<LeaseRouteData>(path.to.lease(id))?.events ?? [];
  const readableId = lease.leaseId ?? "";
  const status = lease.status;
  const isDraft = status === "Draft";
  const isActive = status === "Active";
  const canUpdate = permissions.can("update", "purchasing");
  // Invoicing drafts purchase invoices, so it needs the invoicing permission.
  const canInvoice = canUpdate && permissions.can("create", "invoicing");
  // `create-lease-invoices` bills an Active lease and an ended one (its last
  // rows can come due after it ends); never a Draft or a Cancelled one.
  const isBillable = !isDraft && status !== "Cancelled";

  const hasDuePayment = payments.some(
    (payment) => payment.status === "Pending" && payment.dueDate <= today
  );
  const canCancel = canCancelLease({
    lease,
    lines,
    payments,
    schedule,
    events
  });

  const open = (next: PendingAction) => {
    setAction(next);
    confirm.onOpen();
  };

  const confirmProps: Record<
    PendingAction,
    {
      action: string;
      title: string;
      text: string;
      confirmText: string;
      intent?: string;
      destructive?: boolean;
    }
  > = {
    invoice: {
      action: path.to.leaseInvoice(id),
      title: t`Invoice ${readableId} now?`,
      text: t`Draft purchase invoices are created every day for the payments that are due. Use this to draft the due payments right away.`,
      confirmText: t`Invoice`
    },
    cancel: {
      action: path.to.leaseStatus(id),
      title: t`Cancel ${readableId}`,
      text: t`Cancelling voids the lease's journal and removes the schedule. Once a payment is invoiced, a lease run has posted, or the lease has been modified or an asset ended, it cannot be cancelled; terminate its assets instead.`,
      confirmText: t`Cancel Lease`,
      intent: "cancel",
      destructive: true
    }
  };

  const current = action ? confirmProps[action] : null;

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-x-4 p-2 bg-card border-b h-[var(--header-height)] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label={t`Toggle Explorer`}
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.leaseDetails(id)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span className="whitespace-nowrap">{readableId}</span>
              </Heading>
            </Link>
            <Copy text={readableId} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label={t`More options`}
                  icon={<LuEllipsisVertical />}
                  variant="secondary"
                  size="sm"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {isActive && (
                  <>
                    <DropdownMenuItem
                      destructive
                      disabled={!canUpdate || !canCancel}
                      onClick={() => open("cancel")}
                    >
                      <DropdownMenuIcon icon={<LuX />} />
                      <Trans>Cancel Lease</Trans>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  destructive
                  disabled={
                    !isDraft || !permissions.can("delete", "purchasing")
                  }
                  onClick={deleteDisclosure.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Lease</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <LeaseStatus status={status} />
            {lease.classification && lease.classification !== "Mixed" && (
              <LesseeClassificationBadge value={lease.classification} />
            )}
          </HStack>
          <HStack>
            {isActive && lease.endDate && (
              <Button
                variant="secondary"
                leftIcon={<LuPencilRuler />}
                isDisabled={!canUpdate}
                onClick={modify.onOpen}
              >
                <Trans>Modify</Trans>
              </Button>
            )}
            {journals.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    leftIcon={<LuBookOpen />}
                    rightIcon={<LuChevronDown />}
                  >
                    <Trans>Journals</Trans>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {journals.map((journal) => (
                    <DropdownMenuItem key={journal.id} asChild>
                      <Link to={path.to.journalEntryDetails(journal.id)}>
                        <DropdownMenuIcon icon={<LuBookOpen />} />
                        <HStack spacing={8}>
                          <span>{journal.journalEntryId}</span>
                          <span className="text-muted-foreground">
                            {formatDate(journal.postingDate)}
                          </span>
                        </HStack>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {purchaseInvoices.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={
                      isBillable && hasDuePayment ? "primary" : "secondary"
                    }
                    leftIcon={<LuCreditCard />}
                    rightIcon={<LuChevronDown />}
                  >
                    <Trans>Purchase Invoices</Trans>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {isBillable && (
                    <>
                      <DropdownMenuItem
                        disabled={!canInvoice || !hasDuePayment}
                        onClick={() => open("invoice")}
                      >
                        <DropdownMenuIcon icon={<LuCirclePlus />} />
                        <Trans>Invoice Now</Trans>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {purchaseInvoices.map((invoice) => (
                    <DropdownMenuItem key={invoice.id} asChild>
                      <Link to={path.to.purchaseInvoiceDetails(invoice.id)}>
                        <DropdownMenuIcon icon={<LuCreditCard />} />
                        <HStack spacing={8}>
                          <span>{invoice.invoiceId}</span>
                          <LeaseInvoiceStatus status={invoice.status} />
                        </HStack>
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              isBillable && (
                <Button
                  variant={hasDuePayment ? "primary" : "secondary"}
                  leftIcon={<LuCreditCard />}
                  isDisabled={!canInvoice || !hasDuePayment}
                  onClick={() => open("invoice")}
                >
                  <Trans>Invoice Now</Trans>
                </Button>
              )
            )}
          </HStack>
        </HStack>
      </div>

      {current && confirm.isOpen && (
        <Confirm
          action={current.action}
          title={current.title}
          text={current.text}
          confirmText={current.confirmText}
          confirmVariant={current.destructive ? "destructive" : "primary"}
          onCancel={confirm.onClose}
          onSubmit={confirm.onClose}
        >
          {current.intent && (
            <input type="hidden" name="intent" value={current.intent} />
          )}
        </Confirm>
      )}

      {modify.isOpen && (
        <LeaseModifyModal
          lease={lease}
          lines={lines}
          payments={payments}
          schedule={schedule}
          onClose={modify.onClose}
        />
      )}

      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteLease(id)}
          isOpen={deleteDisclosure.isOpen}
          name={readableId}
          text={t`Are you sure you want to delete ${readableId}? This cannot be undone.`}
          onCancel={deleteDisclosure.onClose}
          onSubmit={deleteDisclosure.onClose}
        />
      )}
    </>
  );
};

export default LeaseHeader;
