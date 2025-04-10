import {
  Badge,
  Button,
  Combobox,
  Copy,
  HStack,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  VStack,
  cn,
  toast,
  useDisclosure,
  useMount,
} from "@carbon/react";
import { formatDateTime } from "@carbon/utils";
import { useFetcher, useNavigate, useParams } from "@remix-run/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuChevronDown, LuChevronRight, LuSearch } from "react-icons/lu";
import { MethodIcon, MethodItemTypeIcon } from "~/components";
import type { FlatTreeItem } from "~/components/TreeView";
import { LevelLine, TreeView, useTree } from "~/components/TreeView";
import { useIntegrations } from "~/hooks/useIntegrations";
import { Logo } from "~/integrations/onshape/config";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import type { Method } from "../../types";

type BoMExplorerProps = {
  itemType: MethodItemType;
  methods: FlatTreeItem<Method>[];
  selectedId?: string;
};

const BoMExplorer = ({ itemType, methods, selectedId }: BoMExplorerProps) => {
  const [filterText, setFilterText] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);
  const integrations = useIntegrations();

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
    onSelectedIdChanged: () => {},
    estimatedRowHeight: () => 40,
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

  const navigate = useNavigate();
  const params = useParams();
  const { itemId } = params;
  if (!itemId) throw new Error("itemId not found");

  useMount(() => {
    if (params.materialId) {
      selectNode(params.materialId);
    } else if (methods?.length > 0) {
      selectNode(methods[0].id);
    }
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
      </HStack>
      {integrations.has("onshape") && (
        <OnshapeSync
          documentId={"b769cd1538f9c9aacf88ab06"}
          versionId={"f71af59ac5406d573dcb964a"}
          mode={"manual"}
          lastSyncedAt={"2025-04-10T12:16:32.063Z"}
        />
      )}
      <TreeView
        parentRef={parentRef}
        virtualizer={virtualizer}
        autoFocus
        tree={methods}
        nodes={nodes}
        getNodeProps={getNodeProps}
        getTreeProps={getTreeProps}
        renderNode={({ node, state }) => (
          <HoverCard>
            <HoverCardTrigger asChild>
              <div
                key={node.id}
                className={cn(
                  "flex h-8 cursor-pointer items-center overflow-hidden rounded-sm pr-2 gap-1",
                  state.selected
                    ? "bg-muted hover:bg-muted/90"
                    : "bg-transparent hover:bg-muted/90"
                )}
                onClick={() => {
                  selectNode(node.id);
                  if (node.data.isRoot) {
                    navigate(getRootLink(itemType, itemId));
                  } else {
                    navigate(
                      getMaterialLink(
                        itemType,
                        itemId,
                        node.data.materialMakeMethodId ??
                          node.data.methodType.toLowerCase(),
                        node.data.methodMaterialId
                      )
                    );
                  }
                }}
              >
                <div className="flex h-8 items-center">
                  {Array.from({ length: node.level }).map((_, index) => (
                    <LevelLine key={index} isSelected={state.selected} />
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
                        <LuChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 ml-1" />
                      ) : (
                        <LuChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0 ml-1" />
                      )
                    ) : (
                      <div className="h-8 w-4" />
                    )}
                  </div>
                </div>

                <div className="flex w-full items-center justify-between gap-2">
                  <div className="flex items-center gap-2 overflow-x-hidden">
                    <MethodIcon
                      type={
                        // node.data.isRoot ? "Method" :
                        node.data.methodType
                      }
                      isKit={node.data.kit}
                      className="h-4 min-h-4 w-4 min-w-4 flex-shrink-0"
                    />
                    <NodeText node={node} />
                  </div>
                  <div className="flex items-center gap-1">
                    {node.data.isRoot ? (
                      <Badge variant="outline" className="text-xs">
                        Method
                      </Badge>
                    ) : (
                      <NodeData node={node} />
                    )}
                  </div>
                </div>
              </div>
            </HoverCardTrigger>
            <HoverCardContent side="right">
              <NodePreview node={node} />
            </HoverCardContent>
          </HoverCard>
        )}
      />
    </VStack>
  );
};

export default BoMExplorer;

function NodeText({ node }: { node: FlatTreeItem<Method> }) {
  return (
    <div className="flex flex-col items-start gap-0">
      <span className="text-sm truncate font-medium">
        {node.data.description || node.data.itemReadableId}
      </span>
    </div>
  );
}

function NodeData({ node }: { node: FlatTreeItem<Method> }) {
  return (
    <HStack spacing={1}>
      <Badge className="text-xs" variant="outline">
        {node.data.quantity}
      </Badge>

      <Badge variant="secondary">
        <MethodItemTypeIcon type={node.data.itemType} />
      </Badge>
    </HStack>
  );
}

function NodePreview({ node }: { node: FlatTreeItem<Method> }) {
  return (
    <VStack className="w-full text-sm">
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          Item ID
        </span>
        <HStack className="w-full justify-between">
          <span>{node.data.itemReadableId}</span>
          <Copy text={node.data.itemReadableId} />
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          Description
        </span>
        <HStack className="w-full justify-between">
          <span>{node.data.description}</span>
          <Copy text={node.data.description} />
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          Quantity
        </span>
        <HStack className="w-full justify-between">
          <span>
            {node.data.quantity} {node.data.unitOfMeasureCode}
          </span>
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          Method
        </span>
        <HStack className="w-full">
          <MethodIcon type={node.data.methodType} />
          <span>{node.data.methodType}</span>
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          Item Type
        </span>
        <HStack className="w-full">
          <MethodItemTypeIcon type={node.data.itemType} />
          <span>{node.data.itemType}</span>
        </HStack>
      </VStack>
    </VStack>
  );
}

