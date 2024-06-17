import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  ClientOnly,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  VStack,
  cn,
} from "@carbon/react";
import { TreeView, useTree } from "~/components/TreeView/TreeView";

import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useParams } from "@remix-run/react";
import { useRef, useState } from "react";
import { LuChevronDown, LuChevronUp, LuPlus, LuSearch } from "react-icons/lu";
import { redirect, typedjson, useTypedLoaderData } from "remix-typedjson";
import {
  MethodIcon,
  PartManufacturingForm,
  getItemManufacturing,
  partManufacturingValidator,
  upsertItemManufacturing,
} from "~/modules/items";
import type { StandardFactor } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const partManufacturing = await getItemManufacturing(
    client,
    itemId,
    companyId
  );

  if (partManufacturing.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(partManufacturing.error, "Failed to load part manufacturing")
      )
    );
  }

  return typedjson({
    partManufacturing: partManufacturing.data,
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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const formData = await request.formData();
  const validation = await validator(partManufacturingValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updatePartManufacturing = await upsertItemManufacturing(client, {
    ...validation.data,
    itemId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });
  if (updatePartManufacturing.error) {
    throw redirect(
      path.to.part(itemId),
      await flash(
        request,
        error(
          updatePartManufacturing.error,
          "Failed to update part manufacturing"
        )
      )
    );
  }

  throw redirect(
    path.to.partManufacturing(itemId),
    await flash(request, success("Updated part manufacturing"))
  );
}

export default function Item() {
  const { methods, partManufacturing } = useTypedLoaderData<typeof loader>();
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const manufacturingInitialValues = {
    ...partManufacturing,
    lotSize: partManufacturing.lotSize ?? 0,
    ...getCustomFields(partManufacturing.customFields),
  };

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
              <div className="grid h-full overflow-hidden p-2">
                <BoMExplorer
                  methods={methods}
                  onSelectedIdChanged={(selectedId) => {
                    console.log(selectedId);
                  }}
                />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />

            <ResizablePanel
              order={2}
              minSize={40}
              defaultSize={60}
              className="border-t border-border"
            >
              <VStack spacing={2} className="p-2">
                <PartManufacturingForm
                  key={itemId}
                  initialValues={manufacturingInitialValues}
                />
                <BillOfProcesses key={itemId} processes={[]} />
              </VStack>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel
              order={3}
              minSize={20}
              defaultSize={20}
              className="bg-card p-4 overflow-y-auto flex flex-col gap-4"
            >
              <VStack spacing={2}>
                <h3 className="text-xs text-muted-foreground">Properties</h3>
              </VStack>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </ClientOnly>
    </div>
  );
}

type Process = {
  workCenterTypeId: string;
  equipmentTypeId?: string;
  setupHours: number;
  standardFactor: StandardFactor;
  productionStandard: number;
};

function BillOfProcesses({ processes }: { processes: Process[] }) {
  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle>Bill of Processes</CardTitle>
        </CardHeader>

        <CardAction>
          <Button variant="secondary">Add Process</Button>
        </CardAction>
      </HStack>
      <CardContent></CardContent>
    </Card>
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
    toggleNodeSelection,
    toggleExpandNode,
    expandAllBelowDepth,
    toggleExpandLevel,
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
