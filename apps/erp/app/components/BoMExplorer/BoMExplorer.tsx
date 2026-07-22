import { PreviewCard } from "@base-ui-components/react/preview-card";
import {
  Badge,
  Copy,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useRef, useState } from "react";
import {
  LuBraces,
  LuChevronDown,
  LuChevronRight,
  LuChevronsUpDown,
  LuEllipsisVertical,
  LuExternalLink,
  LuSearch,
  LuTable
} from "react-icons/lu";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useOptimisticLocation } from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import { generateBomIds } from "~/utils/bom";
import { MethodIcon, MethodItemTypeIcon, OnshapeStatus } from "../Icons";
import type { FlatTree, FlatTreeItem, NodeState } from "../TreeView";
import { LevelLine, TreeView, useTree } from "../TreeView";

/**
 * Structural contract every BoM tree node (JobMethod / Method / QuoteMethod)
 * satisfies. Variants may carry extra fields; the shared explorer only reads
 * these.
 */
export type BoMExplorerNodeData = {
  description: string;
  itemReadableId: string;
  itemId: string;
  itemType: string;
  methodType: string;
  quantity: number;
  methodMaterialId: string;
  kit?: boolean | null;
  isRoot?: boolean | null;
  version?: string | number | null;
  unitOfMeasureCode?: string | null;
  externalId?: unknown;
  isPickDescendant?: boolean | null;
};

type BoMNode = FlatTreeItem<BoMExplorerNodeData>;

type BoMExplorerContextValue = {
  tree: FlatTree<BoMExplorerNodeData>;
  nodes: ReturnType<typeof useTree>["nodes"];
  getTreeProps: ReturnType<typeof useTree>["getTreeProps"];
  getNodeProps: ReturnType<typeof useTree>["getNodeProps"];
  virtualizer: ReturnType<typeof useTree>["virtualizer"];
  parentRef: React.MutableRefObject<HTMLDivElement | null>;
  toggleExpandNode: (id: string) => void;
  expandAllBelowDepth: (depth: number) => void;
  collapseAllBelowDepth: (depth: number) => void;
  selectNode: (id: string, scrollIntoView?: boolean) => void;
  deselectAllNodes: () => void;
  allExpanded: boolean;
  filterText: string;
  setFilterText: (text: string) => void;
  bomIdMap: Map<string, string>;
  getNodePath: (node: BoMNode) => string;
  getRootVersion: (node: BoMNode) => string | number | null | undefined;
  onNodeClick: (node: BoMNode) => void;
};

const BoMExplorerContext = createContext<BoMExplorerContextValue | null>(null);

export function useBoMExplorer() {
  const context = useContext(BoMExplorerContext);
  if (!context) {
    throw new Error("useBoMExplorer must be used within a BoMExplorerProvider");
  }
  return context;
}

type BoMExplorerProviderProps<T extends BoMExplorerNodeData> = {
  tree: FlatTree<T>;
  /**
   * Route for a node. May include a query string (e.g. `?methodId=`) — the
   * shared click handler appends `materialId` with the right separator.
   */
  getNodePath: (node: FlatTreeItem<T>) => string;
  /** Version shown on the root node's badge. Defaults to `node.data.version`. */
  getRootVersion?: (
    node: FlatTreeItem<T>
  ) => string | number | null | undefined;
  /** Controlled filter text (e.g. from an external search input). */
  filterText?: string;
  children: ReactNode;
};

