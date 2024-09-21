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
import { useNavigate, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuChevronsUpDown, LuPlus, LuTrash } from "react-icons/lu";
import { MdMoreVert } from "react-icons/md";
import { Empty, ItemThumbnail } from "~/components";
import type { Tree } from "~/components/TreeView";
import { flattenTree } from "~/components/TreeView";
import {
  useOptimisticLocation,
  usePermissions,
  useRealtime,
  useRouteData,
  useUser,
} from "~/hooks";
import { path } from "~/utils/path";
import type { Quotation, QuotationLine, QuoteMethod } from "../../types";
import DeleteQuoteLine from "./DeleteQuoteLine";
import QuoteBoMExplorer from "./QuoteBoMExplorer";
import QuoteLineForm from "./QuoteLineForm";

type QuoteExplorerProps = {
  methods: Tree<QuoteMethod>[];
};

export default function QuoteExplorer({ methods }: QuoteExplorerProps) {
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  const quoteData = useRouteData<{ quote: Quotation; lines: QuotationLine[] }>(
    path.to.quote(quoteId)
  );

  const permissions = usePermissions();
  const { id: userId } = useUser();
  const quoteLineInitialValues = {
    quoteId,
    description: "",
    estimatorId: userId,
    itemId: "",
    itemReadableId: "",
    methodType: "Make" as const,
    status: "Draft" as const,
    quantity: [1],
    unitOfMeasureCode: "",
  };

  useRealtime(
    "modelUpload",
    `modelPath=in.(${quoteData?.lines.map((d) => d.modelPath).join(",")})`
  );

  const newQuoteLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<QuotationLine | null>(null);
  const isDisabled = quoteData?.quote?.status !== "Draft";

  const onDeleteLine = (line: QuotationLine) => {
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
          {quoteData?.lines && quoteData?.lines?.length > 0 ? (
            quoteData?.lines.map((line) => (
              <QuoteLineItem
                key={line.id}
                isDisabled={isDisabled}
                line={line}
                onDelete={onDeleteLine}
                methods={methods}
              />
            ))
          ) : (
            <Empty>
              {permissions.can("update", "sales") && (
                <Button
                  isDisabled={isDisabled}
                  leftIcon={<LuPlus />}
                  onClick={newQuoteLineDisclosure.onOpen}
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
                onClick={newQuoteLineDisclosure.onOpen}
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
      {newQuoteLineDisclosure.isOpen && (
        <QuoteLineForm
          initialValues={quoteLineInitialValues}
          type="modal"
          onClose={newQuoteLineDisclosure.onClose}
        />
      )}
      {deleteLineDisclosure.isOpen && (
        <DeleteQuoteLine line={deleteLine!} onCancel={onDeleteCancel} />
      )}
    </>
  );
}

type QuoteLineItemProps = {
  line: QuotationLine;
  isDisabled: boolean;
  onDelete: (line: QuotationLine) => void;
  methods: Tree<QuoteMethod>[];
};

function QuoteLineItem({
  line,
  isDisabled,
  onDelete,
  methods,
}: QuoteLineItemProps) {
  const { quoteId, lineId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  const permissions = usePermissions();
  const navigate = useNavigate();
  const disclosure = useDisclosure();
  const location = useOptimisticLocation();

  useMount(() => {
    if (lineId === line.id) {
      disclosure.onOpen();
    }
  });

  const methodTree = methods.find((m) => m.data.quoteLineId === line.id);
  const flattenedMethods = methodTree ? flattenTree(methodTree) : [];

  const isSelected = lineId === line.id;
  const onLineClick = (line: QuotationLine) => {
    if (line.methodType === "Make") {
      disclosure.onOpen();
    }

    if (location.pathname !== path.to.quoteLine(quoteId, line.id!)) {
      // navigate to line
      navigate(path.to.quoteLine(quoteId, line.id!));
    }
  };

  return (
    <VStack spacing={0}>
      <HStack
        className={cn(
          "w-full p-2 items-center justify-between hover:bg-accent/30 cursor-pointer",
          !disclosure.isOpen && "border-b border-border",
          isSelected && "bg-accent/60 hover:bg-accent/50 shadow-inner"
        )}
        onClick={() => onLineClick(line)}
      >
        <HStack spacing={2}>
          <ItemThumbnail
            modelId={line.modelId}
            thumbnailPath={line.thumbnailPath}
          />

          <VStack spacing={0}>
            <span className="font-semibold line-clamp-1">
              {line.itemReadableId}
            </span>
            <span className="font-mono text-muted-foreground text-xs line-clamp-1">
              {line.customerPartId}
              {line.customerPartRevision && ` (${line.customerPartRevision})`}
            </span>
          </VStack>
        </HStack>
        <HStack spacing={0}>
          {line.methodType === "Make" && permissions.can("update", "sales") && (
            <IconButton
              aria-label={disclosure.isOpen ? "Hide" : "Show"}
              icon={<LuChevronsUpDown />}
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                disclosure.onToggle();
              }}
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label="More"
                icon={<MdMoreVert />}
                size="sm"
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
      {disclosure.isOpen &&
        line.methodType === "Make" &&
        permissions.can("update", "sales") && (
          <VStack className="border-b border-border p-1">
            <QuoteBoMExplorer methods={flattenedMethods} />
          </VStack>
        )}
    </VStack>
  );
}
