import { useFetchers } from "@remix-run/react";
import { path } from "~/utils/path";

export function useOptimisticAssignment({
  id,
  table,
}: {
  id: string;
  table: string;
}) {
  const fetchers = useFetchers();
  const assignFetcher = fetchers.find(
    (f) => f.formAction === path.to.api.assign
  );

  if (assignFetcher && assignFetcher.formData) {
    if (
      assignFetcher.formData.get("id") === id &&
      assignFetcher.formData.get("table") === table
    ) {
      return assignFetcher.formData.get("assignee") as string;
    }
  }
}
