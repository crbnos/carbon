import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  useDisclosure,
  useKeyboardShortcuts,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import {
  LuChevronDown,
  LuCirclePlus,
  LuEllipsisVertical,
  LuFileInput,
  LuTrash
} from "react-icons/lu";
import { useNavigate, useParams } from "react-router";
import { Empty, ItemThumbnail } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { isPurchaseReturnOrderLocked } from "../../purchasing.models";
import PurchaseReturnOrderLineForm from "./PurchaseReturnOrderLineForm";
import ReturnableReceiptLinesModal from "./ReturnableReceiptLinesModal";
import type { PurchaseReturnOrder, PurchaseReturnOrderLine } from "./types";

export default function PurchaseReturnOrderExplorer() {
  const { t } = useLingui();
  const { id: orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const routeData = useRouteData<{
    purchaseReturnOrder: PurchaseReturnOrder;
    lines: PurchaseReturnOrderLine[];
  }>(path.to.purchaseReturnOrder(orderId));
  const permissions = usePermissions();

  const newLineDisclosure = useDisclosure();
  const fromDocumentDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<PurchaseReturnOrderLine | null>(
    null
  );

  const isLocked = isPurchaseReturnOrderLocked(
    routeData?.purchaseReturnOrder?.status
  );
  const isDisabled = isLocked || !permissions.can("update", "purchasing");

  const lineInitialValues = {
    purchaseReturnOrderId: orderId,
    itemId: "",
    quantity: 1,
    unitOfMeasureCode: "",
    unitPrice: 0,
    restockFeePercent: 0
  };

  const onDeleteLine = (line: PurchaseReturnOrderLine) => {
    setDeleteLine(line);
    deleteLineDisclosure.onOpen();
  };

  const onDeleteCancel = () => {
    setDeleteLine(null);
    deleteLineDisclosure.onClose();
  };

  const newButtonRef = useRef<HTMLButtonElement>(null);
  useKeyboardShortcuts({
    "Command+Shift+l": (event: KeyboardEvent) => {
      event.stopPropagation();
      newButtonRef.current?.click();
    }
  });

  const lines = routeData?.lines ?? [];

  return (
    <>
      <VStack className="w-full h-[calc(100dvh-var(--topbar-height)-var(--header-height))] justify-between">
        <VStack
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
          spacing={0}
        >
          {lines.length > 0 ? (
            lines.map((line) => (
              <PurchaseReturnOrderLineItem
                key={line.id}
                isDisabled={isDisabled}
                line={line}
                onDelete={onDeleteLine}
              />
            ))
          ) : (
            <Empty>
              {permissions.can("update", "purchasing") && (
                <Button
                  isDisabled={isDisabled}
                  leftIcon={<LuCirclePlus />}
                  variant="secondary"
                  onClick={newLineDisclosure.onOpen}
                >
                  <Trans>Add Line Item</Trans>
                </Button>
              )}
            </Empty>
          )}
        </VStack>
        <div className="w-full flex border-t border-border p-4 gap-2">
          <Button
            ref={newButtonRef}
            className="flex-1"
            isDisabled={isDisabled}
            leftIcon={<LuCirclePlus />}
            variant="secondary"
            onClick={newLineDisclosure.onOpen}
          >
            <Trans>Add Line Item</Trans>
          </Button>
          <IconButton
            aria-label={t`Add lines from document`}
            icon={<LuFileInput />}
            variant="ghost"
            className="text-muted-foreground"
            isDisabled={
              isDisabled || !routeData?.purchaseReturnOrder?.supplierId
            }
            onClick={fromDocumentDisclosure.onOpen}
          />
        </div>
      </VStack>
      {newLineDisclosure.isOpen && (
        <PurchaseReturnOrderLineForm
          initialValues={lineInitialValues}
          type="modal"
          onClose={newLineDisclosure.onClose}
        />
      )}
      {fromDocumentDisclosure.isOpen &&
        routeData?.purchaseReturnOrder?.supplierId && (
          <ReturnableReceiptLinesModal
            supplierId={routeData.purchaseReturnOrder.supplierId}
            purchaseOrderId={routeData.purchaseReturnOrder.purchaseOrderId}
            onClose={fromDocumentDisclosure.onClose}
          />
        )}
      {deleteLineDisclosure.isOpen && deleteLine && (
        <ConfirmDelete
          action={path.to.deletePurchaseReturnOrderLine(
            orderId,
            deleteLine.id!
          )}
          name={deleteLine.item?.readableIdWithRevision ?? t`Line`}
          text={t`Are you sure you want to delete this return order line? This cannot be undone.`}
          onCancel={onDeleteCancel}
          onSubmit={onDeleteCancel}
        />
      )}
    </>
  );
}

type PurchaseReturnOrderLineItemProps = {
  line: PurchaseReturnOrderLine;
  isDisabled: boolean;
  onDelete: (line: PurchaseReturnOrderLine) => void;
};

function PurchaseReturnOrderLineItem({
  line,
  isDisabled,
  onDelete
}: PurchaseReturnOrderLineItemProps) {
  const { t } = useLingui();
  const { id: orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");

  const permissions = usePermissions();
  const disclosure = useDisclosure();
  const location = useOptimisticLocation();
  const navigate = useNavigate();

  const isSelected =
    location.pathname === path.to.purchaseReturnOrderLine(orderId, line.id!);

  const onLineClick = () => {
    if (!isSelected) {
      navigate(path.to.purchaseReturnOrderLine(orderId, line.id!));
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
            <span className="text-muted-foreground text-xs truncate line-clamp-1">
              {line.item?.name}
            </span>
          </VStack>
        </HStack>
        <div className="absolute right-2">
          <HStack spacing={1}>
            <IconButton
              aria-label={disclosure.isOpen ? t`Hide` : t`Show`}
              className={cn(
                "animate opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100",
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
                  className="opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100"
                  icon={<LuEllipsisVertical />}
                  size="md"
                  variant="solid"
                  onClick={(e) => e.stopPropagation()}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  destructive
                  disabled={
                    isDisabled || !permissions.can("delete", "purchasing")
                  }
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
              <Trans>Shipped</Trans>
            </span>
            <span className="tabular-nums">
              {line.quantityShipped ?? 0} / {line.quantity ?? 0}
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
          {line.closedComplete && (
            <HStack className="w-full justify-between">
              <span className="text-muted-foreground">
                <Trans>Shipping</Trans>
              </span>
              <Badge variant="secondary">
                <Trans>Closed</Trans>
              </Badge>
            </HStack>
          )}
        </VStack>
      )}
    </VStack>
  );
}
