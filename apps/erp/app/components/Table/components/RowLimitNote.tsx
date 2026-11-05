// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { cn } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ReactNode } from "react";
import { SINGLE_LOAD_LIMIT } from "~/utils/pagination";

/**
 * Below the rows of a single-load list that read `SINGLE_LOAD_LIMIT` rows
 * (`<Table isTruncated>`): more rows may match, and only search or a filter
 * reaches them.
 */
export function RowLimitNote({
  className,
  children
}: {
  className?: string;
  /** Replaces the default copy, for a list whose rows are not what it read. */
  children?: ReactNode;
}) {
  const limit = useNumberFormatter().format(SINGLE_LOAD_LIMIT);
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {children ?? (
        <Trans>
          Showing the first {limit} rows. Search or filter to see the rest.
        </Trans>
      )}
    </p>
  );
}
