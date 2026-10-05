// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { OperationQueue } from "~/features/operations/OperationQueue";
import { useActiveQuery } from "~/features/operations/useQueueQueries";

/**
 * Active — the operations this operator has an open production event on, from
 * web MES's `x+/active.tsx` read.
 *
 * The count on the switcher's Active segment comes from this same query, so the
 * badge and the list cannot disagree.
 */
export default function Active() {
  const { t } = useLingui();
  const query = useActiveQuery();

  return (
    <OperationQueue
      view="active"
      title={t`Active`}
      emptyTitle={t`No active operations`}
      query={query}
    />
  );
}
