import { ValidatedForm } from "@carbon/form";
import { Badge, cn, HStack, VStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuPlus } from "react-icons/lu";
import { Link, useFetcher, useParams } from "react-router";
import { Hidden, Item, Submit } from "~/components/Form";
import { path } from "~/utils/path";
import { changeOrderAffectedItemValidator } from "../../changeOrder.models";
import type { AffectedItemDraft } from "./affectedItem.types";

// Left pane of the change-order workspace: a list of the CO's affected items plus
// the add-item form. Selection lives in the URL (the affectedId route param) —
// each row is a Link, so the middle pane, refresh, and back/forward all follow the
// URL. The aside shell mirrors the traceability sidebar, flipped to a left border.
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
  return (
    <aside className="w-64 flex-shrink-0 bg-card h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-r border-border text-sm flex flex-col">
      <div className="text-xs font-medium uppercase text-muted-foreground px-3 py-3">
        <Trans>Affected Items</Trans>
      </div>

      <VStack spacing={1} className="px-2 flex-grow">
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

      {!isDisabled && (
        <div className="px-3 py-3 border-t border-border">
          <AddAffectedItem
            id={changeOrderId}
            blacklist={affectedItems.map((a) => a.affectedItem.itemId)}
          />
        </div>
      )}
    </aside>
  );
}

function AddAffectedItem({
  id,
  blacklist
}: {
  id: string;
  blacklist: string[];
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  return (
    <ValidatedForm
      fetcher={fetcher}
      method="post"
      action={path.to.changeOrderAffected(id)}
      validator={changeOrderAffectedItemValidator}
      defaultValues={{ changeOrderId: id, itemId: "" }}
      className="w-full"
      resetAfterSubmit
    >
      <Hidden name="changeOrderId" value={id} />
      <VStack spacing={2} className="w-full">
        <Item
          name="itemId"
          label={t`Add affected item`}
          type="Part"
          validItemTypes={["Part", "Tool"]}
          blacklist={blacklist}
        />
        <HStack className="w-full justify-end">
          <Submit leftIcon={<LuPlus />}>
            <Trans>Add</Trans>
          </Submit>
        </HStack>
      </VStack>
    </ValidatedForm>
  );
}
