import {
  Skeleton,
  VStack,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  cn,
  Count,
} from "@carbon/react";
import { useState } from "react";
import { LuSearch, LuChevronRight } from "react-icons/lu";
import { MethodIcon, Hyperlink } from "~/components";
import { LevelLine } from "~/components/TreeView";
import { usePermissions } from "~/hooks";
import { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { getLinkToItemManufacturing } from "./ItemForm";

export function UsedInSkeleton() {
  return (
    <div className="flex flex-col gap-1 w-full">
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-full" />
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-7 w-1/2" />
    </div>
  );
}

export type UsedInKey =
  | "jobMaterials"
  | "jobs"
  | "methodMaterials"
  | "purchaseOrderLines"
  | "receiptLines"
  | "quoteLines"
  | "quoteMaterials"
  | "salesOrderLines";

export type UsedInNode = {
  key: UsedInKey;
  name: string;
  module: string;
  children: {
    id: string;
    documentReadableId: string;
    documentId?: string;
    documentParentId?: string;
    itemType?: MethodItemType;
    methodType?: string;
  }[];
};

export function UsedInTree({
  tree,
  itemReadableId,
}: {
  tree: UsedInNode[];
  itemReadableId: string;
}) {
  const [filterText, setFilterText] = useState("");

  return (
    <VStack>
      <HStack className="w-full py">
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
      <VStack spacing={0}>
        {tree.map((node) => (
          <UsedInItem
            key={node.key}
            filterText={filterText}
            node={node}
            itemReadableId={itemReadableId}
          />
        ))}
      </VStack>
    </VStack>
  );
}

export function UsedInItem({
  node,
  itemReadableId,
  filterText,
}: {
  node: UsedInNode;
  itemReadableId: string;
  filterText: string;
}) {
  const [isExpanded, setIsExpanded] = useState(
    node.children.length > 0 && node.children.length < 10
  );
  const permissions = usePermissions();

  if (!permissions.can("view", node.module)) {
    return null;
  }

  const filteredChildren = node.children.filter((child) =>
    child.documentReadableId.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <>
      <button
        className="flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-2 gap-2 text-sm hover:bg-muted/90 w-full font-medium"
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="h-8 w-4 flex items-center justify-center">
          <LuChevronRight className={cn("size-4", isExpanded && "rotate-90")} />
        </div>
        <div className="flex flex-grow items-center justify-between gap-2">
          <span>{node.name}</span>
          {filteredChildren.length > 0 && (
            <Count count={filteredChildren.length} />
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="flex flex-col w-full">
          {node.children.length === 0 ? (
            <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-4">
              <LevelLine isSelected={false} />
              <div className="text-xs text-muted-foreground">
                No {node.name.toLowerCase()} found
              </div>
            </div>
          ) : (
            filteredChildren.map((child, index) => (
              <Hyperlink
                key={index}
                to={getUseInLink(child, node.key, itemReadableId)}
                className="flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-1 gap-4 text-sm hover:bg-muted/90 w-full font-medium"
              >
                <LevelLine isSelected={false} className="mr-2" />
                <MethodIcon
                  type={child.methodType ?? "Method"}
                  className="mr-2"
                />
                {child.documentReadableId}
              </Hyperlink>
            ))
          )}
        </div>
      )}
    </>
  );
}

function getUseInLink(
  child: UsedInNode["children"][number],
  key: UsedInKey,
  itemReadableId: string
) {
  switch (key) {
    case "jobs":
      return path.to.job(child.id);
    case "jobMaterials":
      if (!child.documentId) return "#";
      return `${path.to.jobMaterials(
        child.documentId
      )}?filter=itemReadableId:eq:${itemReadableId}`;
    case "methodMaterials":
      if (!child.documentId || !child.itemType) return "#";
      return getLinkToItemManufacturing(child.itemType, child.documentId);
    case "purchaseOrderLines":
      if (!child.documentId) return "#";
      return path.to.purchaseOrder(child.documentId);
    case "receiptLines":
      if (!child.documentId) return "#";
      return path.to.receipt(child.documentId);
    case "quoteLines":
      if (!child.documentId) return "#";
      return path.to.quote(child.documentId);
    case "quoteMaterials":
      if (!child.documentId || !child.documentParentId) return "#";
      return path.to.quoteLine(child.documentParentId, child.documentId);
    case "salesOrderLines":
      if (!child.documentId) return "#";
      return path.to.salesOrder(child.documentId);
    default:
      return "#";
  }
}
