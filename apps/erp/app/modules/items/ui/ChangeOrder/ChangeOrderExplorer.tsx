import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus, LuEllipsisVertical, LuTrash } from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { Empty, ItemThumbnail, MethodItemTypeIcon } from "~/components";
import { useRouteData } from "~/hooks";
import { canEditChangeOrder } from "~/modules/items";
import { getLinkToItemDetails } from "~/modules/items/ui/Item/ItemForm";
import type { ItemType } from "~/modules/shared";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type { ChangeOrder } from "../../types";
import AffectedItemForm from "./AffectedItemForm";
import type { AffectedItemDraft } from "./affectedItem.types";

// Explorer (left panel) of the change-order workspace — deliberately the same
// layout as the Purchase Order explorer (PurchaseOrderExplorer /
// PurchaseOrderLineItem): a full-bleed list of rows (thumbnail + id +
// description, hover ⋮ menu) over a bottom "Add" button, with the shared `Empty`
// component for the no-items state (mirrors the Sales / Purchase Order explorers).
// Selection lives in the URL (the affectedId route param). Self-contained: reads
// the affected items and lock state from the $id route loader, so ResizablePanels
// can render it with no props (mirrors SalesOrderExplorer).
export default function ChangeOrderExplorer() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{
    changeOrder: ChangeOrder;
    affectedItems: AffectedItemDraft[];
  }>(path.to.changeOrder(id));

  const affectedItems = routeData?.affectedItems ?? [];
  const isDisabled = !canEditChangeOrder(routeData?.changeOrder?.status);

  const disclosure = useDisclosure();

  return (
    <>
      <div className="w-full h-full text-sm flex flex-col justify-between">
        <VStack
          spacing={0}
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
        >
          {affectedItems.length === 0 ? (
            <Empty>
              {!isDisabled && (
                <Button
                  leftIcon={<LuCirclePlus />}
                  variant="secondary"
                  onClick={disclosure.onOpen}
                >
                  <Trans>Add Affected Item</Trans>
                </Button>
              )}
            </Empty>
          ) : (
            affectedItems.map((affected) => (
              <AffectedItemRow
                key={affected.affectedItem.id}
                changeOrderId={id}
                affected={affected}
                isDisabled={isDisabled}
              />
            ))
          )}
        </VStack>

        {!isDisabled && (
          <div className="w-full flex border-t border-border p-4 gap-2">
            <Button
              className="w-full"
              leftIcon={<LuCirclePlus />}
              variant="secondary"
              onClick={disclosure.onOpen}
            >
              <Trans>Add Affected Item</Trans>
            </Button>
          </div>
        )}
      </div>

      {disclosure.isOpen && (
        <AffectedItemForm
          changeOrderId={id}
          blacklist={affectedItems.map((a) => a.affectedItem.itemId)}
          onClose={disclosure.onClose}
        />
      )}
    </>
  );
}

function AffectedItemRow({
  changeOrderId,
  affected,
  isDisabled
}: {
  changeOrderId: string;
  affected: AffectedItemDraft;
  isDisabled: boolean;
}) {
  const { t } = useLingui();
  const { affectedId } = useParams();
  const deleteFetcher = useFetcher();
  const [items] = useItems();

  const item = affected.affectedItem;
  const label = item.item;
  const type = (label?.type as ItemType) ?? "Part";
  const isSelected = item.id === affectedId;
  // Revision / Replacement Part mint a DISTINCT (hidden, inactive) successor item
  // at add time — surface its number next to the source ("GA-0029 → GA-0030") so
  // the created part/revision is visible top-level, not only inside the line
  // detail. A New Part is net-new (no predecessor: its newItemId IS itemId), so
  // there's nothing to point at — show a single id, not "X → X". The items store
  // includes inactive items, so the minted item resolves.
  const newItemLabel =
    item.newItemId && item.newItemId !== item.itemId
      ? (items.find((i) => i.id === item.newItemId)?.readableIdWithRevision ??
        null)
      : null;

  return (
    <VStack spacing={0} className="border-b">
      <Link
        to={path.to.changeOrderAffectedItem(changeOrderId, item.id)}
        prefetch="intent"
        className="w-full"
      >
        <HStack
          className={cn(
            "group w-full p-2 items-center hover:bg-accent/30 cursor-pointer relative",
            isSelected && "bg-accent/60 hover:bg-accent/50"
          )}
        >
          <HStack spacing={2} className="flex-grow min-w-0 pr-10">
            <ItemThumbnail type={type} />
            <VStack spacing={0} className="min-w-0">
              <span className="font-semibold line-clamp-1">
                {label?.readableIdWithRevision ??
                  label?.readableId ??
                  item.itemId}
                {newItemLabel && (
                  <>
                    <span className="text-muted-foreground font-normal">
                      {" → "}
                    </span>
                    {newItemLabel}
                  </>
                )}
              </span>
              {label?.name && (
                <span className="text-muted-foreground text-xs truncate line-clamp-1">
                  {label.name}
                </span>
              )}
            </VStack>
          </HStack>
          {!isDisabled && (
            <div className="absolute right-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    aria-label={t`More`}
                    className="opacity-0 group-hover:opacity-100 group-active:opacity-100 data-[state=open]:opacity-100"
                    icon={<LuEllipsisVertical />}
                    variant="solid"
                    onClick={(e) => e.stopPropagation()}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    destructive
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteFetcher.submit(
                        {},
                        {
                          method: "post",
                          action: path.to.deleteChangeOrderAffected(
                            changeOrderId,
                            item.id
                          )
                        }
                      );
                    }}
                  >
                    <DropdownMenuIcon icon={<LuTrash />} />
                    <Trans>Delete</Trans>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to={getLinkToItemDetails(type, item.itemId)}>
                      <DropdownMenuIcon
                        icon={<MethodItemTypeIcon type={type} />}
                      />
                      <Trans>View Item Master</Trans>
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </HStack>
      </Link>
    </VStack>
  );
}
