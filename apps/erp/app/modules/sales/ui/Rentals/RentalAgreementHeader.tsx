import {
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  LuCircleCheck,
  LuCircleStop,
  LuCreditCard,
  LuPlay,
  LuTrash
} from "react-icons/lu";
import { Link } from "react-router";
import { DocumentHeader } from "~/components";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { useCompanyToday, useDateFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { RentalCommencementPreview } from "./RentalLeaseClassification";
import RentalMoney from "./RentalMoney";
import RentalStatus from "./RentalStatus";
import type { RentalAgreementRouteData } from "./types";

type RentalAgreementHeaderProps = Pick<
  RentalAgreementRouteData,
  "rentalAgreement" | "lines" | "periods" | "leasePolicy" | "leaseInputs"
>;

type PendingAction = "activate" | "invoice" | "close" | "cancel";

const RentalAgreementHeader = ({
  rentalAgreement,
  lines,
  periods,
  leasePolicy,
  leaseInputs
}: RentalAgreementHeaderProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const { formatDate } = useDateFormatter();
  const today = useCompanyToday();

  const confirm = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const [action, setAction] = useState<PendingAction | null>(null);

  const id = rentalAgreement.id!;
  const readableId = rentalAgreement.rentalAgreementId ?? "";
  const status = rentalAgreement.status;
  const canUpdate = permissions.can("update", "sales");

  const isDraft = status === "Draft";
  const isActive = status === "Active";
  const hasLines = lines.length > 0;
  const allLinesBack = lines.every(
    (line) => line.status === "Returned" || line.status === "Sold"
  );
  const allPeriodsBilled = periods.every(
    (period) => period.status === "Invoiced"
  );
  const hasUnitOnRent = lines.some((line) => line.status === "On Rent");
  const hasInvoicedPeriod = periods.some(
    (period) => period.status === "Invoiced"
  );
  // A commenced sales-type lease has already derecognized its unit; undoing
  // that is a manual journal in v1, so cancel is refused (spec §4).
  const hasCommencedSalesTypeLine =
    !isDraft && lines.some((line) => line.lessorClassification === "Sale");
  // A unit still out past the end date keeps billing at the same rates.
  const isPastEndDate =
    isActive &&
    !!rentalAgreement.endDate &&
    rentalAgreement.endDate < today &&
    hasUnitOnRent;

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
      action: path.to.rentalAgreementActivate(id),
      title: t`Activate ${readableId}`,
      text: t`Activating checks every unit is available, snapshots each item's day, week and month rates onto its line, classifies the lease and cuts the first billing periods. The terms and lines are fixed afterwards.`,
      confirmText: t`Activate`
    },
    invoice: {
      action: path.to.rentalAgreementInvoice(id),
      title: t`Generate invoices for ${readableId}`,
      text: t`Draft a sales invoice for every billing period and charge due today, exactly as the daily billing job would.`,
      confirmText: t`Generate Invoices`
    },
    close: {
      action: path.to.rentalAgreementStatus(id),
      title: t`Close ${readableId}`,
      text: t`Closing finishes the agreement. Every unit must be returned or sold and every billing period invoiced.`,
      confirmText: t`Close Agreement`,
      intent: "close"
    },
    cancel: {
      action: path.to.rentalAgreementStatus(id),
      title: t`Cancel ${readableId}`,
      text: t`Cancelling voids the agreement and releases its units. An agreement with a unit on rent or an invoiced period cannot be cancelled.`,
      confirmText: t`Cancel Agreement`,
      intent: "cancel",
      destructive: true
    }
  };

  const current = action ? confirmProps[action] : null;

  return (
    <>
      <Card>
        <DocumentHeader
          title={readableId}
          subtitle={rentalAgreement.customerName ?? undefined}
          status={
            <>
              <RentalStatus status={status} />
              {isPastEndDate && (
                <Badge variant="orange">
                  <Trans>Past end date</Trans>
                </Badge>
              )}
            </>
          }
          menuItems={
            <DropdownMenuItem
              destructive
              disabled={!isDraft || !permissions.can("delete", "sales")}
              onClick={deleteDisclosure.onOpen}
            >
              <DropdownMenuIcon icon={<LuTrash />} />
              <Trans>Delete Agreement</Trans>
            </DropdownMenuItem>
          }
          actions={
            <>
              {isActive && (
                <Button
                  variant={allPeriodsBilled ? "secondary" : "primary"}
                  leftIcon={<LuCreditCard />}
                  isDisabled={!canUpdate}
                  onClick={() => open("invoice")}
                >
                  <Trans>Invoice</Trans>
                </Button>
              )}
              {(isDraft || isActive) &&
                (hasCommencedSalesTypeLine ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* A disabled button fires no pointer events, so the
                          span carries the tooltip. */}
                      <span tabIndex={0}>
                        <Button
                          variant="secondary"
                          leftIcon={<LuCircleStop />}
                          isDisabled
                        >
                          <Trans>Cancel</Trans>
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <Trans>
                        Ending a rental treated as a sale early is a manual
                        journal.
                      </Trans>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    variant="secondary"
                    leftIcon={<LuCircleStop />}
                    isDisabled={
                      !canUpdate || hasUnitOnRent || hasInvoicedPeriod
                    }
                    onClick={() => open("cancel")}
                  >
                    <Trans>Cancel</Trans>
                  </Button>
                ))}
              {isActive && (
                <Button
                  variant={allPeriodsBilled ? "primary" : "secondary"}
                  leftIcon={<LuCircleCheck />}
                  isDisabled={!canUpdate || !allLinesBack || !allPeriodsBilled}
                  onClick={() => open("close")}
                >
                  <Trans>Close</Trans>
                </Button>
              )}
              {isDraft && (
                <Button
                  variant="primary"
                  leftIcon={<LuPlay />}
                  isDisabled={!canUpdate || !hasLines}
                  onClick={() => open("activate")}
                >
                  <Trans>Activate</Trans>
                </Button>
              )}
            </>
          }
        />
        <CardContent className="space-y-0">
          <div className="grid grid-cols-1 gap-3 pb-4 sm:grid-cols-3 sm:gap-0">
            <Stat label={t`Deposit`} className="sm:pr-6">
              <RentalMoney
                value={rentalAgreement.depositAmount}
                currencyCode={rentalAgreement.currencyCode}
              />
            </Stat>
            <Stat
              label={t`Unbilled`}
              className="sm:border-l sm:border-border sm:px-6"
            >
              <RentalMoney
                value={rentalAgreement.unbilledAmount}
                currencyCode={rentalAgreement.currencyCode}
              />
            </Stat>
            <Stat
              label={t`Next Due`}
              className="sm:border-l sm:border-border sm:pl-6"
            >
              {rentalAgreement.nextDueOn
                ? formatDate(rentalAgreement.nextDueOn)
                : "—"}
            </Stat>
          </div>
          <div className="divide-y divide-border border-t border-border">
            <DetailRow label={t`Customer`}>
              {rentalAgreement.customerId ? (
                <Link
                  to={path.to.customer(rentalAgreement.customerId)}
                  className="hover:underline"
                >
                  {rentalAgreement.customerName}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label={t`Term`}>
              {formatDate(rentalAgreement.startDate)} –{" "}
              {rentalAgreement.endDate ? (
                formatDate(rentalAgreement.endDate)
              ) : (
                <Trans>Open-ended</Trans>
              )}
            </DetailRow>
            <DetailRow label={t`Billing Cycle`}>
              {rentalAgreement.billingCycle}
            </DetailRow>
            <DetailRow label={t`Billing Timing`}>
              {rentalAgreement.billingTiming}
            </DetailRow>
          </div>
        </CardContent>
      </Card>

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
              <RentalCommencementPreview
                rentalAgreement={rentalAgreement}
                lines={lines}
                leaseInputs={leaseInputs}
                leasePolicy={leasePolicy}
              />
            ) : undefined
          }
        >
          {current.intent && (
            <input type="hidden" name="intent" value={current.intent} />
          )}
        </Confirm>
      )}

      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteRentalAgreement(id)}
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

function Stat({
  label,
  className,
  children
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <p className="text-base text-muted-foreground truncate sm:text-sm">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {children}
      </p>
    </div>
  );
}

function DetailRow({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 text-base sm:text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}

export default RentalAgreementHeader;
