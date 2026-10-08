// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import type { PlanningAction } from "~/modules/production";
import type { action as releaseAction } from "~/routes/x+/job+/release";
import { path } from "~/utils/path";

/**
 * A job's Release action, released from the planning page through the jobs
 * table's release route: the job page's checks (operations, blocked
 * manufacturing, outside-operation suppliers), the release itself, and the
 * location's schedule run. A job that fails a check is named with its reason.
 * Once released the job is no longer Planned, so its Release drops out when
 * the page reloads (`isStaleRelease`).
 */
export function useJobPlanningRelease(): {
  onRelease: (action: PlanningAction) => void;
  isReleasing: boolean;
} {
  const { t } = useLingui();
  const releaseFetcher = useAction<typeof releaseAction>({
    onSuccess: (result) => {
      if (!result.success) return;
      if (result.released) toast.success(t`Job released`);
      for (const warning of result.warnings) {
        toast.error(
          t`${warning.readableId} was released with a problem: ${warning.message}`
        );
      }
      for (const failure of result.failed) {
        toast.error(
          t`Could not release ${failure.readableId}: ${failure.message}`
        );
      }
      if (!result.scheduled) {
        toast.error(t`The schedule could not be updated after the release`);
      }
    },
    onError: (result) => {
      if (!result.success) toast.error(result.message);
    }
  });

  const submit = releaseFetcher.submit;
  const onRelease = useCallback(
    (action: PlanningAction) => {
      if (!action.jobId) return;
      submit(
        { jobIds: [action.jobId] },
        {
          method: "post",
          action: path.to.bulkReleaseJob,
          encType: "application/json"
        }
      );
    },
    [submit]
  );

  return { onRelease, isReleasing: releaseFetcher.isPending };
}
