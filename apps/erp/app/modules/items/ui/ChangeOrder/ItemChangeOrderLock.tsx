import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useRouteData } from "~/hooks";
import type { ItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { changeOrderOpenStatuses } from "../../items.models";
import type { ChangeOrderForItem } from "../../items.service";

const openStatusSet = new Set<string>(changeOrderOpenStatuses);

// Reads `openChangeOrders` from the part/tool parent route data; other item types return [].
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

// Tooltip wrapper for disabled controls (the div anchors hover since disabled elements don't fire it).
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
