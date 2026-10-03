// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The spinner for a pull-to-refresh, and ONLY for a pull-to-refresh.
 *
 * Every screen in this app polls — the floor moves while the operator is
 * reading it — and a `RefreshControl` bound to the query's own `isFetching`
 * therefore spun up on its own every thirty seconds, which reads exactly like
 * the screen reloading itself for no reason. TanStack has no "did a human ask
 * for this" flag, so the pull owns its own.
 *
 * `finally` rather than `.then`: a refetch that rejects must still put the
 * spinner away, or the list is left pinned open under a spinner that never
 * stops on the one occasion the operator most wants to retry.
 */
export function usePullToRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refetch().finally(() => {
      // An operator who pulls and immediately leaves the screen unmounts this
      // mid-flight; setting state then is a no-op warning at best.
      if (mounted.current) setRefreshing(false);
    });
  }, [refetch]);

  return { refreshing, onRefresh };
}
