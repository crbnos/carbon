// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuChevronDown,
  LuCircleCheck,
  LuCirclePlus,
  LuCircleStop,
  LuCreditCard,
  LuEllipsisVertical,
  LuListChecks,
  LuPackageCheck,
  LuPanelLeft,
  LuPlay,
  LuTrash,
  LuTruck
} from "react-icons/lu";
import { Link, useSubmit } from "react-router";
import { usePanels } from "~/components/Layout";
import { Confirm, ConfirmDelete } from "~/components/Modals";
import { useCompanyToday, usePermissions } from "~/hooks";
import { ReceiptStatus } from "~/modules/inventory/ui/Receipts";
import { ShipmentStatus } from "~/modules/inventory/ui/Shipments";
import { path } from "~/utils/path";
import { rentalEquipmentStatus } from "../../sales.utils";
import { RentalCommencementPreview } from "./RentalLeaseClassification";
import RentalStatus, { RentalEquipmentStatusBadge } from "./RentalStatus";
import type { RentalAgreementRouteData } from "./types";

type RentalAgreementHeaderProps = Pick<
  RentalAgreementRouteData,
  | "rentalAgreement"
  | "lines"
  | "periods"
  | "leasePolicy"
  | "leaseInputs"
  | "shipments"
  | "receipts"
>;

type PendingAction = "activate" | "invoice" | "close" | "cancel";

