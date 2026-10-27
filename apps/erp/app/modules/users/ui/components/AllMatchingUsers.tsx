// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { Trans } from "@lingui/react/macro";
import { useBulkStartToast } from "~/hooks/useBulkAction";
import type { BulkActionStart } from "~/utils/table-jobs";

/**
 * The fetcher an Employees bulk action posts "every matching user" through.
 * The route starts the background job and answers `{ background: true }`, or
 * `{ success: false, message }`. The table holds it, not the modal: the modal
 * closes on submit, and an unmounted fetcher never reports its result.
 */
export function useBulkUserActionFetcher() {
  const showBulkStart = useBulkStartToast();
  return useAction<BulkActionStart>({
    onSuccess: showBulkStart,
    onError: showBulkStart
  });
}

export type BulkUserActionFetcher = ReturnType<typeof useBulkUserActionFetcher>;

/** Stands in for the selected users in a bulk action's modal when the action
 *  applies to every matching user. */
export function AllMatchingUsersNote() {
  return (
    <p className="text-sm text-muted-foreground">
      <Trans>
        Every user that matches the list's filters. Users this action does not
        apply to are skipped.
      </Trans>
    </p>
  );
}
