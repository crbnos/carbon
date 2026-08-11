import { useMount } from "@carbon/react";
import { useMemo } from "react";
import { useFetcher } from "react-router";
import type { getIssueTypesList } from "~/modules/quality";
import { path } from "~/utils/path";

/** The company's issue types, read through the shared client cache. The quality screens
 * still hand-roll their own issue-type dropdown; a selector built on this belongs here. */
export const useIssueTypes = () => {
  const issueTypeFetcher =
    useFetcher<Awaited<ReturnType<typeof getIssueTypesList>>>();

  useMount(() => {
    issueTypeFetcher.load(path.to.api.issueTypes);
  });

  return useMemo(
    () =>
      (issueTypeFetcher.data?.data ?? []).map((t) => ({
        value: t.id,
        label: t.name
      })),
    [issueTypeFetcher.data?.data]
  );
};
