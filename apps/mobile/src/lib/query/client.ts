// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { QueryClient } from "@tanstack/react-query";

/**
 * One client per app, cleared whenever the instance or company changes — see
 * InstanceProvider. Screens refetch on focus and after every command, and the
 * operation screen also polls, so a long stale time would only hide writes the
 * operator just made.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false
      },
      mutations: { retry: 0 }
    }
  });
}
