import {
  Badge,
  Button,
  Combobox,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  HStack,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  PulsingDot,
  Spinner,
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
import { methodType, type MethodItemType } from "~/modules/shared";
import type { action as onShapeSyncAction } from "~/routes/api+/integrations.onshape.sync";
import { useBom } from "~/stores";
import { path } from "~/utils/path";
import type { Method } from "../../types";

type BoMExplorerProps = {
  itemType: MethodItemType;
  makeMethodId: string;
  methods: FlatTreeItem<Method>[];
  selectedId?: string;
};

const BoMExplorer = ({
  itemType,
  makeMethodId,
  methods,
  selectedId,
}: BoMExplorerProps) => {
  const [filterText, setFilterText] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);
  const integrations = useIntegrations();
  const params = useParams();
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

  const { itemId } = params;
  if (!itemId) throw new Error("itemId not found");

  const [selectedMaterialId, setSelectedMaterialId] = useBom();
  useMount(() => {
    if (selectedMaterialId) {
      const node = methods.find(
        (m) => m.data.methodMaterialId === selectedMaterialId
      );
      selectNode(node?.id ?? methods[0].id);
    } else if (params.makeMethodId) {
      const node = methods.find(
        (m) => m.data.materialMakeMethodId === params.makeMethodId
      );
      selectNode(node?.id ?? methods[0].id);
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
          makeMethodId={makeMethodId}
          documentId={"b769cd1538f9c9aacf88ab06"}
          versionId={"f71af59ac5406d573dcb964a"}
          elementId={"76c15dd77696f26035f6674f"}
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
        renderNode={({ node, state }) => {
          return (
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
                    setSelectedMaterialId(node.data.methodMaterialId);
                    if (node.data.isRoot) {
                      navigate(getRootLink(itemType, itemId));
                    } else {
                      navigate(
                        getMaterialLink(
                          itemType,
                          itemId,
                          node.data.makeMethodId
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
          );
        }}
      />
    </VStack>
  );
};

export default BoMExplorer;

function NodeText({ node }: { node: FlatTreeItem<Method> }) {
  return (
    <div className="flex flex-col items-start gap-0">
      <span className="text-sm truncate font-medium">
        {node.data.itemReadableId || node.data.description}
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
  makeMethodId: string
) {
  switch (itemType) {
    case "Part":
      return path.to.partManufacturingMaterial(itemId, makeMethodId);
    case "Tool":
      return path.to.toolManufacturingMaterial(itemId, makeMethodId);
    default:
      throw new Error(`Unimplemented BoMExplorer itemType: ${itemType}`);
  }
}

interface TreeNode {
  data: TreeData;
  children: TreeNode[];
  level: number;
}

interface TreeData {
  id?: string;
  index: string;
  readableId: string;
  name?: string;
  quantity: number;
  unitOfMeasure: string;
  replenishmentSystem: string;
  defaultMethodType: string;
  mass: number;
  level: number;
}

export const OnshapeSync = ({
  documentId: initialDocumentId,
  versionId: initialVersionId,
  elementId: initialElementId,
  makeMethodId,
  mode,
  lastSyncedAt,
}: {
  documentId: string | null;
  versionId: string | null;
  elementId: string | null;
  makeMethodId: string;
  mode: "manual" | "automatic";
  lastSyncedAt?: string;
}) => {
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [versionId, setVersionId] = useState(initialVersionId);
  const [elementId, setElementId] = useState(initialElementId);
  const [bomRows, setBomRows] = useState<TreeData[]>([]);
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

  const elementsFetcher = useFetcher<
    | { data: { id: string; name: string }[]; error: null }
    | { data: null; error: string }
  >({});

  useEffect(() => {
    if (documentId && versionId) {
      elementsFetcher.load(path.to.api.onShapeElements(documentId, versionId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, versionId]);

  const elementOptions =
    useMemo(() => {
      return (
        elementsFetcher.data?.data?.map((c) => ({
          value: c.id,
          label: c.name,
        })) ?? []
      );
    }, [elementsFetcher.data]) ?? [];

  const isDataLoading =
    documentsFetcher.state === "loading" ||
    versionsFetcher.state === "loading" ||
    elementsFetcher.state === "loading";

  const isReadyForSync =
    documentId &&
    versionId &&
    elementId &&
    documentOptions.some((c) => c.value === documentId) &&
    versionOptions.some((c) => c.value === versionId) &&
    elementOptions.some((c) => c.value === elementId);

  const bomFetcher = useFetcher<
    | { data: null; error: string }
    | {
        data: {
          tree: TreeNode[];
          rows: TreeData[];
        };
        error: null;
      }
  >();

  useEffect(() => {
    if (bomFetcher.data?.data?.rows) {
      setBomRows(bomFetcher.data.data.rows);
    }
  }, [bomFetcher.data]);

  const loadBom = () => {
    if (isReadyForSync) {
      bomFetcher.load(path.to.api.onShapeBom(documentId, versionId, elementId));
    }
  };

  const upsertBomFetcher = useFetcher<typeof onShapeSyncAction>();
  const syncSubmitted = useRef(false);
  const saveBom = () => {
    syncSubmitted.current = true;
    const formData = new FormData();
    formData.append("makeMethodId", makeMethodId);
    formData.append("rows", JSON.stringify(bomRows));
    upsertBomFetcher.submit(formData, {
      method: "post",
      action: path.to.api.onShapeSync,
    });
  };

  useEffect(() => {
    if (
      syncSubmitted.current &&
      upsertBomFetcher.data?.success &&
      bomRows.length > 0
    ) {
      setBomRows([]);
      syncSubmitted.current = false;
      toast.success("BOM synced successfully");
    }

    if (upsertBomFetcher.data?.success === false) {
      toast.error(upsertBomFetcher.data.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bomRows.length, upsertBomFetcher.data]);

  return (
    <div className="flex flex-col gap-2 w-full">
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
                    setElementId(null);
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
                    setElementId(null);
                  }}
                  size="sm"
                  className="text-xs"
                  value={versionId ?? undefined}
                />
              </div>
            </div>

            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">Element:</span>
              <div className="w-[180px]">
                <Combobox
                  isLoading={elementsFetcher.state === "loading"}
                  options={elementOptions}
                  onChange={(value) => {
                    setElementId(value);
                  }}
                  size="sm"
                  className="text-xs"
                  value={elementId ?? undefined}
                />
              </div>
            </div>

            {/* <div className="flex w-full items-center justify-between gap-2">
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
            </div> */}
          </>
        )}
        {lastSyncedAt && (
          <div className="flex items-center gap-1 w-full justify-between">
            <span className="text-xs text-muted-foreground">
              Last synced: {formatDateTime(lastSyncedAt)}
            </span>
            {isDataLoading ? (
              <Spinner className="size-3" />
            ) : (
              <Button
                variant={bomRows.length > 0 ? "secondary" : "primary"}
                isLoading={bomFetcher.state !== "idle"}
                isDisabled={!isReadyForSync || bomFetcher.state !== "idle"}
                size="sm"
                onClick={loadBom}
              >
                {bomRows.length > 0 ? "Refresh" : "Sync"}
              </Button>
            )}
          </div>
        )}
      </div>
      {bomRows.length > 0 && (
        <div className="flex flex-col gap-2 border bg-muted/30 rounded p-2 w-full">
          <HStack className="w-full justify-between">
            <span className="text-xs text-muted-foreground font-light mb-1">
              Bill of Materials
            </span>
            <Button
              size="sm"
              onClick={saveBom}
              isLoading={upsertBomFetcher.state !== "idle"}
              isDisabled={upsertBomFetcher.state !== "idle"}
            >
              Save
            </Button>
          </HStack>

          <div className="max-h-60 overflow-y-auto flex flex-col">
            {bomRows.map((row) => (
              <div
                key={row.index}
                className={cn(
                  "flex min-h-8 cursor-pointer items-center overflow-hidden rounded-sm pr-2 w-full gap-1 hover:bg-muted/90"
                )}
                style={{
                  paddingLeft: `${row.level * 12}px`,
                }}
              >
                <div
                  className={cn(
                    "flex items-center gap-2 font-medium text-sm w-full",
                    row.level > 1 && "opacity-50"
                  )}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <MethodIcon type={row.defaultMethodType} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuRadioGroup
                        value={row.defaultMethodType}
                        onValueChange={(value) => {
                          setBomRows((prevRows) =>
                            prevRows.map((r) =>
                              r.index === row.index
                                ? { ...r, defaultMethodType: value }
                                : r
                            )
                          );
                        }}
                      >
                        {methodType.map((type) => (
                          <DropdownMenuRadioItem key={type} value={type}>
                            <DropdownMenuIcon
                              icon={<MethodIcon type={type} />}
                            />
                            {type}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <span className="line-clamp-1">
                    {row.readableId || row.name}
                  </span>
                  {!row.id && <PulsingDot className="mt-0.5" />}
                </div>
                <HStack spacing={1}>
                  <Badge className="text-xs" variant="outline">
                    {row.quantity}
                  </Badge>
                </HStack>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
