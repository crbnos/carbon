import type { Database, Json } from "@carbon/database";
import {
  Badge,
  cn,
  Count,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Skeleton,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { useParams } from "@remix-run/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import {
  LuChevronRight,
  LuEllipsisVertical,
  LuPencil,
  LuPlus,
  LuSearch,
  LuStar,
  LuTruck,
} from "react-icons/lu";
import { z } from "zod";
import { Hyperlink, MethodIcon } from "~/components";
import { Confirm } from "~/components/Modals";
import { LevelLine } from "~/components/TreeView";
import { usePermissions } from "~/hooks";
import type { MethodItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { getReadableIdWithRevision } from "~/utils/string";
import { getPathToMakeMethod } from "../Methods/utils";
import RevisionForm from "./RevisionForm";

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
  | Database["public"]["Enums"]["itemType"]
  | "jobMaterials"
  | "jobs"
  | "methodMaterials"
  | "purchaseOrderLines"
  | "receiptLines"
  | "quoteLines"
  | "quoteMaterials"
  | "salesOrderLines"
  | "shipmentLines"
  | "supplierQuotes";

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
    revision?: string;
    version?: number;
  }[];
};

const revisionValidator = z.array(
  z.object({
    id: z.string(),
    revision: z.string(),
    methodType: z.string(),
    type: z.string(),
  })
);

export function UsedInTree({
  tree,
  revisions: revisionsJson,
  itemReadableId,
  itemReadableIdWithRevision,
  hasSizesInsteadOfRevisions = false,
}: {
  tree: UsedInNode[];
  revisions?: Json;
  itemReadableId: string;
  itemReadableIdWithRevision: string;
  hasSizesInsteadOfRevisions?: boolean;
}) {
  const [filterText, setFilterText] = useState("");

  const revisions = (revisionValidator.safeParse(revisionsJson)?.data ?? [])
    ?.map((r) => ({
      id: r.id,
      documentReadableId: getReadableIdWithRevision(itemReadableId, r.revision),
      methodType: r.methodType,
      type: r.type,
      revision: r.revision,
    }))
    .sort((a, b) => {
      // First sort by length (descending)
      if (a.revision.length !== b.revision.length) {
        return b.revision.length - a.revision.length;
      }
      // Then sort alphabetically (descending)
      return b.revision.localeCompare(a.revision);
    });

  return (
    <VStack className="w-full p-2">
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
        <RevisionsItem
          filterText={filterText}
          node={{
            key: (revisions?.[0]?.type as UsedInKey) ?? "Part",
            name: hasSizesInsteadOfRevisions ? "Sizes" : "Revisions",
            module: "parts",
            children: revisions,
          }}
          maxRevision={revisions?.[0]?.revision ?? ""}
          hasSizesInsteadOfRevisions={hasSizesInsteadOfRevisions}
        />
        {tree.map((node) => (
          <UsedInItem
            key={node.key}
            filterText={filterText}
            node={node}
            itemReadableIdWithRevision={itemReadableIdWithRevision}
          />
        ))}
      </VStack>
    </VStack>
  );
}

