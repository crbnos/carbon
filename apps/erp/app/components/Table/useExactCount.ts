// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useRef, useState } from "react";
import { useFetcher, useFormAction, useLocation } from "react-router";
import {
  EXACT_COUNT_LIMIT,
  getCountUrl,
  getResetKey
} from "./infiniteRowsStore";
import type { InfiniteOptions } from "./types";

/**
 * The list's row count, exact at any size: from 1,000 rows up it asks for
 * `?count=exact` after page 1 shows, keeping the estimate until it arrives.
 * A revalidation counts again without a new request from here: the router
 * reloads the fetcher's last URL itself. See
 * `.claude/rules/table-infinite-scroll.md` ("The row count").
 */
export function useExactCount({
  count,
  infinite
}: {
  count: number;
  infinite?: InfiniteOptions;
}): { count: number; isExact: boolean } {
  const fetcher = useFetcher<{ count?: number; exactCount?: boolean }>();
  const formAction = useFormAction();
  const location = useLocation();
  const pageUrl = infinite?.pageUrl ?? formAction;
  const resetKey = getResetKey(
    location.search,
    infinite?.pageUrl,
    infinite?.ignoreParams
  );
  const wanted = !!infinite?.listKey && count >= EXACT_COUNT_LIMIT;

  const [exact, setExact] = useState<{ resetKey: string; count: number }>();
  const requestedKey = useRef<string | null>(null);
  const load = useRef(fetcher.load);
  load.current = fetcher.load;

  useEffect(() => {
    if (!wanted) return;
    requestedKey.current = resetKey;
    load.current(getCountUrl(pageUrl));
  }, [wanted, resetKey, pageUrl]);

  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || result?.exactCount !== true) return;
    if (typeof result.count !== "number" || requestedKey.current === null) {
      return;
    }
    setExact({ resetKey: requestedKey.current, count: result.count });
  }, [fetcher.state, fetcher.data]);

  if (wanted && exact?.resetKey === resetKey) {
    return { count: exact.count, isExact: true };
  }
  return { count, isExact: count < EXACT_COUNT_LIMIT };
}
