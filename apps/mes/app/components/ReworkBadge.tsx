// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";

/**
 * Marks a rework operation. An operation started from a correction names the
 * correction; a plain rework reads "Rework".
 */
export function ReworkBadge({
  correctionName,
  className
}: {
  correctionName?: string | null;
  className?: string;
}) {
  return (
    <Badge
      variant="red"
      className={cn("shrink-0 max-w-[16rem]", className)}
      title={correctionName ?? undefined}
    >
      <span className="truncate">
        {correctionName ? (
          <Trans>Correction: {correctionName}</Trans>
        ) : (
          <Trans>Rework</Trans>
        )}
      </span>
    </Badge>
  );
}
