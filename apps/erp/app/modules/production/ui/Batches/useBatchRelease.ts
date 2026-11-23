// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import { toast } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useCallback } from "react";
import type { action as batchingAction } from "~/routes/x+/priority+/batching.update";
import { path } from "~/utils/path";

/**
 * Release (Planned → Active) or unrelease one batch, from the batch drawer or
 * a batches table row. A refusal is toasted; success revalidates the page.
 */
export function useBatchRelease() {
  const { t } = useLingui();
  const fetcher = useAction<typeof batchingAction>({
    onSuccess: ({ data }) => {
      if (!data || !("failed" in data) || !("skipped" in data)) return;
      const [failure] = data.failed;
      const [skipped] = data.skipped;
      if (failure) toast.error(failure.message);
      else if (skipped) {
        toast.error(t`The batch is ${skipped.status}, not Planned`);
      }
    }
  });

  const { submit: post } = fetcher;
  const submit = useCallback(
    (
      intent: "release" | "unrelease",
      batchId: string,
      purchaseOrdersBySupplierId?: Record<string, string>
    ) =>
      post(
        {
          intent,
          batchId,
          ...(purchaseOrdersBySupplierId && {
            purchaseOrdersBySupplierId: JSON.stringify(
              purchaseOrdersBySupplierId
            )
          })
        },
        { method: "post", action: path.to.priorityBatchingUpdate }
      ),
    [post]
  );

  return { submit, isPending: fetcher.isPending };
}
