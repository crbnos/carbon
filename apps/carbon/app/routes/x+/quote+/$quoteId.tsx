import {
  Button,
  ClientOnly,
  cn,
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
import { Outlet, useParams } from "@remix-run/react";
import { LuGhost, LuPlus } from "react-icons/lu";
import { MdMoreVert } from "react-icons/md";
import type { FlatTree } from "~/components/TreeView/TreeView";
import { getQuote, QuoteBoMExplorer, QuoteHeader } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Quote",
  to: path.to.quotes,
  module: "sales",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { quoteId } = params;
  if (!quoteId) throw new Error("Could not find quoteId");

  const [quote] = await Promise.all([getQuote(client, quoteId)]);

  if (quote.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(quote.error, "Failed to load quote"))
    );
  }

  return json({
    quote: quote.data,
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
                  <ResizablePanel order={2} className="border-t border-border">
                    <ScrollArea className="h-[calc(100vh-99px)]">
                      <Outlet key={JSON.stringify(params)} />
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
  return (
    <VStack className="w-full h-[calc(100vh-99px)] justify-between">
      <VStack className="flex-1 overflow-y-auto" spacing={0}>
        <QuoteLineItem />
        <QuoteLineItem />
        <QuoteLineItem />
        {/* <EmptyQuote /> */}
      </VStack>
      <div className="w-full flex flex-0 sm:flex-row border-t border-border p-4 sm:justify-start sm:space-x-2">
        <Button leftIcon={<LuPlus />}>Add Line Item</Button>
      </div>
    </VStack>
  );
}

function EmptyQuote() {
  return (
    <VStack className="w-full h-full justify-center items-center">
      <LuGhost className="w-12 h-12" />
      <h3 className="font-semibold text-lg">Pretty empty around here</h3>
      <Button leftIcon={<LuPlus />}>Add Line Item</Button>
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

function QuoteLineItem() {
  const isSelected = false;
  const disclosure = useDisclosure();
  const onParentClick = () => {
    disclosure.onToggle();
  };
  return (
    <VStack spacing={0}>
      <HStack
        className={cn(
          "w-full p-2 items-center justify-between hover:bg-accent cursor-pointer",
          !disclosure.isOpen && "border-b border-border",
          isSelected && "bg-accent"
        )}
        onClick={onParentClick}
      >
        <HStack spacing={2}>
          <img
            alt="P2392303"
            className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border border-border"
            src="/file/preview/private/cqbjc69r80lg2msrdjkg/models/dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6Y2FyYm9uLW9zLWRldi93U1dpb3lHMndybGdhekdHNVNwSDkuc3RlcA==.png"
          />
          {/* <div className="w-10 h-10 bg-gradient-to-bl from-muted to-muted/40 rounded-lg border border-border p-2">
            <LuImage className="w-6 h-6 text-muted-foreground" />
          </div> */}
          <VStack spacing={0}>
            <span className="font-mono font-semibold">A932023</span>
            <span className="font-mono text-muted-foreground text-xs">
              Rev 0
            </span>
          </VStack>
        </HStack>
        {/* <HStack spacing={1}>
      {false ? (
        <EmployeeAvatar employeeId={null} className="flex-shrink-0" />
        ) : (
          <Avatar className="flex-shrink-0" size="xs" />
          )} */}
        <IconButton aria-label="More" icon={<MdMoreVert />} variant="ghost" />
        {/* </HStack> */}
      </HStack>
      {disclosure.isOpen && (
        <VStack className="border-b border-border">
          <QuoteBoMExplorer methods={methods} />
        </VStack>
      )}
    </VStack>
  );
}
