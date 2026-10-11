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
  LuChevronDown,
  LuCircleStop,
  LuCreditCard,
  LuEllipsisVertical,
  LuHandCoins,
  LuPanelLeft,
  LuPencilRuler,
  LuPlay,
  LuTrash,
  LuX
} from "react-icons/lu";
import { Link } from "react-router";
import { usePanels } from "~/components/Layout";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { useCompanyToday, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  LeaseCommencementPreview,
  LesseeClassificationBadge
} from "./LeaseClassificationPreview";
import LeaseModifyModal from "./LeaseModifyModal";
import LeasePurchaseModal from "./LeasePurchaseModal";
import LeaseStatus from "./LeaseStatus";
import LeaseTerminateModal from "./LeaseTerminateModal";
import type { LeaseRouteData } from "./types";

type LeaseHeaderProps = Pick<
  LeaseRouteData,
  "lease" | "payments" | "schedule" | "leasePolicy"
>;

type PendingAction = "activate" | "invoice" | "cancel";
type LifecycleAction = "modify" | "terminate" | "purchase";

const LeaseHeader = ({
  lease,
  payments,
  schedule,
  leasePolicy
}: LeaseHeaderProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { toggleExplorer } = usePanels();
  const today = useCompanyToday();

  const confirm = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const [action, setAction] = useState<PendingAction | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleAction | null>(null);

  const id = lease.id!;
  const readableId = lease.leaseId ?? "";
  const status = lease.status;
  const isDraft = status === "Draft";
  const isActive = status === "Active";
  const canUpdate = permissions.can("update", "purchasing");
  // Invoicing drafts purchase invoices, so it needs the invoicing permission.
  const canInvoice = canUpdate && permissions.can("create", "invoicing");

  const hasDuePayment = payments.some(
    (payment) => payment.status === "Pending" && payment.dueDate <= today
  );
  // Cancel is refused once anything is invoiced or a lease run has posted.
  const hasInvoicedPayment = payments.some(
    (payment) => payment.status === "Invoiced"
  );
  const hasPostedMonth = schedule.some((line) =>
    (line.rows ?? []).some((row) => row.status === "Posted")
  );
  const canCancel = isActive && !hasInvoicedPayment && !hasPostedMonth;
  const hasPurchaseOption =
    Number(lease.purchaseOptionAmount ?? 0) > 0 &&
    lease.lesseeClassification !== "Short-Term";

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
    activate: {
      action: path.to.leaseActivate(id),
      title: t`Activate ${readableId}`,
      text: t`Activating classifies the lease, books the right-of-use asset and the lease liability, and writes the monthly schedule. The terms and payment rows are fixed afterwards.`,
      confirmText: t`Activate`
    },
    invoice: {
      action: path.to.leaseInvoice(id),
      title: t`Invoice ${readableId} now?`,
      text: t`Draft purchase invoices are created every day for the payments that are due. Use this to draft the due payments right away.`,
      confirmText: t`Invoice`
    },
    cancel: {
      action: path.to.leaseStatus(id),
      title: t`Cancel ${readableId}`,
      text: t`Cancelling voids the commencement journal and removes the schedule. A lease with an invoiced payment or a posted lease run cannot be cancelled; terminate it instead.`,
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
            {lease.lesseeClassification && (
              <LesseeClassificationBadge value={lease.lesseeClassification} />
            )}
          </HStack>
          <HStack>
            {isActive && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    leftIcon={<LuPencilRuler />}
                    rightIcon={<LuChevronDown />}
                    isDisabled={!canUpdate}
                  >
                    <Trans>Change Lease</Trans>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setLifecycle("modify")}>
                    <DropdownMenuIcon icon={<LuPencilRuler />} />
                    <Trans>Modify</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLifecycle("terminate")}>
                    <DropdownMenuIcon icon={<LuCircleStop />} />
                    <Trans>Terminate</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!hasPurchaseOption}
                    onClick={() => setLifecycle("purchase")}
                  >
                    <DropdownMenuIcon icon={<LuHandCoins />} />
                    <Trans>Exercise Purchase Option</Trans>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {isActive && (
              <Button
                variant={hasDuePayment ? "primary" : "secondary"}
                leftIcon={<LuCreditCard />}
                isDisabled={!canInvoice || !hasDuePayment}
                onClick={() => open("invoice")}
              >
                <Trans>Invoice Now</Trans>
              </Button>
            )}
            {isDraft && (
              <Button
                variant="primary"
                leftIcon={<LuPlay />}
                isDisabled={!canUpdate || payments.length === 0}
                onClick={() => open("activate")}
              >
                <Trans>Activate</Trans>
              </Button>
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
          details={
            action === "activate" ? (
              <LeaseCommencementPreview
                lease={lease}
                payments={payments}
                policy={leasePolicy}
              />
            ) : undefined
          }
        >
          {current.intent && (
            <input type="hidden" name="intent" value={current.intent} />
          )}
        </Confirm>
      )}

      {lifecycle === "modify" && (
        <LeaseModifyModal
          lease={lease}
          schedule={schedule}
          onClose={() => setLifecycle(null)}
        />
      )}
      {lifecycle === "terminate" && (
        <LeaseTerminateModal
          lease={lease}
          schedule={schedule}
          onClose={() => setLifecycle(null)}
        />
      )}
      {lifecycle === "purchase" && (
        <LeasePurchaseModal
          lease={lease}
          schedule={schedule}
          onClose={() => setLifecycle(null)}
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
