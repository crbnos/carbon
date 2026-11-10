// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { toLinkLabel, toSafeHref } from "@carbon/utils";
import { LuExternalLink } from "react-icons/lu";

type LinkValueProps = {
  value: string;
  className?: string;
};

/**
 * A stored web address. It opens in a new tab when `toSafeHref` accepts it, and
 * shows as plain text when it does not (another scheme, or not an address).
 * The link text is the short form from `toLinkLabel`; the tooltip has it in full.
 */
const LinkValue = ({ value, className }: LinkValueProps) => {
  const href = toSafeHref(value);
  if (!href) return <span className={className}>{value}</span>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={href}
      // A link inside a clickable row or panel opens the address, not the row.
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex max-w-full items-center gap-1 text-foreground hover:underline",
        className
      )}
    >
      <span className="truncate">{toLinkLabel(value)}</span>
      <LuExternalLink className="size-3 flex-shrink-0 text-muted-foreground" />
    </a>
  );
};

export default LinkValue;
