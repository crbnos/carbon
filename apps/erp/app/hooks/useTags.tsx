// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

export function useTags({ id, table }: { id?: string; table: string }) {
  const fetcher = useFetcher<{}>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  const onUpdateTags = useCallback(
    (value: string[]) => {
      if (!id) return;
      const formData = new FormData();

      formData.append("ids", id);
      formData.append("table", table);
      value.forEach((v) => {
        formData.append("value", v);
      });

      fetcher.submit(formData, {
        method: "post",
        action: path.to.tags
      });
    },

    [id, table]
  );

  return { onUpdateTags };
}
