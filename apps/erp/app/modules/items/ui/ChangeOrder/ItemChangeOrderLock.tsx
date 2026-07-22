import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useRouteData } from "~/hooks";
import type { ItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { changeOrderOpenStatuses } from "../../items.models";
import type { ChangeOrderForItem } from "../../items.service";

const openStatusSet = new Set<string>(changeOrderOpenStatuses);

// The item-master parent loaders (part/tool `$itemId.tsx`) expose
// `openChangeOrders` for the item. Any child surface (revision switcher,
// make-method tools) reads it from that shared route data so version/revision
// creation stays disabled while a change order owns the item — without each
// surface re-querying. Only Part/Tool can be affected by a CO today; other
// item types have no `openChangeOrders` in their loader, so this returns [].
export function useItemOpenChangeOrders(
  type: ItemType | string | undefined,
  itemId: string | undefined
): ChangeOrderForItem[] {
  const routePath =
    itemId && type === "Part"
      ? path.to.part(itemId)
      : itemId && type === "Tool"
        ? path.to.tool(itemId)
        : "";
  const data = useRouteData<{ openChangeOrders?: ChangeOrderForItem[] }>(
    routePath
  );
  return (data?.openChangeOrders ?? []).filter((co) =>
    openStatusSet.has(co.status)
  );
}

// Wraps a disabled control so hovering it explains why it is locked. Native
// disabled buttons and `data-[disabled]` menu items don't fire hover events, so
// the wrapper `<div>` (never disabled) is what the tooltip anchors to. When
// `changeOrders` is empty it renders children untouched.
export function ItemChangeOrderLock({
  changeOrders,
  className,
  children
}: {
  changeOrders: ChangeOrderForItem[];
  className?: string;
  children: ReactNode;
}) {
  const { t } = useLingui();

  if (changeOrders.length === 0) return <>{children}</>;

  const ids = changeOrders.map((co) => co.changeOrderId).join(", ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={className}>{children}</div>
      </TooltipTrigger>
      <TooltipContent>
        {changeOrders.length === 1
          ? t`Open in change order ${ids}. Release it to create new versions or revisions.`
          : t`Open in change orders ${ids}. Release them to create new versions or revisions.`}
      </TooltipContent>
    </Tooltip>
  );
}
