// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useFetchers, useParams } from "react-router";
import type { z } from "zod";
import { path } from "~/utils/path";
import { salesRfqDragValidator } from "../../sales.models";

export function useOptimisticDocumentDrag() {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  const { rfqId } = useParams();
  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.salesRfqDrag(rfqId!);
    })
    .reduce<z.infer<typeof salesRfqDragValidator>[]>((acc, fetcher) => {
      const payload = fetcher?.formData?.get("payload");
      if (payload) {
        try {
          const parsedPayload = salesRfqDragValidator.parse(
            JSON.parse(payload as string)
          );
          return [...acc, parsedPayload];
        } catch {
          // nothing
        }
      }
      return acc;
    }, []);
}