export function BoMExplorerProvider<T extends BoMExplorerNodeData>({
  tree: treeProp,
  getNodePath: getNodePathProp,
  getRootVersion: getRootVersionProp,
  filterText: filterTextProp,
  children
}: BoMExplorerProviderProps<T>) {
  const tree = treeProp as FlatTree<BoMExplorerNodeData>;
  const getNodePath = getNodePathProp as (node: BoMNode) => string;
  const getRootVersion =
    (getRootVersionProp as
      | ((node: BoMNode) => string | number | null | undefined)
      | undefined) ?? ((node: BoMNode) => node.data.version);

  const parentRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useOptimisticLocation();
  const [, setSearchParams] = useSearchParams();

  const [filterTextInternal, setFilterTextInternal] = useState("");
  const filterText = filterTextProp ?? filterTextInternal;

  const {
    nodes,
    getTreeProps,
    getNodeProps,
    toggleExpandNode,
    expandAllBelowDepth,
    collapseAllBelowDepth,
    deselectAllNodes,
    selectNode,
    virtualizer
  } = useTree({
    tree,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: selection is URL-driven
    onSelectedIdChanged: () => {},
    estimatedRowHeight: () => 32,
    parentRef,
    filter: {
      value: { text: filterText },
      fn: (value, node) => {
        if (value.text === "") return true;
        return node.data.description
          .toLowerCase()
          .includes(value.text.toLowerCase());
      }
    },
    isEager: true
  });

  const allExpanded = useMemo(
    () => tree.every((m) => !m.hasChildren || nodes[m.id]?.expanded),
    [tree, nodes]
  );

  // Generate hierarchical BOM IDs (1, 1.1, 1.1.1, etc.)
  const bomIds = useMemo(() => generateBomIds(tree), [tree]);
  const bomIdMap = useMemo(
    () => new Map(tree.map((node, index) => [node.id, bomIds[index]])),
    [tree, bomIds]
  );

  const onNodeClick = (node: BoMNode) => {
    selectNode(node.id, false);

    const nodePath = getNodePath(node);
    const separator = nodePath.includes("?") ? "&" : "?";
    const fullPath = `${nodePath}${separator}materialId=${node.data.methodMaterialId}`;
    const nodePathname = nodePath.split("?")[0];

    if (location.pathname !== nodePathname) {
      navigate(fullPath, { replace: true });
    } else {
      setSearchParams((prev) => {
        prev.set("materialId", node.data.methodMaterialId);
        return prev;
      });
    }
  };

  return (
    <BoMExplorerContext.Provider
      value={{
        tree,
        nodes,
        getTreeProps,
        getNodeProps,
        virtualizer,
        parentRef,
        toggleExpandNode,
        expandAllBelowDepth,
        collapseAllBelowDepth,
        selectNode,
        deselectAllNodes,
        allExpanded,
        filterText,
        setFilterText: setFilterTextInternal,
        bomIdMap,
        getNodePath,
        getRootVersion,
        onNodeClick
      }}
    >
      {children}
    </BoMExplorerContext.Provider>
  );
}

export function BoMExplorerSearch() {
  const { t } = useLingui();
  const { filterText, setFilterText } = useBoMExplorer();

  return (
    <InputGroup size="sm" className="flex flex-grow">
      <InputLeftElement>
        <LuSearch className="h-4 w-4" />
      </InputLeftElement>
      <Input
        placeholder={t`Search...`}
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
      />
    </InputGroup>
  );
}

type BoMExplorerActionsProps = {
  triggerVariant?: "ghost" | "secondary";
  children?: ReactNode;
};

/**
 * Dropdown with the shared expand/collapse action; variant-specific items
 * (export links, etc.) compose in as children.
 */
