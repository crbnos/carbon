// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "./utils/cn";

/**
 * A placeholder shape. Hidden from assistive tech: a page of skeletons would
 * otherwise be a page of empty, unnamed boxes. Mark the region that is
 * loading `aria-busy="true"` instead, so it is announced once.
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
