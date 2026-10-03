// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "~/lib/api/errors";

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
        // One retry, for a dropped connection or a server hiccup. A 4xx is the
        // server's considered answer and will be the same answer next time, so
        // retrying it only delays what the screen does about it — and one of
        // those answers is the 409 that says "this operation opens on another
        // screen", where the retry was a second of dead air before the hop.
        retry: (failureCount, error) =>
          failureCount < 1 &&
          !(
            error instanceof ApiClientError &&
            error.status >= 400 &&
            error.status < 500
          ),
        refetchOnWindowFocus: false
      },
      mutations: { retry: 0 }
    }
  });
}