export function BoMExplorerActions({
  triggerVariant = "secondary",
  children
}: BoMExplorerActionsProps) {
  const { t } = useLingui();
  const { allExpanded, expandAllBelowDepth, collapseAllBelowDepth } =
    useBoMExplorer();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          aria-label={t`Actions`}
          variant={triggerVariant}
          size="sm"
          icon={<LuEllipsisVertical />}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => {
            if (allExpanded) {
              collapseAllBelowDepth(1);
            } else {
              expandAllBelowDepth(0);
            }
          }}
        >
          <DropdownMenuIcon icon={<LuChevronsUpDown />} />
          {allExpanded ? (
            <Trans>Collapse all</Trans>
          ) : (
            <Trans>Expand all</Trans>
          )}
        </DropdownMenuItem>
        {children && (
          <>
            <DropdownMenuSeparator />
            {children}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type BoMExportMenuItemsProps = {
  csvHref: (withOperations: boolean) => string;
  jsonHref: (withOperations: boolean) => string;
};

/**
 * The four BoM / BoM+BoP export links. Pure props (no context) so it also
 * works in standalone menus like BoMActions.
 */
export function BoMExportMenuItems({
  csvHref,
  jsonHref
}: BoMExportMenuItemsProps) {
  return (
    <>
      <DropdownMenuItem asChild>
        <a href={csvHref(false)} target="_blank" rel="noreferrer">
          <DropdownMenuIcon icon={<LuTable />} />
          <div className="flex flex-grow items-center gap-4 justify-between">
            <span>BoM</span>
            <Badge variant="green" className="text-xs">
              CSV
            </Badge>
          </div>
        </a>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <a href={csvHref(true)} target="_blank" rel="noreferrer">
          <DropdownMenuIcon icon={<LuTable />} />
          <div className="flex flex-grow items-center gap-4 justify-between">
            <span>BoM + BoP</span>
            <Badge variant="green" className="text-xs">
              CSV
            </Badge>
          </div>
        </a>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <a href={jsonHref(false)} target="_blank" rel="noreferrer">
          <DropdownMenuIcon icon={<LuBraces />} />
          <div className="flex flex-grow items-center gap-4 justify-between">
            <span>BoM</span>
            <Badge variant="outline" className="text-xs">
              JSON
            </Badge>
          </div>
        </a>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <a href={jsonHref(true)} target="_blank" rel="noreferrer">
          <DropdownMenuIcon icon={<LuBraces />} />
          <div className="flex flex-grow items-center gap-4 justify-between">
            <span>BoM + BoP</span>
            <Badge variant="outline" className="text-xs">
              JSON
            </Badge>
          </div>
        </a>
      </DropdownMenuItem>
    </>
  );
}

type BoMExplorerTreeProps = {
  className?: string;
  /**
   * Render prop for rows that need variant extras. Defaults to a plain
   * `<BoMExplorerRow />`.
   */
  children?: (params: { node: BoMNode; state: NodeState }) => ReactNode;
};

export function BoMExplorerTree({ className, children }: BoMExplorerTreeProps) {
  const { tree, nodes, getNodeProps, getTreeProps, parentRef, virtualizer } =
    useBoMExplorer();

  return (
    <div className={cn("flex flex-1 min-h-0 w-full", className)}>
      <TreeView
        parentRef={parentRef}
        virtualizer={virtualizer}
        autoFocus
        tree={tree}
        nodes={nodes}
        getNodeProps={getNodeProps}
        getTreeProps={getTreeProps}
        parentClassName="h-full"
        renderNode={({ node, state }) =>
          children ? (
            children({ node, state })
          ) : (
            <BoMExplorerRow node={node} state={state} />
          )
        }
      />
    </div>
  );
}

type BoMExplorerRowProps = {
  node: BoMNode;
  state: NodeState;
  /** Variant extras rendered in the row's trailing badge area. */
  children?: ReactNode;
};

export function BoMExplorerRow({ node, state, children }: BoMExplorerRowProps) {
  const {
    bomIdMap,
    toggleExpandNode,
    expandAllBelowDepth,
    collapseAllBelowDepth,
    getRootVersion,
    onNodeClick
  } = useBoMExplorer();

  // Suppress the preview only while the pointer is over variant badge extras
  // (e.g. the job order-status badge), so their own tooltips are readable
  // without the large preview card overlapping. The rest of the row — qty and
  // version badges included — is a normal hover target for the preview.
  const [isBadgeHovered, setIsBadgeHovered] = useState(false);

  const bomId = bomIdMap.get(node.id);

  return (
    // Uncontrolled: Base UI owns hover open/close per row.
    <PreviewCard.Root>
      <PreviewCard.Trigger
        delay={200}
        closeDelay={100}
        render={
          <div
            key={node.id}
            className={cn(
              "flex h-8 cursor-pointer items-center overflow-hidden rounded-sm pr-2 gap-1 group/node",
              state.selected
                ? "bg-muted hover:bg-accent"
                : "bg-transparent hover:bg-accent",
              node.data.isPickDescendant && "opacity-60"
            )}
            onClick={() => onNodeClick(node)}
          />
        }
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

        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          <div className="flex flex-1 min-w-0 items-center gap-2 overflow-hidden">
            {bomId && (
              <Badge variant="outline" className="flex-shrink-0">
                {bomId}
              </Badge>
            )}
            <BoMNodeText node={node} />
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {node.data.isRoot ? (
              <Badge variant="outline" className="whitespace-nowrap">
                V{getRootVersion(node)}
              </Badge>
            ) : (
              <BoMNodeData node={node} />
            )}
            {children && (
              <div
                className="flex items-center gap-1"
                onPointerEnter={() => setIsBadgeHovered(true)}
                onPointerLeave={() => setIsBadgeHovered(false)}
              >
                {children}
              </div>
            )}
          </div>
        </div>
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="right" sideOffset={4} className="z-[100]">
          {/* Visibility (not `open`) handles badge-hover suppression so the
              badge's own tooltip is readable without touching open state. */}
          <PreviewCard.Popup
            className={cn(
              "w-64 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none",
              isBadgeHovered && "invisible"
            )}
          >
            <BoMNodePreview node={node} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

function getOnshapeState(node: BoMNode, hasOnshape: boolean) {
  if (!hasOnshape) return null;
  // @ts-expect-error -- externalId is untyped JSON
  // biome-ignore lint/complexity/useLiteralKeys: untyped JSON access
  return node.data.externalId?.["onshapeData"]?.["State"] ?? null;
}

function BoMNodeText({ node }: { node: BoMNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="font-medium text-sm truncate">
        {node.data.description || node.data.itemReadableId}
      </span>
    </div>
  );
}

function BoMNodeData({ node }: { node: BoMNode }) {
  const integrations = useIntegrations();
  const onShapeState = getOnshapeState(node, integrations.has("onshape"));

  return (
    <HStack spacing={1}>
      <Badge className="text-xs" variant="outline">
        <MethodIcon
          type={node.data.methodType}
          isKit={node.data.kit ?? undefined}
          className="mr-2"
        />
        {node.data.quantity}
      </Badge>
      {onShapeState && <OnshapeStatus status={onShapeState} />}
    </HStack>
  );
}

function BoMNodePreview({ node }: { node: BoMNode }) {
  const { t } = useLingui();
  const integrations = useIntegrations();
  const onShapeState = getOnshapeState(node, integrations.has("onshape"));

  return (
    <VStack className="w-full text-sm">
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          <Trans>Item ID</Trans>
        </span>
        <HStack className="w-full justify-between">
          <span>{node.data.itemReadableId}</span>
          <HStack spacing={1}>
            <Copy text={node.data.itemReadableId} tooltipClassName="z-[110]" />
            <Link
              to={getLinkToItemDetails(
                node.data.itemType as "Part",
                node.data.itemId
              )}
              target="_blank"
            >
              <IconButton
                aria-label={t`View Item Master`}
                size="sm"
                variant="secondary"
                icon={<LuExternalLink />}
              />
            </Link>
          </HStack>
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          <Trans>Description</Trans>
        </span>
        <HStack className="w-full justify-between">
          <span>{node.data.description}</span>
          <Copy text={node.data.description} tooltipClassName="z-[110]" />
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          <Trans>Quantity</Trans>
        </span>
        <HStack className="w-full justify-between">
          <span>
            {node.data.quantity}
            {node.data.unitOfMeasureCode
              ? ` ${node.data.unitOfMeasureCode}`
              : ""}
          </span>
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          <Trans>Method</Trans>
        </span>
        <HStack className="w-full">
          <MethodIcon type={node.data.methodType} />
          <span>{node.data.methodType}</span>
        </HStack>
      </VStack>
      <VStack spacing={1}>
        <span className="text-xs text-muted-foreground font-medium">
          <Trans>Item Type</Trans>
        </span>
        <HStack className="w-full">
          <MethodItemTypeIcon type={node.data.itemType} />
          <span>{node.data.itemType}</span>
        </HStack>
      </VStack>
      {node.data.methodType === "Make to Order" &&
        node.data.version != null && (
          <VStack spacing={1}>
            <span className="text-xs text-muted-foreground font-medium">
              <Trans>Make Method Version</Trans>
            </span>
            <HStack className="w-full">
              <Badge variant="outline">V{node.data.version}</Badge>
            </HStack>
          </VStack>
        )}
      {onShapeState && (
        <VStack spacing={1}>
          <span className="text-xs text-muted-foreground font-medium">
            <Trans>Onshape Status</Trans>
          </span>
          <HStack className="w-full">
            <OnshapeStatus status={onShapeState} />
            <span>{onShapeState}</span>
          </HStack>
        </VStack>
      )}
    </VStack>
  );
}
