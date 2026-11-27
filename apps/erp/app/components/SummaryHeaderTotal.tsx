// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans } from "@lingui/react/macro";
import type { ReactNode } from "react";

/** A summary card's header total, so long documents show their worth without scrolling. */
export function SummaryHeaderTotal({
  value,
  secondaryValue
}: {
  value: ReactNode;
  /** The amount in the document's own currency when it differs from base. */
  secondaryValue?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-end max-md:items-start">
      <span className="flex items-baseline gap-1.5 text-sm font-semibold tabular-nums">
        <span className="text-xs font-normal text-muted-foreground">
          <Trans>Total</Trans>
        </span>
        {value}
      </span>
      {secondaryValue ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {secondaryValue}
        </span>
      ) : null}
    </div>
  );
}
