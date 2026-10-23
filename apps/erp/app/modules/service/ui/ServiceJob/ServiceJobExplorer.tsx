// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Count,
  cn,
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
  MENU_ITEM_SHORTCUTS,
  ScrollArea,
  useDisclosure,
  VStack
} from "@carbon/react";
import { isServiceJobLocked } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { flushSync } from "react-dom";
import {
  LuBox,
  LuChevronRight,
  LuCirclePlus,
  LuClock,
  LuEllipsisVertical,
  LuFileText,
  LuPackageMinus,
  LuPencil,
  LuReceipt,
  LuSearch,
  LuTrash
} from "react-icons/lu";
import { Link, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { LevelLine } from "~/components/TreeView";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePermissions,
  useQuantityFormatter,
  useRouteData
} from "~/hooks";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { MethodItemType } from "~/modules/shared/types";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import type {
  ServiceJobDetail,
  ServiceJobEstimateLine,
  ServiceJobItem,
  ServiceJobTime
} from "../../types";
import { ServiceJobAddPartModal } from "./ServiceJobAddPartModal";

export type ServiceJobExplorerChild =
  | (ServiceJobEstimateLine & { type: "estimate" })
  | (ServiceJobTime & { type: "time" })
  | (ServiceJobItem & { type: "item" });

type ServiceJobExplorerNode = {
  key: "estimate" | "time" | "items";
  pluralName: string;
  emptyText: string;
  /** False while the section takes no new rows and no edits. */
  isEditable: boolean;
  children: ServiceJobExplorerChild[];
};

