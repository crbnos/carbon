// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { OperationQueue } from "~/features/operations/OperationQueue";
import { useAssignedQuery } from "~/features/operations/useQueueQueries";

/**
 * Assigned to Me — web MES's `x+/assigned.tsx`, through
 * `GET /api/v1/operations/assigned` and so through the same read.
 *
 * A screen of this tab's stack, not a tab of its own: see `QueueSwitcher` for
 * why the three queues live behind a segmented control.
 */
export default function Assigned() {
  const { t } = useLingui();
  const query = useAssignedQuery();

  return (
    <OperationQueue
      view="assigned"
      title={t`Assigned to Me`}
      emptyTitle={t`No assigned operations`}
      query={query}
    />
  );
}