const RentalAgreementHeader = ({
  rentalAgreement,
  lines,
  periods,
  leasePolicy,
  leaseInputs,
  shipments,
  receipts
}: RentalAgreementHeaderProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const submit = useSubmit();
  const { toggleExplorer } = usePanels();
  const today = useCompanyToday();

  const confirm = useDisclosure();
  const deleteDisclosure = useDisclosure();
  const [action, setAction] = useState<PendingAction | null>(null);

  const id = rentalAgreement.id!;
  const readableId = rentalAgreement.rentalAgreementId ?? "";
  const status = rentalAgreement.status;
  const canUpdate = permissions.can("update", "sales");
  // Invoicing drafts sales invoices, so it needs the invoicing permission too.
  const canInvoice = canUpdate && permissions.can("create", "invoicing");

  const isDraft = status === "Draft";
  const isActive = status === "Active";
  const hasLines = lines.length > 0;
  // Activation refuses a unit at no rate.
  const hasUnpricedUnit = lines.some((line) => Number(line.rate) <= 0);
  const allLinesBack = lines.every(
    (line) => line.status === "Returned" || line.status === "Sold"
  );
  const allPeriodsBilled = periods.every(
    (period) => period.status === "Invoiced"
  );
  const hasUnitOnRent = lines.some((line) => line.status === "On Rent");
  // Delivering and returning draft inventory documents.
  const canMoveUnits = canUpdate && permissions.can("create", "inventory");
  const hasPendingUnit = lines.some((line) => line.status === "Pending");
  // A receipt also holds Pending units (spec Q8).
  const canReturn = hasUnitOnRent || hasPendingUnit;
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

  // POST the agreement to the create route, which drafts the document (or
  // finds the open Draft) and redirects into it.
  const deliver = () => {
    const formData = new FormData();
    formData.set("sourceDocument", "Rental Agreement");
    formData.set("sourceDocumentId", id);
    submit(formData, { method: "post", action: path.to.newShipment });
  };
  const returnUnits = () => {
    const formData = new FormData();
    formData.set("sourceDocument", "Rental Agreement");
    formData.set("sourceDocumentId", id);
    submit(formData, { method: "post", action: path.to.newReceipt });
  };

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
      text: t`Activating checks every unit is available, classifies each unit's accounting treatment and cuts the first billing periods at each unit's rate. The terms and lines are fixed afterwards.`,
      confirmText: t`Activate`
    },
    invoice: {
      action: path.to.rentalAgreementInvoice(id),
      title: t`Invoice ${readableId} now?`,
      text: t`Invoices are created automatically every day for whatever is due. Use this to bill what's due right away — for example after adding a charge. Invoices then follow this agreement's invoicing setting.`,
      confirmText: t`Invoice`
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
      <div className="flex flex-shrink-0 items-center justify-between gap-x-4 p-2 bg-card border-b h-[var(--header-height)] overflow-x-auto scrollbar-hide">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label={t`Toggle Explorer`}
              icon={<LuPanelLeft />}
              onClick={toggleExplorer}
              variant="ghost"
            />
            <Link to={path.to.rentalAgreementDetails(id)}>
              <Heading size="h4" className="flex items-center gap-2">
                <span>{readableId}</span>
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
                <DropdownMenuItem
                  destructive
                  disabled={!isDraft || !permissions.can("delete", "sales")}
                  onClick={deleteDisclosure.onOpen}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Agreement</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <RentalStatus status={status} />
            {isActive && (
              <RentalEquipmentStatusBadge
                status={rentalEquipmentStatus(lines)}
              />
            )}
            {isPastEndDate && (
              <Badge variant="orange">
                <Trans>Past end date</Trans>
              </Badge>
            )}
          </HStack>
          <HStack>
            {isActive &&
              canMoveUnits &&
              (shipments.length === 0 ? (
                <Button
                  variant={hasPendingUnit ? "primary" : "secondary"}
                  leftIcon={<LuTruck />}
                  isDisabled={!hasPendingUnit}
                  onClick={deliver}
                >
                  <Trans>Deliver</Trans>
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      leftIcon={<LuTruck />}
                      variant={hasPendingUnit ? "primary" : "secondary"}
                      rightIcon={<LuChevronDown />}
                    >
                      <Trans>Shipments</Trans>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      disabled={!hasPendingUnit}
                      onClick={deliver}
                    >
                      <DropdownMenuIcon icon={<LuCirclePlus />} />
                      <Trans>New Shipment</Trans>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {shipments.map((shipment) => (
                      <DropdownMenuItem key={shipment.id} asChild>
                        <Link to={path.to.shipment(shipment.id)}>
                          <DropdownMenuIcon icon={<LuTruck />} />
                          <HStack spacing={8}>
                            <span>{shipment.shipmentId}</span>
                            <ShipmentStatus status={shipment.status} />
                          </HStack>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}
            {isActive &&
              canMoveUnits &&
              (receipts.length === 0 ? (
                <Button
                  variant="secondary"
                  leftIcon={<LuPackageCheck />}
                  isDisabled={!canReturn}
                  onClick={returnUnits}
                >
                  <Trans>Return</Trans>
                </Button>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      leftIcon={<LuPackageCheck />}
                      variant="secondary"
                      rightIcon={<LuChevronDown />}
                    >
                      <Trans>Receipts</Trans>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      disabled={!canReturn}
                      onClick={returnUnits}
                    >
                      <DropdownMenuIcon icon={<LuCirclePlus />} />
                      <Trans>New Receipt</Trans>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {receipts.map((receipt) => (
                      <DropdownMenuItem key={receipt.id} asChild>
                        <Link to={path.to.receipt(receipt.id)}>
                          <DropdownMenuIcon icon={<LuPackageCheck />} />
                          <HStack spacing={8}>
                            <span>{receipt.receiptId}</span>
                            <ReceiptStatus status={receipt.status} />
                          </HStack>
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ))}
            {isActive && (
              <Button
                variant="secondary"
                leftIcon={<LuCreditCard />}
                isDisabled={!canInvoice}
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
                  isDisabled={!canUpdate || hasUnitOnRent || hasInvoicedPeriod}
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
                variant="secondary"
                leftIcon={<LuListChecks />}
                isDisabled={!canUpdate}
                asChild
              >
                <Link to={path.to.rentalAgreementSetup(id, "units")}>
                  <Trans>Continue Setup</Trans>
                </Link>
              </Button>
            )}
            {isDraft && (
              <Button
                variant="primary"
                leftIcon={<LuPlay />}
                isDisabled={!canUpdate || !hasLines || hasUnpricedUnit}
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

export default RentalAgreementHeader;
