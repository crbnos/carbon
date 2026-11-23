// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import type { PlanningAction } from "~/modules/production/types";
import type { action as releaseAction } from "~/routes/x+/job+/release";
import { path } from "~/utils/path";

/**
 * A job's Release, released from the planning page through the jobs table's
 * release route: the job page's checks (operations, blocked manufacturing,
 * outside-operation suppliers), the release itself, and the location's
 * schedule run. A job that fails a check is named with its reason. Once
 * released the job is no longer Planned, so its Release drops out when the
 * page reloads (`isStaleRelease`).
 *
 * `onRelease` releases the job of an MRP Release action; `onReleaseJob`
 * releases any Planned job by id (the order drawer's Open Jobs rows), without
 * waiting for MRP's release notice. `onReleased` runs after a response that
 * released at least one job.
 */
export function useJobPlanningRelease(options?: { onReleased?: () => void }): {
  onRelease: (action: PlanningAction) => void;
  onReleaseJob: (jobId: string) => void;
  isReleasing: boolean;
} {
  const { t } = useLingui();
  const onReleased = options?.onReleased;
  const releaseFetcher = useAction<typeof releaseAction>({
    onSuccess: ({ data }) => {
      if (!data) return;
      if (data.released.length) {
        toast.success(t`Job released`);
        onReleased?.();
      }
      for (const warning of data.warnings) {
        toast.error(
          t`${warning.readableId} was released with a problem: ${warning.message}`
        );
      }
      for (const failure of data.failed) {
        toast.error(
          t`Could not release ${failure.readableId}: ${failure.message}`
        );
      }
      if (!data.scheduled) {
        toast.error(t`The schedule could not be updated after the release`);
      }
    }
  });

  const submit = releaseFetcher.submit;
  const onReleaseJob = useCallback(
    (jobId: string) => {
      submit(
        { jobIds: [jobId] },
        {
          method: "post",
          action: path.to.bulkReleaseJob,
          encType: "application/json"
        }
      );
    },
    [submit]
  );
  const onRelease = useCallback(
    (action: PlanningAction) => {
      if (action.jobId) onReleaseJob(action.jobId);
    },
    [onReleaseJob]
  );

  return { onRelease, onReleaseJob, isReleasing: releaseFetcher.isPending };
}
