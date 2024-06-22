import {
  Badge,
  ClientOnly,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  ScrollArea,
  VStack,
  cn,
} from "@carbon/react";
import { TreeView, useTree } from "~/components/TreeView/TreeView";

import type { LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuChevronDown, LuChevronUp, LuPlus, LuSearch } from "react-icons/lu";
import { typedjson, useTypedLoaderData } from "remix-typedjson";
import { MethodIcon } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";

type Method = {
  id: string;
  parentId: string | undefined;
  children: string[];
  hasChildren: boolean;
  level: number;
  data: {
    itemId: string;
    readableId: string;
    description: string;
    quantity: number;
    fulfillmentMethod: "Buy" | "Make" | "Pick";
    isInherited: boolean;
    isRoot: boolean;
  };
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  return typedjson({
    methods: [
      {
        id: "1",
        parentId: undefined,
        hasChildren: true,
        children: ["2", "3"],
        level: 0,
        data: {
          itemId: "1",
          readableId: "F02134",
          description: '1/2" x 3" x 4" Bracket',
          quantity: 1,
          fulfillmentMethod: "Make",
          isInherited: false,
          isRoot: true,
        },
      },
      {
        id: "2",
        parentId: "1",
        hasChildren: true,
        children: ["4"],
        level: 1,
        data: {
          itemId: "2",
          readableId: "F501932",
          description: '1/2" x 3" x 4" Cutout',
          quantity: 1,
          fulfillmentMethod: "Make",
          isInherited: false,
          isRoot: false,
        },
      },

      {
        id: "4",
        parentId: "2",
        hasChildren: false,
        children: [],
        level: 2,
        data: {
          itemId: "4",
          readableId: "F41858",
          description: "1/8 X 5/8 6061-T6511 Aluminum Flat",
          quantity: 2.8,
          fulfillmentMethod: "Pick",
          isInherited: true,
          isRoot: false,
        },
      },
      {
        id: "3",
        parentId: "1",
        hasChildren: false,
        children: [],
        level: 1,
        data: {
          itemId: "3",
          readableId: "91772A061",
          description: '5/16" Threaded Machine Screw',
          quantity: 4,
          fulfillmentMethod: "Buy",
          isInherited: false,
          isRoot: false,
        },
      },
    ] satisfies Method[],
  });
}

export default function PartManufacturing() {
  const { methods } = useTypedLoaderData<typeof loader>();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  return (
    <div className="flex flex-grow overflow-hidden">
      <ClientOnly fallback={null}>
        {() => (
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel
              order={1}
              minSize={20}
              defaultSize={20}
              className="bg-card"
            >
              <ScrollArea className="h-[calc(100vh-99px)]">
                <div className="grid h-full overflow-hidden p-2">
                  <BoMExplorer
                    methods={methods}
                    onSelectedIdChanged={(selectedId) => {
                      console.log(selectedId);
                    }}
                  />
                </div>
              </ScrollArea>
            </ResizablePanel>
            <ResizableHandle withHandle />

            <Outlet />
          </ResizablePanelGroup>
        )}
      </ClientOnly>
    </div>
  );
}

type BoMExplorerProps = {
  methods: Method[];
  selectedId?: string;
  onSelectedIdChanged: (selectedId: string | undefined) => void;
};

function BoMExplorer({
  methods,
  selectedId,
  onSelectedIdChanged,
}: BoMExplorerProps) {
  const [filterText, setFilterText] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  const {
    nodes,
    getTreeProps,
    getNodeProps,
    // toggleNodeSelection,
    toggleExpandNode,
    expandAllBelowDepth,
    // toggleExpandLevel,
    collapseAllBelowDepth,
    selectNode,
    scrollToNode,
    virtualizer,
  } = useTree({
    tree: methods,
    selectedId,
    // collapsedIds,
    onSelectedIdChanged,
    estimatedRowHeight: () => 32,
    parentRef,
    filter: {
      value: { text: filterText },
      fn: (value, node) => {
        if (value.text === "") return true;
        if (
          node.data.readableId.toLowerCase().includes(value.text.toLowerCase())
        ) {
          return true;
        }
        return false;
      },
    },
  });

  return (
    <VStack>
      <HStack className="w-full">
        <InputGroup size="sm" className="flex flex-grow">
          <InputLeftElement>
            <LuSearch className="h-4 w-4" />
          </InputLeftElement>
          <Input
            placeholder="Search..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </InputGroup>
        <IconButton
          aria-label="Add"
          variant="secondary"
          icon={<LuPlus className="h-4 w-4" />}
        />
      </HStack>
      <TreeView
        parentRef={parentRef}
        virtualizer={virtualizer}
        autoFocus
        tree={methods}
        nodes={nodes}
        getNodeProps={getNodeProps}
        getTreeProps={getTreeProps}
        renderNode={({ node, state }) => (
          <>
            <div
              className={cn(
                "flex h-8 cursor-pointer items-center overflow-hidden rounded-sm pr-2",
                state.selected
                  ? "bg-muted hover:bg-muted/90"
                  : "bg-transparent hover:bg-muted/90"
              )}
              onClick={() => {
                selectNode(node.id);
              }}
            >
              <div className="flex h-8 items-center">
                {Array.from({ length: node.level }).map((_, index) => (
                  <TaskLine key={index} isSelected={state.selected} />
                ))}
                <div
                  className={cn(
                    "flex h-8 w-4 items-center",
                    node.hasChildren && "hover:bg-accent"
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.altKey) {
                      if (state.expanded) {
                        collapseAllBelowDepth(node.level);
                      } else {
                        expandAllBelowDepth(node.level);
                      }
                    } else {
                      toggleExpandNode(node.id);
                    }
                    scrollToNode(node.id);
                  }}
                >
                  {node.hasChildren ? (
                    state.expanded ? (
                      <LuChevronDown className="h-4 w-4 text-gray-400" />
                    ) : (
                      <LuChevronUp className="h-4 w-4 text-gray-400" />
                    )
                  ) : (
                    <div className="h-8 w-4" />
                  )}
                </div>
              </div>

              <div className="flex w-full items-center justify-between gap-2">
                <div
                  className={cn(
                    "flex items-center gap-2 overflow-x-hidden",
                    node.data.isInherited && "opacity-50"
                  )}
                >
                  <MethodIcon
                    type={
                      // node.data.isRoot ? "Method" :
                      node.data.fulfillmentMethod
                    }
                    className="h-4 min-h-4 w-4 min-w-4"
                  />
                  <NodeText node={node} />
                </div>
                <div className="flex items-center gap-1">
                  {node.data.isRoot ? (
                    <Badge variant="outline" className="text-xs">
                      Method
                    </Badge>
                  ) : (
                    <NodeQuantity node={node} />
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      />
    </VStack>
  );
}

function NodeText({ node }: { node: Method }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm font-mono">{node.data.readableId}</span>
    </div>
  );
}

function NodeQuantity({ node }: { node: Method }) {
  return (
    <Badge className="text-xs" variant="outline">
      {node.data.quantity}
    </Badge>
  );
}

function TaskLine({ isSelected }: { isSelected: boolean }) {
  return (
    <div
      className={cn(
        "h-8 w-2 border-r border-border",
        isSelected && "border-foreground/30"
      )}
    />
  );
}
