import type { BadgeProps } from "@carbon/react";
import { Badge } from "@carbon/react";
import type { ChangeOrderChangeType } from "../../items.models";

// A single badge summarizing an affected item's change type:
//   Version → "Version 2"   Revision → "New Revision"
//   Replacement Part → "Replacement"   New Part → "New"
// Shown on the line-detail card header and each explorer row so both read
// identically. Only a Version shows a number, and it's the meaningful new
// method version; a Revision/New Part mints a brand-new item whose method
// restarts at v1, so that number is noise — use the plain label instead.
export function changeTypeBadgeLabel(
  changeType: ChangeOrderChangeType,
  version?: number | null
): string {
  if (changeType === "New Part") return "New";
  if (changeType === "Replacement Part") return "Replacement";
  if (changeType === "Revision") return "New Revision";
  return version != null ? `${changeType} ${version}` : changeType;
}

// Color-coded by change type: New Part = green (net-new), Replacement = orange
// (supersedes), Revision = blue, Version = outline.
const changeTypeBadgeVariant: Record<
  ChangeOrderChangeType,
  BadgeProps["variant"]
> = {
  "New Part": "green",
  "Replacement Part": "orange",
  Revision: "blue",
  Version: "outline"
};

export default function ChangeTypeBadge({
  changeType,
  version,
  className
}: {
  changeType: ChangeOrderChangeType;
  version?: number | null;
  className?: string;
}) {
  return (
    <Badge variant={changeTypeBadgeVariant[changeType]} className={className}>
      {changeTypeBadgeLabel(changeType, version)}
    </Badge>
  );
}
