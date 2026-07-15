import { Badge, Button, cn, useDisclosure, VStack } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { LuCirclePlus } from "react-icons/lu";
import { Link, useParams } from "react-router";
import { path } from "~/utils/path";
import AffectedItemForm from "./AffectedItemForm";
import type { AffectedItemDraft } from "./affectedItem.types";

// Left pane of the change-order workspace, mirroring the PO explorer: a scrolling
// list of the CO's affected items over a bottom "Add Affected Item" button that
// opens a modal. Selection lives in the URL (the affectedId route param) — each
// row is a Link, so the middle pane, refresh, and back/forward all follow the URL.
export default function AffectedItemsSidebar({
  changeOrderId,
  affectedItems,
  isDisabled
}: {
  changeOrderId: string;
  affectedItems: AffectedItemDraft[];
  isDisabled: boolean;
}) {
  const { affectedId } = useParams();
  const disclosure = useDisclosure();

  return (
    <>
      <aside className="w-64 flex-shrink-0 bg-card h-full border-r border-border text-sm flex flex-col justify-between">
        <VStack
          spacing={0}
          className="flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
        >
          <div className="text-xs font-medium uppercase text-muted-foreground px-3 py-3">
            <Trans>Affected Items</Trans>
          </div>

          <VStack spacing={1} className="px-2">
            {affectedItems.length === 0 && (
              <span className="text-sm text-muted-foreground italic px-1 py-1">
                <Trans>No affected items yet — add a part or tool below.</Trans>
              </span>
            )}
            {affectedItems.map((affected) => {
              const item = affected.affectedItem;
              const label = item.item;
              const isSelected = item.id === affectedId;
              return (
                <Link
                  key={item.id}
                  to={path.to.changeOrderAffectedItem(changeOrderId, item.id)}
                  className={cn(
                    "group w-full flex items-start justify-between gap-2 px-2 py-1.5 text-left rounded-md transition-colors",
                    isSelected ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <div className="min-w-0 flex flex-col">
                    <span className="text-sm font-medium truncate">
                      {label?.readableIdWithRevision ??
                        label?.readableId ??
                        item.itemId}
                    </span>
                    {label?.name && (
                      <span className="text-xs text-muted-foreground truncate">
                        {label.name}
                      </span>
                    )}
                  </div>
                  <Badge variant="secondary" className="flex-shrink-0">
                    {item.changeType}
                  </Badge>
                </Link>
              );
            })}
          </VStack>
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
      </aside>

      {disclosure.isOpen && (
        <AffectedItemForm
          changeOrderId={changeOrderId}
          blacklist={affectedItems.map((a) => a.affectedItem.itemId)}
          onClose={disclosure.onClose}
        />
      )}
    </>
  );
}
