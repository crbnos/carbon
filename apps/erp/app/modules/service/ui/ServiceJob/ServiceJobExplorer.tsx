// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Count,
  cn,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  ScrollArea,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuBox,
  LuChevronRight,
  LuClock,
  LuFileText,
  LuReceipt,
  LuSearch
} from "react-icons/lu";
import { Link } from "react-router";
import { LevelLine } from "~/components/TreeView";
import { useDateFormatter, useQuantityFormatter } from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType } from "~/modules/shared/types";
import { useItems } from "~/stores/items";
import type {
  ServiceJobEstimateLine,
  ServiceJobItem,
  ServiceJobTime
} from "../../types";

export type ServiceJobExplorerChild =
  | (ServiceJobEstimateLine & { type: "estimate" })
  | (ServiceJobTime & { type: "time" })
  | (ServiceJobItem & { type: "item" });

type ServiceJobExplorerNode = {
  key: "estimate" | "time" | "items";
  pluralName: string;
  emptyText: string;
  children: ServiceJobExplorerChild[];
};

/**
 * The job's work, left of the page: its estimate lines, the time logged on
 * it, and the parts and charges on it.
 */
export function ServiceJobExplorer({
  estimateLines,
  time,
  items
}: {
  estimateLines: ServiceJobEstimateLine[];
  time: ServiceJobTime[];
  items: ServiceJobItem[];
}) {
  const { t } = useLingui();
  const [filterText, setFilterText] = useState("");

  const tree: ServiceJobExplorerNode[] = [
    {
      key: "estimate",
      pluralName: t`Estimate`,
      emptyText: t`No estimate lines`,
      children: estimateLines.map((line) => ({
        ...line,
        type: "estimate" as const
      }))
    },
    {
      key: "time",
      pluralName: t`Time`,
      emptyText: t`No time logged`,
      children: time.map((entry) => ({ ...entry, type: "time" as const }))
    },
    {
      key: "items",
      pluralName: t`Parts`,
      emptyText: t`No parts or charges`,
      children: items.map((item) => ({ ...item, type: "item" as const }))
    }
  ];

  return (
    <ScrollArea className="h-full">
      <VStack className="px-2">
        <HStack className="w-full py-2">
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
        </HStack>
        <VStack spacing={0}>
          {tree.map((node) => (
            <ServiceJobExplorerItem
              key={node.key}
              node={node}
              filterText={filterText}
            />
          ))}
        </VStack>
      </VStack>
    </ScrollArea>
  );
}

function ServiceJobExplorerItem({
  node,
  filterText
}: {
  node: ServiceJobExplorerNode;
  filterText: string;
}) {
  const [isExpanded, setIsExpanded] = useState(
    node.children.length > 0 && node.children.length < 10
  );
  const getLabel = useChildLabel();

  const filteredChildren = node.children.filter((child) =>
    getLabel(child).toLowerCase().includes(filterText.toLowerCase())
  );

  return (
    <>
      <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-2 text-sm w-full hover:bg-accent">
        <button
          type="button"
          className="flex flex-grow cursor-pointer items-center overflow-hidden font-medium"
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
          <div className="flex flex-grow items-center justify-between gap-2">
            <span>{node.pluralName}</span>
            {filteredChildren.length > 0 && (
              <Count count={filteredChildren.length} />
            )}
          </div>
        </button>
      </div>

      {isExpanded && (
        <div className="flex flex-col w-full px-2">
          {node.children.length === 0 ? (
            <div className="flex h-8 items-center overflow-hidden rounded-sm px-2 gap-4">
              <LevelLine isSelected={false} />
              <div className="text-xs text-muted-foreground">
                {node.emptyText}
              </div>
            </div>
          ) : (
            filteredChildren.map((child) => (
              <ServiceJobExplorerChildItem
                key={child.id}
                child={child}
                label={getLabel(child)}
              />
            ))
          )}
        </div>
      )}
    </>
  );
}

function ServiceJobExplorerChildItem({
  child,
  label
}: {
  child: ServiceJobExplorerChild;
  label: string;
}) {
  const [items] = useItems();
  const formatQuantity = useQuantityFormatter();
  const link = getChildLink(child, items);

  const content = (
    <div className="flex h-8 cursor-pointer items-center overflow-hidden rounded-sm px-1 gap-2 text-sm hover:bg-accent w-full font-medium whitespace-nowrap">
      <LevelLine isSelected={false} />
      <div className="flex flex-grow items-center gap-2 min-w-0">
        <span className="shrink-0">{getChildIcon(child)}</span>
        <span className="truncate">{label}</span>
      </div>
      {child.type !== "time" && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatQuantity(child.quantity ?? 0)}
        </span>
      )}
    </div>
  );

  return link ? (
    <Link to={link} className="flex w-full">
      {content}
    </Link>
  ) : (
    <div className="flex w-full">{content}</div>
  );
}

function getChildIcon(child: ServiceJobExplorerChild) {
  switch (child.type) {
    case "estimate":
      return <LuFileText className="text-muted-foreground" />;
    case "time":
      return <LuClock className="text-blue-500" />;
    case "item":
      return child.lineType === "Charge" ? (
        <LuReceipt className="text-muted-foreground" />
      ) : (
        <LuBox className="text-blue-500" />
      );
  }
}

/** A row's text: the item, or "Name · Date · Hours" for a time entry. */
function useChildLabel() {
  const { t } = useLingui();
  const { formatDate } = useDateFormatter();
  const formatQuantity = useQuantityFormatter();

  return (child: ServiceJobExplorerChild): string => {
    switch (child.type) {
      case "estimate":
        return child.item?.name ?? child.description ?? child.itemId;
      case "item":
        return child.item?.name ?? child.description ?? child.itemId;
      case "time": {
        const hours = formatQuantity(child.hours);
        return [
          child.employee?.fullName,
          formatDate(child.entryDate),
          t`${hours} h`
        ]
          .filter(Boolean)
          .join(" · ");
      }
    }
  };
}

function getChildLink(
  child: ServiceJobExplorerChild,
  items: ReturnType<typeof useItems>[0]
): string | null {
  if (child.type === "time") return null;
  const item = items.find((i) => i.id === child.itemId);
  if (!item) return null;
  return getLinkToItemDetails(item.type as MethodItemType, child.itemId);
}

export default ServiceJobExplorer;
