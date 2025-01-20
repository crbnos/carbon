import { useFetcher } from "@remix-run/react";
import { useCallback } from "react";
import { path } from "~/utils/path";

export function useTags({ id, table }: { id?: string; table: string }) {
  const fetcher = useFetcher<{}>();
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
        action: path.to.tags,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, table]
  );

  return { onUpdateTags };
}
