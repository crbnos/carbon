import {
  Button,
  ClientOnly,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  useDisclosure,
  VStack,
} from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useNavigate, useParams } from "@remix-run/react";
import { useState } from "react";
import { LuGhost, LuImage, LuPlus } from "react-icons/lu";
import { MdMoreVert } from "react-icons/md";
import type { FlatTree } from "~/components/TreeView/TreeView";
import { useRouteData, useUser } from "~/hooks";
import type { QuotationLine } from "~/modules/sales";
import {
  DeleteQuoteLine,
  getQuote,
  getQuoteDocuments,
  getQuoteLines,
  QuoteBoMExplorer,
  QuoteBreadcrumbs,
  QuoteHeader,
  QuoteLineForm,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Quotes",
  to: path.to.quotes,
  module: "sales",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const [quote, lines, files] = await Promise.all([
    getQuote(client, quoteId),
    getQuoteLines(client, quoteId),
    getQuoteDocuments(client, companyId, quoteId),
  ]);

  if (quote.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(quote.error, "Failed to load quote"))
    );
  }

  return json({
    quote: quote.data,
    lines: lines.data ?? [],
    files: files.data ?? [],
  });
}

export default function QuoteRoute() {
  const params = useParams();
  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <QuoteHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <div className="flex flex-grow overflow-hidden">
            <ClientOnly fallback={null}>
              {() => (
                <ResizablePanelGroup direction="horizontal">
                  <ResizablePanel
                    order={1}
                    minSize={10}
                    defaultSize={20}
                    className="bg-card h-full"
                  >
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <div className="grid w-full h-full overflow-hidden">
                        <QuoteExplorer />
                      </div>
                    </ScrollArea>
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel order={2}>
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <VStack spacing={2} className="p-2">
                        <QuoteBreadcrumbs />
                        <Outlet />
                      </VStack>
                    </ScrollArea>
                  </ResizablePanel>
                </ResizablePanelGroup>
              )}
            </ClientOnly>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuoteExplorer() {
  const { quoteId } = useParams();
  if (!quoteId) throw new Error("Could not find quoteId");
  const quoteData = useRouteData<{ lines: QuotationLine[] }>(
    path.to.quote(quoteId)
  );

  const { id: userId } = useUser();
  const quoteLineInitialValues = {
    quoteId,
    itemId: "",
    itemReadableId: "",
    status: "Draft" as const,
    estimatorId: userId,
    description: "",
    methodType: "Make" as const,
    unitOfMeasureCode: "",
  };

  const newQuoteLineDisclosure = useDisclosure();
  const deleteLineDisclosure = useDisclosure();
  const [deleteLine, setDeleteLine] = useState<QuotationLine | null>(null);

  const onDeleteLine = (line: QuotationLine) => {
    setDeleteLine(line);
    deleteLineDisclosure.onOpen();
  };

  const onDeleteCancel = () => {
    setDeleteLine(null);
    deleteLineDisclosure.onClose();
  };

  return (
    <>
      <VStack className="w-full h-[calc(100vh-99px)] justify-between">
        <VStack className="flex-1 overflow-y-auto" spacing={0}>
          {quoteData?.lines && quoteData?.lines?.length > 0 ? (
            quoteData?.lines.map((line) => (
              <QuoteLineItem
                key={line.id}
                line={line}
                onDelete={onDeleteLine}
              />
            ))
          ) : (
            <EmptyQuote onAdd={newQuoteLineDisclosure.onOpen} />
          )}
        </VStack>
        <div className="w-full flex flex-0 sm:flex-row border-t border-border p-4 sm:justify-start sm:space-x-2">
          <Button leftIcon={<LuPlus />} onClick={newQuoteLineDisclosure.onOpen}>
            Add Line Item
          </Button>
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

function EmptyQuote({ onAdd }: { onAdd: () => void }) {
  return (
    <VStack className="w-full h-full justify-center items-center">
      <LuGhost className="w-12 h-12" />
      <h3 className="text-base">Pretty empty around here</h3>
      <Button leftIcon={<LuPlus />} onClick={onAdd}>
        Add Line Item
      </Button>
    </VStack>
  );
}

const methods: FlatTree<{
  itemId: string;
  makeMethodId: string | null;
  methodType: string;
  materialMakeMethodId: string | null;
  itemType: string;
  quantity: number;
  itemReadableId: string;
  order: number;
  methodMaterialId: string;
  parentMaterialId: string | null;
  isRoot: boolean;
}> = [
  {
    id: "node-d9210a4deb583",
    children: ["node-b1633fd85ebf", "node-889f33c1ba64b"],
    hasChildren: true,
    level: 0,
    parentId: undefined,
    data: {
      itemId: "cqc7ms9r80lmbqsrdnbg",
      makeMethodId: null,
      methodType: "Make",
      materialMakeMethodId: "cqc7ms9r80lmbqkrdnc0",
      itemType: "Part",
      quantity: 1,
      itemReadableId: "P2392303",
      order: 1,
      methodMaterialId: "cqc7ms9r80lmbqkrdnc0",
      parentMaterialId: null,
      isRoot: true,
    },
  },
  {
    id: "node-b1633fd85ebf",
    children: [],
    hasChildren: false,
    level: 1,
    data: {
      itemId: "cqc7nq1r80lmchkrdnf0",
      makeMethodId: "cqc7ms9r80lmbqkrdnc0",
      methodType: "Pick",
      materialMakeMethodId: null,
      itemType: "Tool",
      quantity: 1,
      itemReadableId: "T932023",
      order: 1,
      methodMaterialId: "cqc7nrpr80lmbusrdnfg",
      parentMaterialId: "cqc7ms9r80lmbqkrdnc0",
      isRoot: false,
    },
    parentId: "node-d9210a4deb583",
  },
  {
    id: "node-889f33c1ba64b",
    children: ["node-324eaa176575a"],
    hasChildren: true,
    level: 1,
    data: {
      itemId: "cqc7n1pr80lmbv4rdncg",
      makeMethodId: "cqc7ms9r80lmbqkrdnc0",
      methodType: "Make",
      materialMakeMethodId: "cqc7n1pr80lmbqkrdnd0",
      itemType: "Part",
      quantity: 2,
      itemReadableId: "P2392304",
      order: 1,
      methodMaterialId: "cqc7n3pr80lmbukrdndg",
      parentMaterialId: "cqc7ms9r80lmbqkrdnc0",
      isRoot: false,
    },
    parentId: "node-d9210a4deb583",
  },
  {
    id: "node-324eaa176575a",
    children: [],
    hasChildren: false,
    level: 2,
    data: {
      itemId: "cqc7njpr80lmbv4rdne0",
      makeMethodId: "cqc7n1pr80lmbqkrdnd0",
      methodType: "Buy",
      materialMakeMethodId: null,
      itemType: "Material",
      quantity: 3.8,
      itemReadableId: "RAW3290393",
      order: 1,
      methodMaterialId: "cqc7nlhr80lmbv4rdneg",
      parentMaterialId: "cqc7n3pr80lmbukrdndg",
      isRoot: false,
    },
    parentId: "node-889f33c1ba64b",
  },
];

type QuoteLineItemProps = {
  line: QuotationLine;
  onDelete: (line: QuotationLine) => void;
};

function QuoteLineItem({ line, onDelete }: QuoteLineItemProps) {
  const { quoteId, lineId } = useParams();
  const navigate = useNavigate();
  const disclosure = useDisclosure();

  if (!quoteId) throw new Error("Could not find quoteId");

  const isSelected = lineId === line.id;
  const onLineClick = (line: QuotationLine) => {
    if (line.methodType === "Make") {
      disclosure.onToggle();
    }

    if (!isSelected) {
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
          isSelected && "bg-accent/60 hover:bg-accent/50"
        )}
        onClick={() => onLineClick(line)}
      >
        <HStack spacing={2}>
          {line.thumbnailPath ? (
            <img
              alt="P2392303"
              className={cn(
                "w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border border-transparent",
                line.status === "Complete" && "border-green-500",
                line.status === "In Progress" && "border-yellow-500"
              )}
              src={`/file/preview/private/${line.thumbnailPath}`}
            />
          ) : (
            <div
              className={cn(
                "w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border border-transparent p-2",
                line.status === "Complete" && "border-green-500",
                line.status === "In Progress" && "border-yellow-500"
              )}
            >
              <LuImage className="w-6 h-6 text-muted-foreground" />
            </div>
          )}

          <VStack spacing={0}>
            <span className="font-mono font-semibold">
              {line.itemReadableId}
            </span>
            <span className="font-mono text-muted-foreground text-xs">
              {line.customerPartId}
              {line.customerPartRevision && ` (${line.customerPartRevision})`}
            </span>
          </VStack>
        </HStack>

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
      {disclosure.isOpen && (
        <VStack className="border-b border-border">
          <QuoteBoMExplorer methods={methods} />
        </VStack>
      )}
    </VStack>
  );
}