/**
 * The job's work, left of the page: its estimate lines, the time logged on
 * it, and the parts and charges on it. Each section adds a row, and each row
 * opens its drawer or is removed from its menu.
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
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const routeData = useRouteData<{ job: ServiceJobDetail }>(
    path.to.serviceJob(jobId)
  );
  const job = routeData?.job;
  const permissions = usePermissions();
  const canUpdate =
    permissions.can("update", "service") && !isServiceJobLocked(job?.status);
  // Only a Billable job has an estimate, and a Sent or Accepted one is fixed.
  const canEditEstimate =
    canUpdate &&
    job?.coverage === "Billable" &&
    job?.estimateStatus !== "Sent" &&
    job?.estimateStatus !== "Accepted";

  const [filterText, setFilterText] = useState("");
  const deleteDisclosure = useDisclosure();
  const [selectedChild, setSelectedChild] =
    useState<ServiceJobExplorerChild | null>(null);
  const getLabel = useChildLabel();

  const onDelete = (child: ServiceJobExplorerChild) => {
    flushSync(() => {
      setSelectedChild(child);
    });
    deleteDisclosure.onOpen();
  };

  const onDeleteClose = () => {
    setSelectedChild(null);
    deleteDisclosure.onClose();
  };

  const tree: ServiceJobExplorerNode[] = [
    {
      key: "estimate",
      pluralName: t`Estimate`,
      emptyText: t`No estimate lines`,
      isEditable: canEditEstimate,
      children: estimateLines.map((line) => ({
        ...line,
        type: "estimate" as const
      }))
    },
    {
      key: "time",
      pluralName: t`Time`,
      emptyText: t`No time logged`,
      isEditable: canUpdate,
      children: time.map((entry) => ({ ...entry, type: "time" as const }))
    },
    {
      key: "items",
      pluralName: t`Parts`,
      emptyText: t`No parts or charges`,
      isEditable: canUpdate,
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
              jobId={jobId}
              filterText={filterText}
              onDelete={onDelete}
            />
          ))}
        </VStack>
      </VStack>
      {deleteDisclosure.isOpen && selectedChild && (
        <ConfirmDelete
          action={getDeleteAction(jobId, selectedChild)}
          fields={
            selectedChild.type === "item"
              ? { lineType: selectedChild.lineType }
              : undefined
          }
          name={getLabel(selectedChild)}
          deleteText={
            selectedChild.type === "item" && selectedChild.lineType === "Part"
              ? t`Return to Stock`
              : t`Delete`
          }
          text={
            selectedChild.type === "item" && selectedChild.lineType === "Part"
              ? t`The part goes back to inventory and its cost is reversed.`
              : t`Are you sure you want to remove this line?`
          }
          isOpen={deleteDisclosure.isOpen}
          onCancel={onDeleteClose}
          onSubmit={onDeleteClose}
        />
      )}
    </ScrollArea>
  );
}

function getDeleteAction(jobId: string, child: ServiceJobExplorerChild) {
  switch (child.type) {
    case "estimate":
      return path.to.deleteServiceJobEstimateLine(jobId, child.id);
    case "time":
      return path.to.deleteServiceJobTime(jobId, child.id);
    case "item":
      return path.to.deleteServiceJobItem(jobId, child.id);
  }
}

function ServiceJobExplorerItem({
  node,
  jobId,
  filterText,
  onDelete
}: {
  node: ServiceJobExplorerNode;
  jobId: string;
  filterText: string;
  onDelete: (child: ServiceJobExplorerChild) => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(
    node.children.length > 0 && node.children.length < 10
  );
  const issuePartModal = useDisclosure();
  const getLabel = useChildLabel();

  const filteredChildren = node.children.filter((child) =>
    getLabel(child).toLowerCase().includes(filterText.toLowerCase())
  );

  const addButton = (
    <IconButton
      aria-label={t`Add`}
      size="sm"
      variant="ghost"
      icon={<LuCirclePlus />}
      className="ml-auto"
      onClick={
        node.key === "items"
          ? undefined
          : () =>
              navigate(
                node.key === "estimate"
                  ? path.to.newServiceJobEstimateLine(jobId)
                  : path.to.newServiceJobTime(jobId)
              )
      }
    />
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
        {node.isEditable &&
          (node.key === "items" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>{addButton}</DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={issuePartModal.onOpen}>
                  <DropdownMenuIcon icon={<LuBox />} />
                  <Trans>Issue Part</Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => navigate(path.to.newServiceJobItem(jobId))}
                >
                  <DropdownMenuIcon icon={<LuReceipt />} />
                  <Trans>Add Charge</Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            addButton
          ))}
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
                jobId={jobId}
                label={getLabel(child)}
                isEditable={node.isEditable}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      )}

      {issuePartModal.isOpen && (
        <ServiceJobAddPartModal
          jobId={jobId}
          onClose={issuePartModal.onClose}
        />
      )}
    </>
  );
}

function ServiceJobExplorerChildItem({
  child,
  jobId,
  label,
  isEditable,
  onDelete
}: {
  child: ServiceJobExplorerChild;
  jobId: string;
  label: string;
  isEditable: boolean;
  onDelete: (child: ServiceJobExplorerChild) => void;
}) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [items] = useItems();
  const permissions = usePermissions();
  const formatQuantity = useQuantityFormatter();
  const formatMoney = useCurrencyFormatter();
  const editLink = getEditLink(jobId, child);
  const link = editLink ?? getItemLink(child, items);
  const canDelete = isEditable && permissions.can("delete", "service");

  const amount = getChildAmount(child);

  const content = (
    <div className="flex pr-7 h-8 cursor-pointer items-center overflow-hidden rounded-sm px-1 gap-2 text-sm hover:bg-accent w-full font-medium whitespace-nowrap">
      <LevelLine isSelected={false} />
      <div className="flex flex-grow items-center gap-2 min-w-0">
        <span className="shrink-0">{getChildIcon(child)}</span>
        <span className="truncate">{label}</span>
      </div>
      {child.type === "item" && child.lineType === "Part" && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatQuantity(child.quantity ?? 0)}
        </span>
      )}
      {amount !== null && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatMoney.format(amount)}
        </span>
      )}
    </div>
  );

  return (
    <div className="group/child relative flex w-full">
      {link ? (
        <Link to={link} className="flex w-full min-w-0">
          {content}
        </Link>
      ) : (
        <div className="flex w-full min-w-0">{content}</div>
      )}
      {isEditable && (editLink || canDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              aria-label={t`Options`}
              icon={<LuEllipsisVertical />}
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1 flex-shrink-0 md:opacity-0 group-hover/child:opacity-100 data-[state=open]:opacity-100 text-foreground/70 hover:text-foreground"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {editLink && (
              <DropdownMenuItem
                shortcut={MENU_ITEM_SHORTCUTS.edit}
                onSelect={() => navigate(editLink)}
              >
                <DropdownMenuIcon icon={<LuPencil />} />
                <Trans>Edit</Trans>
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem
                shortcut={MENU_ITEM_SHORTCUTS.delete}
                destructive
                onSelect={() => onDelete(child)}
              >
                {child.type === "item" && child.lineType === "Part" ? (
                  <>
                    <DropdownMenuIcon icon={<LuPackageMinus />} />
                    <Trans>Return to Stock</Trans>
                  </>
                ) : (
                  <>
                    <DropdownMenuIcon icon={<LuTrash />} />
                    <Trans>Delete</Trans>
                  </>
                )}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/** The drawer a row opens in: every row but a part, which has nothing to edit. */
function getEditLink(jobId: string, child: ServiceJobExplorerChild) {
  switch (child.type) {
    case "estimate":
      return path.to.serviceJobEstimateLine(jobId, child.id);
    case "time":
      return path.to.serviceJobTime(jobId, child.id);
    case "item":
      return child.lineType === "Charge"
        ? path.to.serviceJobItem(jobId, child.id)
        : null;
  }
}

/**
 * The money beside a row: an estimate line or a charge at its price, a part
 * at its cost. A time entry shows its hours in its label instead.
 */
function getChildAmount(child: ServiceJobExplorerChild): number | null {
  switch (child.type) {
    case "estimate":
      return child.quantity * child.unitPrice;
    case "time":
      return null;
    case "item":
      return child.lineType === "Part"
        ? child.quantity * child.unitCost
        : child.quantity * child.unitPrice;
  }
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
        return child.description || child.item?.name || child.itemId;
      case "item":
        return child.description || child.item?.name || child.itemId;
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

function getItemLink(
  child: ServiceJobExplorerChild,
  items: ReturnType<typeof useItems>[0]
): string | null {
  if (child.type === "time") return null;
  const item = items.find((i) => i.id === child.itemId);
  if (!item) return null;
  return getLinkToItemDetails(item.type as MethodItemType, child.itemId);
}

export default ServiceJobExplorer;
