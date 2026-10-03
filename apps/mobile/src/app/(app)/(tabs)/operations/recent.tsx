// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { OperationQueue } from "~/features/operations/OperationQueue";
import { useRecentQuery } from "~/features/operations/useQueueQueries";

/**
 * Recent — what this operator last touched, from web MES's `x+/recent.tsx`
 * read. It exists so picking a job back up after a break is one tap rather
 * than a hunt through the board.
 */
export default function Recent() {
  const { t } = useLingui();
  const query = useRecentQuery();

  return (
    <OperationQueue
      view="recent"
      title={t`Recent`}
      emptyTitle={t`No recent operations`}
      query={query}
    />
  );
}
