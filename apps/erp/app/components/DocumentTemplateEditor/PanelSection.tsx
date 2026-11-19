// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  useLocalStorage
} from "@carbon/react";
import type { ReactNode } from "react";
import { LuChevronDown } from "react-icons/lu";

/**
 * A section of an editor rail that folds away, open or closed as this browser
 * last left it (per `id`).
 */
export function RememberedSection({
  id,
  defaultOpen = true,
  title,
  count,
  action,
  children,
  className
}: {
  id: string;
  defaultOpen?: boolean;
  title: ReactNode;
  /** A short note on the right of the title, such as a count. */
  count?: ReactNode;
  /** A control on the title row, outside the fold button (e.g. "Add block"). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useLocalStorage<boolean>(
    `document-editor:section:${id}`,
    defaultOpen
  );
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("border-b last:border-b-0", className)}
    >
      <div className="flex items-center gap-1 pr-2">
        <CollapsibleTrigger className="flex min-h-10 flex-1 items-center gap-1.5 px-3 py-2 text-left text-sm font-semibold">
          <LuChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-150",
              !open && "-rotate-90"
            )}
          />
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="ml-auto pl-2 text-xs font-normal tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}
