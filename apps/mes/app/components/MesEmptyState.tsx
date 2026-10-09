// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import type { ReactNode } from "react";
import { LuInbox, LuTriangleAlert } from "react-icons/lu";

type MesEmptyStateProps = {
  title: ReactNode;
  action?: ReactNode;
  /** The page's container classes (height, padding). */
  className?: string;
};

/**
 * An empty list. From md up: today's dark round icon and mono caption.
 * Phones: a muted icon tile and a 17px title.
 */
export function MesEmptyState({
  title,
  action,
  className
}: MesEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 max-md:h-auto max-md:gap-2 max-md:px-6 max-md:py-12 max-md:text-center",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background max-md:rounded-xl max-md:bg-muted max-md:text-muted-foreground">
        <LuTriangleAlert className="h-6 w-6 max-md:hidden" />
        <LuInbox className="hidden h-6 w-6 max-md:block" />
      </div>
      <span className="text-xs font-mono font-light text-foreground uppercase max-md:mt-2 max-md:font-sans max-md:text-[17px] max-md:font-semibold max-md:normal-case">
        {title}
      </span>
      {action}
    </div>
  );
}
