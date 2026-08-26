import { Tooltip, TooltipContent, TooltipTrigger } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useRouteData } from "~/hooks";
import type { ItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import { isChangeNoticeOpen } from "../../items.models";
import type { ChangeNoticeForItem } from "../../items.service";

// Reads `openChangeNotices` from the part/tool parent route data; other item types
// are never locked. `isLocked` is also true when the lookup failed, since we then
// can't prove the item is free.
export function useItemOpenChangeNotices(
  type: ItemType | string | undefined,
  itemId: string | undefined
): { changeNotices: ChangeNoticeForItem[]; isLocked: boolean } {
  const routePath =
    itemId && type === "Part"
      ? path.to.part(itemId)
      : itemId && type === "Tool"
        ? path.to.tool(itemId)
        : "";
  const data = useRouteData<{
    openChangeNotices?: ChangeNoticeForItem[];
    changeNoticesUnavailable?: boolean;
  }>(routePath);
  const changeNotices = (data?.openChangeNotices ?? []).filter((co) =>
    isChangeNoticeOpen(co.status)
  );
  return {
    changeNotices,
    isLocked:
      changeNotices.length > 0 || data?.changeNoticesUnavailable === true
  };
}

// Tooltip wrapper for disabled controls (the div anchors hover since disabled elements don't fire it).
// `reason` overrides the default "release it to create new versions" wording for
// callers locking something else — the Active toggle, say.
export function ItemChangeNoticeLock({
  changeNotices,
  isLocked,
  className,
  reason,
  children
}: {
  changeNotices: ChangeNoticeForItem[];
  isLocked: boolean;
  className?: string;
  reason?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLingui();

  if (!isLocked) return <>{children}</>;

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
        {reason ??
          (changeNotices.length === 0
            ? t`Change notices could not be loaded, so new versions and revisions are blocked. Reload to try again.`
            : changeNotices.length === 1
              ? t`Open in change notice ${ids}. Release it to create new versions or revisions.`
              : t`Open in change notices ${ids}. Release them to create new versions or revisions.`)}
      </TooltipContent>
    </Tooltip>
  );
}
