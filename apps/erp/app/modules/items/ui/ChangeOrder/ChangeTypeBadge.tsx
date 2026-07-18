import type { BadgeProps } from "@carbon/react";
import { Badge } from "@carbon/react";
import type { ChangeOrderChangeType } from "../../items.models";

// A single badge summarizing an affected item's change type + draft version,
// replacing the old two-badge "[Version] [V2]" pair:
//   Version  → "Version 2"   Revision → "Revision 2"   New Part → "New"
// Shown on the line-detail card header and each explorer row so both read
// identically. When there's no draft make method yet, the number is omitted.
export function changeTypeBadgeLabel(
  changeType: ChangeOrderChangeType,
  version?: number | null
): string {
  if (changeType === "New Part") return "New";
  return version != null ? `${changeType} ${version}` : changeType;
}

// Color-coded by change type: New Part = green, Revision = blue, Version = outline.
const changeTypeBadgeVariant: Record<
  ChangeOrderChangeType,
  BadgeProps["variant"]
> = {
  "New Part": "green",
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
