// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import type { action as releaseAction } from "~/routes/x+/job+/$jobId.release";
import { path } from "~/utils/path";

export type ReleaseChoices = {
  purchaseOrdersBySupplierId: Record<string, string>;
  supplierProcessByOperationId: Record<string, string>;
};

/**
 * The Release dialog's submission: `releaseJobs` for one job, with
 * the dialog's choices. Owned by the page, not the dialog, so the result is
 * still toasted after the dialog closes and the page can show it pending.
 */
export function useJobRelease() {
  const { t } = useLingui();
  const release = useAction<typeof releaseAction>({
    onSuccess: ({ data }) => {
      if (!data) return;
      const [failure] = data.failed;
      const [skipped] = data.skipped;
      if (failure) {
        toast.error(
          t`Could not release ${failure.readableId}: ${failure.message}`
        );
      } else if (skipped) {
        toast.error(
          t`${skipped.readableId} is ${skipped.status}, not Draft or Planned`
        );
      } else {
        toast.success(t`Job released`);
      }
      for (const warning of data.warnings) {
        toast.error(
          t`${warning.readableId} was released with a problem: ${warning.message}`
        );
      }
      if (data.released.length > 0 && !data.scheduled) {
        toast.error(t`The schedule could not be updated after the release`);
      }
    }
  });

  const { submit: post, isPending } = release;
  const submit = useCallback(
    (jobId: string, choices: ReleaseChoices) =>
      post(choices, {
        method: "post",
        action: path.to.jobRelease(jobId),
        encType: "application/json"
      }),
    [post]
  );

  return { submit, isPending };
}

export type JobRelease = ReturnType<typeof useJobRelease>;
