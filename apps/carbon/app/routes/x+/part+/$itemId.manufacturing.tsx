import type { JSONContent } from "@carbon/react";
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
import type { FlatTreeItem } from "~/components/TreeView/TreeView";
import { TreeView, flattenTree, useTree } from "~/components/TreeView/TreeView";

import type { LoaderFunctionArgs } from "@remix-run/node";
import { Outlet, json, useLoaderData, useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuChevronDown, LuChevronUp, LuPlus, LuSearch } from "react-icons/lu";
import { redirect } from "remix-typedjson";
import type { Method, MethodItemType, MethodType } from "~/modules/items";
import {
  MethodIcon,
  getMakeMethod,
  getMethodMaterials,
  getMethodOperations,
  getMethodTree,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const makeMethod = await getMakeMethod(client, itemId, companyId);

  if (makeMethod.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(makeMethod.error, "Failed to load make method")
      )
    );
  }

  const [methodTree, methodMaterials, methodOperations] = await Promise.all([
    getMethodTree(client, makeMethod.data.id),
    getMethodMaterials(client, makeMethod.data.id),
    getMethodOperations(client, makeMethod.data.id),
  ]);
  if (methodTree?.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(methodTree.error, "Failed to load method tree")
      )
    );
  }

  if (methodOperations.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(methodOperations.error, "Failed to load method operations")
      )
    );
  }
  if (methodMaterials.error) {
    throw redirect(
      path.to.partDetails(itemId),
      await flash(
        request,
        error(methodMaterials.error, "Failed to load method materials")
      )
    );
  }

  return json({
    makeMethod: makeMethod.data,
    methodMaterials:
      methodMaterials.data?.map((m) => ({
        ...m,
        methodType: m.methodType as MethodType,
        itemType: m.itemType as MethodItemType,
      })) ?? [],
    methodOperations:
      methodOperations.data?.map((operation) => ({
        ...operation,
        equipmentTypeId: operation.equipmentTypeId ?? undefined,
        methodOperationWorkInstruction:
          operation.methodOperationWorkInstruction as {
            content: JSONContent | null;
          },
      })) ?? [],
    methods: (methodTree.data.length > 0
      ? flattenTree(methodTree.data[0])
      : []) satisfies FlatTreeItem<Method>[],
  });
}

export default function PartManufacturing() {
  const { methods } = useLoaderData<typeof loader>();

  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  return (
    <div className="flex flex-grow overflow-hidden">
      <ClientOnly fallback={null}>
        {() => (
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel
              order={1}
              minSize={10}
              defaultSize={20}
              className="bg-card"
            >
              <ScrollArea className="h-[calc(100vh-99px)]">
                <div className="grid h-full overflow-hidden p-2">
                  <BoMExplorer
                    // @ts-ignore
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
  methods: FlatTreeItem<Method>[];
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
          node.data.itemReadableId
            .toLowerCase()
            .includes(value.text.toLowerCase())
        ) {
          return true;
        }
        return false;
      },
    },
    isEager: true,
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
                    node.level > 1 && "opacity-50"
                  )}
                >
                  <MethodIcon
                    type={
                      // node.data.isRoot ? "Method" :
                      node.data.methodType
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

function NodeText({ node }: { node: FlatTreeItem<Method> }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm font-mono">{node.data.itemReadableId}</span>
    </div>
  );
}

function NodeQuantity({ node }: { node: FlatTreeItem<Method> }) {
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
