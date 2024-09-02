import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Kbd,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useDisclosure,
  useKeyboardShortcuts,
  useMount,
  VStack,
} from "@carbon/react";
import { prettifyKeyboardShortcut } from "@carbon/utils";
import { Link, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuImage, LuPlus, LuTrash } from "react-icons/lu";
import { MdMoreVert } from "react-icons/md";
import { Empty } from "~/components";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { SalesOrder, SalesOrderLine } from "../../types";
import DeleteSalesOrderLine from "./DeleteSalesOrderLine";
import SalesOrderLineForm from "./SalesOrderLineForm";

export default function SalesOrderExplorer() {
  const { orderId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const salesOrderData = useRouteData<{
    salesOrder: SalesOrder;
    lines: SalesOrderLine[];
  }>(path.to.salesOrder(orderId));
  const permissions = usePermissions();

  const salesOrderLineInitialValues = {
    salesOrderId: orderId,
    salesOrderLineType: "Part" as const,
    saleQuantity: 1,
    unitPrice: 0,
    addOnCost: 0,
  };

  const newSalesOrderLineDisclosure = useDisclosure({
    defaultIsOpen:
      permissions.can("update", "sales") && salesOrderData?.lines?.length === 0,
  });
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<SalesOrderLine | null>(null);
  const isDisabled = salesOrderData?.salesOrder?.status !== "Draft";

  const onDeleteLine = (line: SalesOrderLine) => {
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
    },
  });

  return (
    <>
      <VStack className="w-full h-[calc(100vh-99px)] justify-between">
        <VStack className="flex-1 overflow-y-auto" spacing={0}>
          {salesOrderData?.lines && salesOrderData?.lines?.length > 0 ? (
            salesOrderData?.lines.map((line) => (
              <SalesOrderLineItem
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
                  leftIcon={<LuPlus />}
                  onClick={newSalesOrderLineDisclosure.onOpen}
                >
                  Add Line Item
                </Button>
              )}
            </Empty>
          )}
        </VStack>
        <div className="w-full flex flex-0 sm:flex-row border-t border-border p-4 sm:justify-start sm:space-x-2">
          <Tooltip>
            <TooltipTrigger className="w-full">
              <Button
                ref={newButtonRef}
                className="w-full"
                isDisabled={isDisabled || !permissions.can("update", "sales")}
                leftIcon={<LuPlus />}
                onClick={newSalesOrderLineDisclosure.onOpen}
              >
                Add Line Item
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <HStack>
                <span>New Line Item</span>
                <Kbd>{prettifyKeyboardShortcut("Command+Shift+l")}</Kbd>
              </HStack>
            </TooltipContent>
          </Tooltip>
        </div>
      </VStack>
      {newSalesOrderLineDisclosure.isOpen && (
        <SalesOrderLineForm
          initialValues={salesOrderLineInitialValues}
          type="modal"
          onClose={newSalesOrderLineDisclosure.onClose}
        />
      )}
      {deleteLineDisclosure.isOpen && (
        <DeleteSalesOrderLine line={deleteLine!} onCancel={onDeleteCancel} />
      )}
    </>
  );
}

type SalesOrderLineItemProps = {
  line: SalesOrderLine;
  isDisabled: boolean;
  onDelete: (line: SalesOrderLine) => void;
};

function SalesOrderLineItem({
  line,
  isDisabled,
  onDelete,
}: SalesOrderLineItemProps) {
  const { orderId, lineId } = useParams();
  if (!orderId) throw new Error("Could not find orderId");
  const permissions = usePermissions();
  const disclosure = useDisclosure();
  const location = useOptimisticLocation();

  useMount(() => {
    if (lineId === line.id) {
      disclosure.onOpen();
    }
  });

  const isSelected =
    location.pathname === path.to.salesOrderLine(orderId, line.id!);

  return (
    <VStack spacing={0}>
      <Link
        to={path.to.salesOrderLine(orderId, line.id!)}
        prefetch="intent"
        className="w-full"
      >
        <HStack
          className={cn(
            "w-full p-2 items-center justify-between hover:bg-accent/30 cursor-pointer",
            !disclosure.isOpen && "border-b border-border",
            isSelected && "bg-accent/60 hover:bg-accent/50 shadow-inner"
          )}
        >
          <HStack spacing={2}>
            {line.thumbnailPath ? (
              <img
                alt={line.itemReadableId!}
                className={cn(
                  "w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent",
                  line.status === "Completed" && "border-green-500",
                  line.status === "In Progress" && "border-yellow-500"
                )}
                src={`/file/preview/private/${line.thumbnailPath}`}
              />
            ) : (
              <div
                className={cn(
                  "w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent p-2",
                  line.status === "Completed" && "border-green-500",
                  line.status === "In Progress" && "border-yellow-500"
                )}
              >
                <LuImage className="w-6 h-6 text-muted-foreground" />
              </div>
            )}

            <VStack spacing={0}>
              <span className="font-semibold">{line.itemReadableId}</span>
              <span className="text-muted-foreground text-xs truncate">
                {line.itemName}
              </span>
            </VStack>
          </HStack>
          <HStack spacing={0}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More"
                  icon={<MdMoreVert />}
                  variant="ghost"
                  onClick={(e) => e.stopPropagation()}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  disabled={isDisabled || !permissions.can("update", "sales")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(line);
                  }}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  Delete Line
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </HStack>
      </Link>
    </VStack>
  );
}
