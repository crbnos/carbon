// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn, IconButton, PrefetchLink } from "@carbon/react";
import type { IconType } from "react-icons";
import { LuPin } from "react-icons/lu";

// A pinned item (report or saved view) rendered as a card in the Pinned grid.
export const PinnedCard = ({
  to,
  icon: Icon,
  name,
  pinned,
  onToggle,
  pinLabel,
  unpinLabel
}: {
  to: string;
  icon: IconType;
  name: string;
  pinned: boolean;
  onToggle: (pinned: boolean) => void;
  pinLabel: string;
  unpinLabel: string;
}) => (
  <PrefetchLink
    to={to}
    className="group flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border bg-card/70 p-4 backdrop-blur-md transition-colors duration-200 hover:border-foreground/20 hover:bg-accent/40"
  >
    <span className="flex items-center gap-3 overflow-hidden">
      <span className="shrink-0 rounded-lg border border-border p-2.5 transition-colors group-hover:border-foreground/20">
        <Icon className="text-xl" />
      </span>
      <span className="truncate text-sm font-medium tracking-tight">
        {name}
      </span>
    </span>
    <PinToggle
      pinned={pinned}
      onToggle={onToggle}
      pinLabel={pinLabel}
      unpinLabel={unpinLabel}
    />
  </PrefetchLink>
);

// Sits inside the card/row Link, so it must not trigger navigation. Pinned
// shows a solid pin; unpinned shows a muted pin that fills in on hover.
export const PinToggle = ({
  pinned,
  onToggle,
  pinLabel,
  unpinLabel
}: {
  pinned: boolean;
  onToggle: (pinned: boolean) => void;
  pinLabel: string;
  unpinLabel: string;
}) => (
  <IconButton
    aria-label={pinned ? unpinLabel : pinLabel}
    variant="ghost"
    size="sm"
    className={cn(
      pinned
        ? "text-foreground"
        : "text-muted-foreground/50 hover:text-foreground"
    )}
    icon={<LuPin />}
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onToggle(!pinned);
    }}
  />
);
