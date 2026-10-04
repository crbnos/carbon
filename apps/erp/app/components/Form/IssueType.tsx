// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLoaderQuery } from "@carbon/query";
import { useMemo } from "react";
import type { getIssueTypesList } from "~/modules/quality";
import { path } from "~/utils/path";

/** The company's issue types, read through the shared client cache. The quality screens
 * still hand-roll their own issue-type dropdown; a selector built on this belongs here. */
export const useIssueTypes = () => {
  const issueTypeFetcher = useLoaderQuery<
    Awaited<ReturnType<typeof getIssueTypesList>>
  >(path.to.api.issueTypes);

  return useMemo(
    () =>
      (issueTypeFetcher.data?.data ?? []).map((t) => ({
        value: t.id,
        label: t.name
      })),
    [issueTypeFetcher.data?.data]
  );
};
