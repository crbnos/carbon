// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, cn, Skeleton } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { LuInbox, LuSearchX } from "react-icons/lu";
import { NewPlacementContext } from "~/components/New";

function IconTile({ children }: { children: ReactNode }) {
  return (
    <div className="flex size-[52px] items-center justify-center rounded-xl bg-muted text-muted-foreground [&>svg]:size-6">
      {children}
    </div>
  );
}

/** A list with no records yet: neutral tile, title, the create action. */
export function CompactEmpty({
  title,
  heading,
  description,
  icon = <LuInbox />,
  primaryAction,
  className
}: {
  /** The records' name, for "No {title} yet". */
  title?: string;
  /** A full heading instead of "No {title} yet". */
  heading?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  primaryAction?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 px-6 py-16 text-center",
        className
      )}
    >
      <IconTile>{icon}</IconTile>
      <h3 className="text-[17px] font-semibold text-foreground">
        {heading ??
          (title ? (
            <Trans>No {title} yet</Trans>
          ) : (
            <Trans>Nothing here yet</Trans>
          ))}
      </h3>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      {primaryAction ? (
        <NewPlacementContext.Provider value="inline">
          {/* Several actions (an HStack of buttons) stack full width, primary first. */}
          <div className="mt-1 w-full max-w-xs [&_a]:w-full [&_a]:h-11 [&_button]:w-full [&_button]:h-11 [&>div]:w-full [&>div]:flex-col [&>div]:gap-2 [&>div>*]:!mx-0 [&>div>*]:w-full">
            {primaryAction}
          </div>
        </NewPlacementContext.Provider>
      ) : null}
    </div>
  );
}

/** Filtered to zero: say so and offer to clear. */
export function CompactNoResults({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <IconTile>
        <LuSearchX />
      </IconTile>
      <h3 className="text-[17px] font-semibold text-foreground">
        <Trans>No results</Trans>
      </h3>
      <Button variant="secondary" size="lg" onClick={onClear}>
        <Trans>Clear filters</Trans>
      </Button>
    </div>
  );
}

/** Loading: skeleton rows in the 3-line row shape. */
export function CompactLoading() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex min-h-14 flex-col gap-2 border-b border-border px-4 py-3"
        >
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-3 w-3/5" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}
