// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, cn, Spinner } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

/**
 * The state of an infinite list below its rows: "Loading more rows" while a
 * page loads, "Couldn't load more rows" with Retry after a failed one.
 * "row" is the desktop line (a table row, a drawer); "list" is the phone list.
 */
export function InfiniteStatus({
  isLoading,
  loadError,
  onRetry,
  variant = "row",
  className
}: {
  isLoading: boolean;
  loadError: boolean;
  onRetry: () => void;
  variant?: "row" | "list";
  className?: string;
}) {
  if (!loadError && !isLoading) return null;

  if (variant === "list") {
    return loadError ? (
      <div className={cn("flex w-full flex-col items-center gap-2", className)}>
        <span className="text-sm text-muted-foreground">
          <Trans>Couldn't load more rows</Trans>
        </span>
        <Button
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={onRetry}
        >
          <Trans>Retry</Trans>
        </Button>
      </div>
    ) : (
      <Spinner className={cn("text-muted-foreground", className)} />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 text-sm text-muted-foreground",
        className
      )}
    >
      {loadError ? (
        <>
          <Trans>Couldn't load more rows</Trans>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <Trans>Retry</Trans>
          </Button>
        </>
      ) : (
        <>
          <Spinner />
          <Trans>Loading more rows</Trans>
        </>
      )}
    </div>
  );
}
