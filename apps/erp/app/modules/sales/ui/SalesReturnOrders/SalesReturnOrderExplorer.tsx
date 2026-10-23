// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
  useDisclosure,
  VStack
} from "@carbon/react";
import { distinctItemText } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuChevronDown,
  LuCirclePlus,
  LuClipboardCheck,
  LuEllipsisVertical,
  LuFileInput,
  LuGitCompare,
  LuReceipt,
  LuTrash,
  LuTruck,
  LuWrench
} from "react-icons/lu";
import {
  Link,
  useFetcher,
  useNavigate,
  useNavigation,
  useParams,
  useSubmit
} from "react-router";
import { Empty, ItemThumbnail } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import Confirm from "~/components/Modals/Confirm/Confirm";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import ServiceJobStatus from "~/modules/service/ui/ServiceJob/ServiceJobStatus";
import { EXPLORER_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";
import {
  isSalesReturnOrderLocked,
  isServiceReturnLine,
  liveServiceJob,
  salesReturnDispositionType,
  type salesReturnOrderNextStepActions
} from "../../sales.models";
import AddFromAssetsModal from "./AddFromAssetsModal";
import ReturnableLinesModal from "./ReturnableLinesModal";
import SalesReturnOrderLineForm from "./SalesReturnOrderLineForm";
import type { SalesReturnOrder, SalesReturnOrderLine } from "./types";

export default function SalesReturnOrderExplorer() {
  const { t } = useLingui();
  const { id: orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const routeData = useRouteData<{
    salesReturnOrder: SalesReturnOrder;
    lines: SalesReturnOrderLine[];
  }>(path.to.salesReturnOrder(orderId));
  const permissions = usePermissions();

  const chooseSourceDisclosure = useDisclosure();
  const newLineDisclosure = useDisclosure();
  const fromDocumentDisclosure = useDisclosure();
  const fromAssetsDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<SalesReturnOrderLine | null>(
    null
  );

  const canAddFromShipment = !!routeData?.salesReturnOrder?.customerId;

  const onChooseManual = () => {
    chooseSourceDisclosure.onClose();
    newLineDisclosure.onOpen();
  };

  const onChooseFromShipment = () => {
    chooseSourceDisclosure.onClose();
    fromDocumentDisclosure.onOpen();
  };

  const onChooseFromAssets = () => {
    chooseSourceDisclosure.onClose();
    fromAssetsDisclosure.onOpen();
  };

  const isLocked = isSalesReturnOrderLocked(
    routeData?.salesReturnOrder?.status
  );
  const isDisabled = isLocked || !permissions.can("update", "sales");

  const lineInitialValues = {
    salesReturnOrderId: orderId,
    itemId: "",
    quantity: 1,
    unitOfMeasureCode: "",
    unitPrice: 0,
    restockFeePercent: 0
  };

  const onDeleteLine = (line: SalesReturnOrderLine) => {
    setDeleteLine(line);
    deleteLineDisclosure.onOpen();
  };

  const onDeleteCancel = () => {
    setDeleteLine(null);
    deleteLineDisclosure.onClose();
  };

  const lines = routeData?.lines ?? [];

  return (
    <>
      <VStack className="w-full h-[calc(100dvh-var(--topbar-height)-var(--header-height)-var(--content-inset))] justify-between">
        <VStack
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {lines.length > 0 ? (
            lines.map((line) => (
              <SalesReturnOrderLineItem
                key={line.id}
                isDisabled={isDisabled}
                line={line}
                onDelete={onDeleteLine}
              />
            ))
          ) : (
            <Empty>
              {permissions.can("update", "sales") && (
                <Button
                  isDisabled={isDisabled}
                  leftIcon={<LuCirclePlus />}
                  variant="secondary"
                  onClick={chooseSourceDisclosure.onOpen}
                >
                  <Trans>Add Line Item</Trans>
                </Button>
              )}
            </Empty>
          )}
        </VStack>
        <div className="w-full flex border-t border-border p-4">
          <Button
            className="flex-1"
            shortcut={EXPLORER_SHORTCUTS.addLine}
            isDisabled={isDisabled}
            leftIcon={<LuCirclePlus />}
            variant="secondary"
            onClick={chooseSourceDisclosure.onOpen}
          >
            <Trans>Add Line Item</Trans>
          </Button>
        </div>
      </VStack>
      {chooseSourceDisclosure.isOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) chooseSourceDisclosure.onClose();
          }}
        >
          <ModalContent size="small">
            <ModalHeader>
              <ModalTitle>
                <Trans>Add Line Item</Trans>
              </ModalTitle>
              <ModalDescription>
                <Trans>Choose how to add lines to this return.</Trans>
              </ModalDescription>
            </ModalHeader>
            <ModalBody>
              <VStack spacing={2}>
                <button
                  type="button"
                  className="w-full flex items-start gap-3 p-3 border rounded-lg text-left hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!canAddFromShipment}
                  onClick={onChooseFromShipment}
                >
                  <LuFileInput className="mt-0.5 size-5 text-muted-foreground shrink-0" />
                  <VStack spacing={0} className="min-w-0">
                    <span className="text-sm font-medium">
                      <Trans>Add from shipment</Trans>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {canAddFromShipment ? (
                        <Trans>
                          Select posted shipment lines to this customer to
                          return.
                        </Trans>
                      ) : (
                        <Trans>
                          Set a customer on this return to add from a shipment.
                        </Trans>
                      )}
                    </span>
                  </VStack>
                </button>
                <button
                  type="button"
                  className="w-full flex items-start gap-3 p-3 border rounded-lg text-left hover:bg-accent/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!canAddFromShipment}
                  onClick={onChooseFromAssets}
                >
                  <LuWrench className="mt-0.5 size-5 text-muted-foreground shrink-0" />
                  <VStack spacing={0} className="min-w-0">
                    <span className="text-sm font-medium">
                      <Trans>Add from assets</Trans>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {canAddFromShipment ? (
                        <Trans>
                          Select the customer's units to service or replace
                          under warranty.
                        </Trans>
                      ) : (
                        <Trans>
                          Set a customer on this return to add from its assets.
                        </Trans>
                      )}
                    </span>
                  </VStack>
                </button>
                <button
                  type="button"
                  className="w-full flex items-start gap-3 p-3 border rounded-lg text-left hover:bg-accent/50"
                  onClick={onChooseManual}
                >
                  <LuCirclePlus className="mt-0.5 size-5 text-muted-foreground shrink-0" />
                  <VStack spacing={0} className="min-w-0">
                    <span className="text-sm font-medium">
                      <Trans>Add manually</Trans>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <Trans>Enter an item and quantity yourself.</Trans>
                    </span>
                  </VStack>
                </button>
              </VStack>
            </ModalBody>
          </ModalContent>
        </Modal>
      )}
      {newLineDisclosure.isOpen && (
        <SalesReturnOrderLineForm
          initialValues={lineInitialValues}
          type="modal"
          onClose={newLineDisclosure.onClose}
        />
      )}
      {fromDocumentDisclosure.isOpen &&
        routeData?.salesReturnOrder?.customerId && (
          <ReturnableLinesModal
            customerId={routeData.salesReturnOrder.customerId}
            salesOrderId={routeData.salesReturnOrder.salesOrderId}
            onClose={fromDocumentDisclosure.onClose}
          />
        )}
      {fromAssetsDisclosure.isOpen && (
        <AddFromAssetsModal onClose={fromAssetsDisclosure.onClose} />
      )}
      {deleteLineDisclosure.isOpen && deleteLine && (
        <ConfirmDelete
          action={path.to.deleteSalesReturnOrderLine(orderId, deleteLine.id!)}
          name={deleteLine.item?.readableIdWithRevision ?? t`Line`}
          text={t`Are you sure you want to delete this return order line? This cannot be undone.`}
          onCancel={onDeleteCancel}
          onSubmit={onDeleteCancel}
        />
      )}
    </>
  );
}