function getRootLink(itemType: MethodItemType, itemId: string) {
  switch (itemType) {
    case "Part":
      return path.to.partMakeMethod(itemId);
    case "Tool":
      return path.to.toolMakeMethod(itemId);
    default:
      throw new Error(`Unimplemented BoMExplorer itemType: ${itemType}`);
  }
}

function getMaterialLink(
  itemType: MethodItemType,
  itemId: string,
  makeMethodId: string,
  materialId: string
) {
  switch (itemType) {
    case "Part":
      return path.to.partManufacturingMaterial(
        itemId,
        makeMethodId,
        materialId
      );
    // case "Fixture":
    //   return path.to.fixtureManufacturingMaterial(
    //     itemId,
    //     makeMethodId,
    //     materialId
    //   );
    case "Tool":
      return path.to.toolManufacturingMaterial(
        itemId,
        makeMethodId,
        materialId
      );
    default:
      throw new Error(`Unimplemented BoMExplorer itemType: ${itemType}`);
  }
}

export const OnshapeSync = ({
  documentId: initialDocumentId,
  versionId: initialVersionId,
  mode,
  lastSyncedAt,
}: {
  documentId: string | null;
  versionId: string | null;
  mode: "manual" | "automatic";
  lastSyncedAt?: string;
}) => {
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [versionId, setVersionId] = useState(initialVersionId);

  const disclosure = useDisclosure();

  const documentsFetcher = useFetcher<
    | { data: { items: { id: string; name: string }[] }; error: null }
    | { data: null; error: string }
  >({});

  useMount(() => {
    documentsFetcher.load(path.to.api.onShapeDocuments);
  });

  useEffect(() => {
    if (documentsFetcher.data?.error) {
      toast.error(documentsFetcher.data.error);
    }
  }, [documentsFetcher.data]);

  const documentOptions =
    useMemo(() => {
      return (
        documentsFetcher.data?.data?.items
          ?.map((c) => ({
            value: c.id,
            label: c.name,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)) ?? []
      );
    }, [documentsFetcher.data]) ?? [];

  const versionsFetcher = useFetcher<
    | { data: { id: string; name: string }[]; error: null }
    | { data: null; error: string }
  >({});

  useEffect(() => {
    if (documentId) {
      versionsFetcher.load(path.to.api.onShapeVersions(documentId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const versionOptions =
    useMemo(() => {
      return (
        versionsFetcher.data?.data
          ?.map((c) => ({
            value: c.id,
            label: c.name,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)) ?? []
      );
    }, [versionsFetcher.data]) ?? [];

  console.log({ versionsData: versionsFetcher.data });

  const isDataLoading =
    documentsFetcher.state === "loading" || versionsFetcher.state === "loading";

  return (
    <div className="flex flex-col gap-2 border bg-muted/30 rounded p-2 w-full">
      <div className="flex items-center w-full justify-between">
        <Logo className="h-5 w-auto" />
        <IconButton
          aria-label="Show sync options"
          variant="ghost"
          size="sm"
          icon={<LuChevronRight />}
          className={cn(disclosure.isOpen && "rotate-90")}
          onClick={disclosure.onToggle}
        />
      </div>

      {disclosure.isOpen && (
        <>
          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Document:</span>
            <div className="w-[180px]">
              <Combobox
                isLoading={documentsFetcher.state === "loading"}
                options={documentOptions}
                onChange={(value) => {
                  setVersionId(null);
                  setDocumentId(value);
                }}
                size="sm"
                className="text-xs"
                value={documentId ?? undefined}
              />
            </div>
          </div>

          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Version:</span>
            <div className="w-[180px]">
              <Combobox
                isLoading={versionsFetcher.state === "loading"}
                options={versionOptions}
                onChange={(value) => {
                  setVersionId(value);
                }}
                size="sm"
                className="text-xs"
                value={versionId ?? undefined}
              />
            </div>
          </div>

          <div className="flex w-full items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Sync mode:</span>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="manual"
                  name="syncMode"
                  value="manual"
                  className="h-4 w-4 text-primary border-muted-foreground focus:ring-primary"
                  defaultChecked={mode === "manual"}
                />
                <label htmlFor="manual" className="text-xs cursor-pointer">
                  Manual
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="radio"
                  id="automatic"
                  name="syncMode"
                  value="automatic"
                  className="h-4 w-4 text-primary border-muted-foreground focus:ring-primary"
                  defaultChecked={mode === "automatic"}
                />
                <label htmlFor="automatic" className="text-xs cursor-pointer">
                  Automatic
                </label>
              </div>
            </div>
          </div>
        </>
      )}
      {lastSyncedAt && (
        <div className="flex items-center gap-1 w-full justify-between">
          <span className="text-xs text-muted-foreground">
            Last synced: {formatDateTime(lastSyncedAt)}
          </span>
          <Button isDisabled={isDataLoading} size="sm">
            Sync
          </Button>
        </div>
      )}
    </div>
  );
};