export function RevisionsItem({
  node,
  filterText,
  maxRevision,
  hasSizesInsteadOfRevisions = false,
}: {
  node: UsedInNode;
  filterText: string;
  maxRevision: string;
  hasSizesInsteadOfRevisions?: boolean;
}) {
  const { itemId } = useParams();
  const permissions = usePermissions();
  const revisionDisclosure = useDisclosure();
  const defaultDisclosure = useDisclosure();

  const [selectedRevision, setSelectedRevision] = useState<{
    id?: string;
    copyFromId?: string;
    type: "Part" | "Material" | "Tool" | "Service" | "Consumable";
    revision: string;
  } | null>();
  const [isExpanded, setIsExpanded] = useState(
    node.children.length > 0 && node.children.length < 10
  );

  const filteredChildren = node.children.filter((child) =>
    child.documentReadableId.toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <>
      <div className="relative w-full">
        <button
          className="flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-2 gap-2 text-sm hover:bg-muted/90 w-full font-medium"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          <div className="h-8 w-4 flex items-center justify-center">
            <LuChevronRight
              className={cn("size-4", isExpanded && "rotate-90")}
            />
          </div>
          <div className="flex flex-grow items-center justify-between gap-2 pr-6">
            <span>{node.name}</span>

            {filteredChildren.length > 0 && (
              <Count count={filteredChildren.length} />
            )}
          </div>
        </button>
        {permissions.can("create", "parts") && (
          <IconButton
            size="sm"
            variant="secondary"
            icon={<LuPlus />}
            aria-label="Create"
            className="size-5 absolute right-2 top-1.5"
            onClick={() => {
              flushSync(() => {
                setSelectedRevision({
                  copyFromId: itemId,
                  type: node.key as "Part",
                  revision: hasSizesInsteadOfRevisions
                    ? ""
                    : getNextRevision(maxRevision),
                });
                revisionDisclosure.onOpen();
              });
            }}
          />
        )}
      </div>
      {isExpanded && (
        <div className="flex flex-col w-full relative ">
          {node.children.length === 0 ? (
            <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-4">
              <LevelLine isSelected={false} />
              <div className="text-xs text-muted-foreground">
                No {node.name.toLowerCase()} found
              </div>
            </div>
          ) : (
            filteredChildren.map((child, index) => {
              const isActive = child.id === itemId;
              return (
                <div className="relative group/used-in" key={index}>
                  <Hyperlink
                    to={getUseInLink(child, node.key, "")}
                    className={cn(
                      "pr-6 flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-1 gap-4 text-sm hover:bg-muted/90 w-full font-medium whitespace-nowrap",
                      isActive && "bg-muted/90"
                    )}
                  >
                    <LevelLine isSelected={isActive} className="mr-2" />
                    <MethodIcon
                      type={child.methodType ?? "Method"}
                      className="mr-2"
                    />
                    <span className="truncate">{child.documentReadableId}</span>
                  </Hyperlink>
                  {permissions.can("update", "parts") && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          size="sm"
                          variant="secondary"
                          icon={<LuEllipsisVertical />}
                          aria-label="Edit"
                          className="absolute right-2 top-1 flex-shrink-0 opacity-0 group-hover/used-in:opacity-100 data-[state=open]:opacity-100"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            flushSync(() => {
                              setSelectedRevision({
                                id: child.id,
                                type: node.key as "Part",
                                revision: child.revision ?? "",
                              });
                              revisionDisclosure.onOpen();
                            });
                          }}
                        >
                          <DropdownMenuIcon icon={<LuPencil />} />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            flushSync(() => {
                              setSelectedRevision({
                                id: child.id,
                                type: node.key as "Part",
                                revision: child.revision ?? "",
                              });
                              defaultDisclosure.onOpen();
                            });
                          }}
                        >
                          <DropdownMenuIcon icon={<LuStar />} />
                          Set as Default{" "}
                          {hasSizesInsteadOfRevisions ? "Size" : "Revision"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {revisionDisclosure.isOpen && selectedRevision && (
        <RevisionForm
          initialValues={selectedRevision!}
          onClose={revisionDisclosure.onClose}
          hasSizesInsteadOfRevisions={hasSizesInsteadOfRevisions}
        />
      )}
      {defaultDisclosure.isOpen && selectedRevision && (
        <Confirm
          action={path.to.defaultRevision(selectedRevision.id!)}
          confirmText={`Make Default`}
          title={`Make ${hasSizesInsteadOfRevisions ? "size" : "revision"} ${
            selectedRevision.revision
          } default?`}
          text={`This will replace all method materials of other ${
            hasSizesInsteadOfRevisions ? "sizes" : "revisions"
          } with this ${hasSizesInsteadOfRevisions ? "size" : "revision"}.`}
          isOpen
          onSubmit={() => {
            defaultDisclosure.onClose();
            setSelectedRevision(null);
          }}
          onCancel={defaultDisclosure.onClose}
        />
      )}
    </>
  );
}

function getNextRevision(maxRevision: string) {
  if (/^\d+$/.test(maxRevision)) {
    return (parseInt(maxRevision) + 1).toString();
  } else if (/^[A-Z]{1,2}$/.test(maxRevision)) {
    // Handle single letter case
    if (maxRevision.length === 1) {
      return maxRevision === "Z"
        ? "AA"
        : String.fromCharCode(maxRevision.charCodeAt(0) + 1);
    }
    // Handle double letter case
    const firstChar = maxRevision[0];
    const secondChar = maxRevision[1];
    if (secondChar === "Z") {
      return String.fromCharCode(firstChar.charCodeAt(0) + 1) + "A";
    }
    return firstChar + String.fromCharCode(secondChar.charCodeAt(0) + 1);
  }
  return maxRevision;
}

export function UsedInItem({
  node,
  itemReadableIdWithRevision,
  filterText,
}: {
  node: UsedInNode;
  filterText: string;
  itemReadableIdWithRevision: string;
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
                to={getUseInLink(child, node.key, itemReadableIdWithRevision)}
                className="flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-1 gap-4 text-sm hover:bg-muted/90 w-full font-medium whitespace-nowrap"
              >
                <LevelLine isSelected={false} className="mr-2" />
                {child.methodType === "Shipment" ? (
                  <LuTruck className="mr-2 text-indigo-600" />
                ) : (
                  <MethodIcon
                    type={child.methodType ?? "Method"}
                    className="mr-2"
                  />
                )}
                <span className="truncate">{child.documentReadableId}</span>
                {child.version && (
                  <Badge variant="outline" className="ml-2">
                    V{child.version}
                  </Badge>
                )}
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
  itemReadableIdWithRevision: string
) {
  switch (key) {
    case "Part":
      return path.to.partDetails(child.id);
    case "Material":
      return path.to.materialDetails(child.id);
    case "Tool":
      return path.to.toolDetails(child.id);
    case "Consumable":
      return path.to.consumableDetails(child.id);
    case "Service":
      return path.to.serviceDetails(child.id);
    case "jobs":
      return path.to.job(child.id);
    case "jobMaterials":
      if (!child.documentId) return "#";
      return `${path.to.jobMaterials(
        child.documentId
      )}?filter=itemReadableId:eq:${itemReadableIdWithRevision}`;
    case "methodMaterials":
      if (!child.documentId || !child.itemType) return "#";
      return getPathToMakeMethod(
        child.itemType,
        child.documentParentId!,
        child.documentId
      );
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
    case "shipmentLines":
      if (!child.documentId) return "#";
      return path.to.shipment(child.documentId);
    case "supplierQuotes":
      if (!child.documentId) return "#";
      return path.to.supplierQuote(child.documentId);
    default:
      return "#";
  }
}