type SalesReturnOrderLineItemProps = {
  line: SalesReturnOrderLine;
  isDisabled: boolean;
  onDelete: (line: SalesReturnOrderLine) => void;
};

function SalesReturnOrderLineItem({
  line,
  isDisabled,
  onDelete
}: SalesReturnOrderLineItemProps) {
  const { t } = useLingui();
  const { id: orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const permissions = usePermissions();
  const disclosure = useDisclosure();
  const location = useOptimisticLocation();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const dispositionFetcher = useFetcher<{ success: boolean }>();
  const [nextStep, setNextStep] = useState<
    (typeof salesReturnOrderNextStepActions)[number] | null
  >(null);

  const returnTypeLabels = {
    "Return to Stock": t`Return to Stock`,
    "Return for Service": t`Return for Service`,
    "Return for Warranty": t`Return for Warranty`
  } as const;

  // What the line can do next. A Return to Stock line is dispositioned once
  // received; a serviced unit ships back or is scrapped once its job is done
  // or cancelled (it goes back unrepaired), or (a warranty unit found not
  // repairable) is replaced; a warranty that is denied moves the line and its
  // open job to Return for Service.
  const serviceJob = liveServiceJob(line.serviceJob);
  const isServiceLine = isServiceReturnLine(line.returnType);
  const isReceived = Number(line.quantityReceived ?? 0) > 0;
  const isJobDone =
    serviceJob?.status === "Completed" ||
    serviceJob?.status === "Invoiced" ||
    serviceJob?.status === "Cancelled";
  const isUnitOut =
    Number(line.quantityShipped ?? 0) > 0 || line.disposition === "Scrap";
  const canDispose = !isServiceLine && isReceived;
  const canShipBack = isServiceLine && isReceived && isJobDone && !isUnitOut;
  const canReplace =
    line.returnType === "Return for Warranty" &&
    serviceJob?.status === "Completed" &&
    serviceJob.repairable === false &&
    !isUnitOut;
  const canChangeToService =
    line.returnType === "Return for Warranty" &&
    !!serviceJob &&
    !["Completed", "Invoiced", "Cancelled"].includes(serviceJob.status);

  const onDisposition = (value: string) => {
    const formData = new FormData();
    formData.append("lineId", line.id!);
    formData.append("disposition", value);
    dispositionFetcher.submit(formData, {
      method: "post",
      action:
        value === "Scrap" || value === "Rework"
          ? path.to.salesReturnOrderLineIssue(orderId, line.id!)
          : path.to.salesReturnOrderLineDisposition(orderId, line.id!)
    });
  };

  // The RMA shipment, as for a Return to Customer line.
  const shipBack = () => {
    const formData = new FormData();
    formData.set("sourceDocument", "Sales Return Order");
    formData.set("sourceDocumentId", orderId);
    submit(formData, { method: "post", action: path.to.newShipment });
  };

  const nextStepCopy = nextStep
    ? {
        Scrap: {
          title: t`Scrap the unit`,
          text: t`The unit is scrapped with the customer's consent and does not ship back. It was never in stock, so nothing posts.`,
          confirmText: t`Scrap`
        },
        Replace: {
          title: t`No-charge replacement`,
          text: t`A replacement at no charge is added to the return's replacement order. Its cost goes to warranty expense when it ships. Scrap the old unit afterwards.`,
          confirmText: t`Create Replacement`
        },
        "Change to Service": {
          title: t`Change to Return for Service`,
          text: t`The warranty is denied. The line becomes a Return for Service and its service job becomes Billable.`,
          confirmText: t`Change`
        }
      }[nextStep]
    : null;

  const isSelected =
    location.pathname === path.to.salesReturnOrderLine(orderId, line.id!);

  const onLineClick = () => {
    if (!isSelected) {
      navigate(path.to.salesReturnOrderLine(orderId, line.id!));
    }
  };

  return (
    <VStack spacing={0} className="border-b">
      <HStack
        className={cn(
          "group w-full p-2 items-center hover:bg-accent/30 cursor-pointer relative",
          isSelected && "bg-accent/60 hover:bg-accent/50"
        )}
        onClick={onLineClick}
      >
        <HStack spacing={2} className="flex-grow min-w-0 pr-10">
          <ItemThumbnail thumbnailPath={line.item?.thumbnailPath} type="Part" />
          <VStack spacing={0} className="min-w-0">
            <span className="font-semibold line-clamp-1">
              {line.item?.readableIdWithRevision}
            </span>
            {distinctItemText(
              line.item?.readableIdWithRevision,
              line.item?.name
            ) && (
              <span className="text-muted-foreground text-xs truncate line-clamp-1">
                {line.item?.name}
              </span>
            )}
            {isServiceLine && (
              <span className="text-muted-foreground text-xs truncate line-clamp-1">
                {returnTypeLabels[line.returnType]}
              </span>
            )}
            {serviceJob && (
              <HStack spacing={1} className="min-w-0 flex-wrap">
                <Link
                  to={path.to.serviceJob(serviceJob.id)}
                  className="text-xs font-medium whitespace-nowrap hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {serviceJob.serviceJobId}
                </Link>
                <ServiceJobStatus status={serviceJob.status} />
              </HStack>
            )}
          </VStack>
        </HStack>
        <div className="absolute right-2">
          <HStack spacing={1}>
            <IconButton
              aria-label={disclosure.isOpen ? t`Hide` : t`Show`}
              className={cn(
                "animate md:opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100",
                disclosure.isOpen && "-rotate-180"
              )}
              icon={<LuChevronDown />}
              size="md"
              variant="solid"
              onClick={(e) => {
                e.stopPropagation();
                disclosure.onToggle();
              }}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More"
                  className="md:opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100"
                  icon={<LuEllipsisVertical />}
                  size="md"
                  variant="solid"
                  onClick={(e) => e.stopPropagation()}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {canDispose && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      disabled={
                        dispositionFetcher.state !== "idle" ||
                        !permissions.can("update", "sales")
                      }
                    >
                      <DropdownMenuIcon icon={<LuClipboardCheck />} />
                      <Trans>Disposition</Trans>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {salesReturnDispositionType
                        .filter((option) => option !== "Pending")
                        .map((option) => (
                          <DropdownMenuItem
                            key={option}
                            disabled={option === line.disposition}
                            onClick={(e) => {
                              e.stopPropagation();
                              onDisposition(option);
                            }}
                          >
                            {option}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                {canShipBack && (
                  <DropdownMenuItem
                    disabled={
                      navigation.state !== "idle" ||
                      !permissions.can("create", "inventory")
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      shipBack();
                    }}
                  >
                    <DropdownMenuIcon icon={<LuTruck />} />
                    <Trans>Ship Back</Trans>
                  </DropdownMenuItem>
                )}
                {canReplace && (
                  <DropdownMenuItem
                    disabled={!permissions.can("create", "sales")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNextStep("Replace");
                    }}
                  >
                    <DropdownMenuIcon icon={<LuGitCompare />} />
                    <Trans>No-charge Replacement</Trans>
                  </DropdownMenuItem>
                )}
                {canShipBack && (
                  <DropdownMenuItem
                    destructive
                    disabled={!permissions.can("update", "sales")}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNextStep("Scrap");
                    }}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    <Trans>Scrap Unit</Trans>
                  </DropdownMenuItem>
                )}
                {canChangeToService && (
                  <DropdownMenuItem
                    disabled={
                      !permissions.can("update", "sales") ||
                      !permissions.can("update", "service")
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setNextStep("Change to Service");
                    }}
                  >
                    <DropdownMenuIcon icon={<LuReceipt />} />
                    <Trans>Change to Return for Service</Trans>
                  </DropdownMenuItem>
                )}
                {(canDispose ||
                  canShipBack ||
                  canReplace ||
                  canChangeToService) && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  shortcut={MENU_ITEM_SHORTCUTS.delete}
                  destructive
                  disabled={isDisabled || !permissions.can("delete", "sales")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(line);
                  }}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Line</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </div>
      </HStack>
      {disclosure.isOpen && (
        <VStack
          spacing={1}
          className="border-b border-border px-3 py-2 text-xs"
        >
          <HStack className="w-full justify-between">
            <span className="text-muted-foreground">
              <Trans>Received</Trans>
            </span>
            <span className="tabular-nums">
              {line.quantityReceived ?? 0} / {line.quantity ?? 0}
            </span>
          </HStack>
          {line.returnReason?.name && (
            <HStack className="w-full justify-between">
              <span className="text-muted-foreground">
                <Trans>Reason</Trans>
              </span>
              <span>{line.returnReason.name}</span>
            </HStack>
          )}
          {line.disposition && line.disposition !== "Pending" && (
            <HStack className="w-full justify-between">
              <span className="text-muted-foreground">
                <Trans>Disposition</Trans>
              </span>
              <Badge variant="secondary">{line.disposition}</Badge>
            </HStack>
          )}
        </VStack>
      )}
      {nextStep && nextStepCopy && (
        <Confirm
          action={path.to.salesReturnOrderLineNextStep(orderId, line.id!)}
          title={nextStepCopy.title}
          text={nextStepCopy.text}
          confirmText={nextStepCopy.confirmText}
          confirmVariant={nextStep === "Scrap" ? "destructive" : "primary"}
          onCancel={() => setNextStep(null)}
          onSubmit={() => setNextStep(null)}
        >
          <input type="hidden" name="action" value={nextStep} />
        </Confirm>
      )}
    </VStack>
  );
}
