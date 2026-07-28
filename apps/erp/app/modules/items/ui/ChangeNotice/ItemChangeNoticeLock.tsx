import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useRouteData } from "~/hooks";
import type { ItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { changeNoticeOpenStatuses } from "../../items.models";
import type { ChangeNoticeForItem } from "../../items.service";

const openStatusSet = new Set<string>(changeNoticeOpenStatuses);

// Reads `openChangeNotices` from the part/tool parent route data; other item types return [].
export function useItemOpenChangeNotices(
  type: ItemType | string | undefined,
  itemId: string | undefined
): ChangeNoticeForItem[] {
  const routePath =
    itemId && type === "Part"
      ? path.to.part(itemId)
      : itemId && type === "Tool"
        ? path.to.tool(itemId)
        : "";
  const data = useRouteData<{ openChangeNotices?: ChangeNoticeForItem[] }>(
    routePath
  );
  return (data?.openChangeNotices ?? []).filter((co) =>
    openStatusSet.has(co.status)
  );
}

// Tooltip wrapper for disabled controls (the div anchors hover since disabled elements don't fire it).
export function ItemChangeNoticeLock({
  changeNotices,
  className,
  children
}: {
  changeNotices: ChangeNoticeForItem[];
  className?: string;
  children: ReactNode;
}) {
  const { t } = useLingui();

  if (changeNotices.length === 0) return <>{children}</>;

  const ids = changeNotices.map((co) => co.changeOrderId).join(", ");

  return (
    <Tooltip>
      {/* The child is disabled and can't take focus, so the wrapper carries it —
          otherwise the tooltip is the only explanation and it's mouse-only. */}
      <TooltipTrigger asChild>
        <div className={className} tabIndex={0}>
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {changeNotices.length === 1
          ? t`Open in change notice ${ids}. Release it to create new versions or revisions.`
          : t`Open in change notices ${ids}. Release them to create new versions or revisions.`}
      </TooltipContent>
    </Tooltip>
  );
}
