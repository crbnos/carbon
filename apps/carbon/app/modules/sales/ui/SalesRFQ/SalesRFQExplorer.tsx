import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
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
  VStack,
} from "@carbon/react";
import { prettifyKeyboardShortcut } from "@carbon/utils";
import { useNavigate, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuImage, LuPlus } from "react-icons/lu";
import { MdMoreVert } from "react-icons/md";
import { Empty } from "~/components";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { SalesRFQ, SalesRFQLine } from "../../types";
import DeleteSalesRFQLine from "./DeleteSalesRFQLine";
import SalesRFQLineForm from "./SalesRFQLineForm";

export default function SalesRFQExplorer() {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");
  const salesRfqData = useRouteData<{
    rfqSummary: SalesRFQ;
    lines: SalesRFQLine[];
  }>(path.to.salesRfq(rfqId));
  const permissions = usePermissions();

  const newSalesRFQLineDisclosure = useDisclosure({
    defaultIsOpen:
      permissions.can("update", "sales") && salesRfqData?.lines?.length === 0,
  });
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<SalesRFQLine | null>(null);

  const onDeleteLine = (line: SalesRFQLine) => {
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

  const salesRfqLineInitialValues = {
    salesRfqId: rfqId,
    customerPartId: "",
    customerPartRevision: "",
    description: "",
    itemId: "",
    itemReadableId: "",
    quantity: [1],
    order: 1,
    unitOfMeasureCode: "EA",
  };

  const isDisabled = ["Draft", "Ready for Quote"].includes(
    salesRfqData?.rfqSummary.status ?? ""
  );

  return (
    <>
      <VStack className="w-full h-[calc(100vh-99px)] justify-between">
        <VStack className="flex-1 overflow-y-auto" spacing={0}>
          {salesRfqData?.lines && salesRfqData?.lines?.length > 0 ? (
            salesRfqData?.lines.map((line) => (
              <SalesRFQLineItem
                key={line.id}
                line={line}
                isDisabled={isDisabled}
                onDelete={onDeleteLine}
              />
            ))
          ) : (
            <Empty>
              {permissions.can("update", "sales") && (
                <Button
                  leftIcon={<LuPlus />}
                  isDisabled={isDisabled}
                  onClick={newSalesRFQLineDisclosure.onOpen}
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
                onClick={newSalesRFQLineDisclosure.onOpen}
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
      {newSalesRFQLineDisclosure.isOpen && (
        <SalesRFQLineForm
          initialValues={salesRfqLineInitialValues}
          type="modal"
          onClose={newSalesRFQLineDisclosure.onClose}
        />
      )}
      {deleteLineDisclosure.isOpen && (
        <DeleteSalesRFQLine line={deleteLine!} onCancel={onDeleteCancel} />
      )}
    </>
  );
}

type SalesRFQLineItemProps = {
  line: SalesRFQLine;
  isDisabled: boolean;
  onDelete: (line: SalesRFQLine) => void;
};

function SalesRFQLineItem({
  line,
  isDisabled,
  onDelete,
}: SalesRFQLineItemProps) {
  const { rfqId, lineId } = useParams();
  if (!rfqId) throw new Error("Could not find rfqId");
  const permissions = usePermissions();
  const navigate = useNavigate();

  const location = useOptimisticLocation();

  const isSelected = lineId === line.id;
  const onLineClick = (line: SalesRFQLine) => {
    if (location.pathname !== path.to.salesRfqLine(rfqId, line.id!)) {
      // navigate to line
      navigate(path.to.salesRfqLine(rfqId, line.id!));
    }
  };

  return (
    <VStack spacing={0} className="border-b border-border">
      <HStack
        className={cn(
          "w-full p-2 items-center justify-between hover:bg-accent/30 cursor-pointer",
          isSelected && "bg-accent/60 hover:bg-accent/50 shadow-inner"
        )}
        onClick={() => onLineClick(line)}
      >
        <HStack spacing={2}>
          {line.thumbnailPath ? (
            <img
              alt="P2392303"
              className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent"
              src={`/file/preview/private/${line.thumbnailPath}`}
            />
          ) : (
            <div className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border-2 border-transparent p-2">
              <LuImage className="w-6 h-6 text-muted-foreground" />
            </div>
          )}

          <VStack spacing={0}>
            <span className="font-semibold">
              {" "}
              {line.customerPartId}
              {line.customerPartRevision && ` (${line.customerPartRevision})`}
            </span>
            <span className="font-mono text-muted-foreground text-xs">
              {line.itemReadableId}
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
                Delete Line
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HStack>
      </HStack>
    </VStack>
  );
}
