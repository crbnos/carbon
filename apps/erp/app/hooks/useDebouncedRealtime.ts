import { useRealtimeChannel } from "@carbon/react";
import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";
import { useUser } from "./useUser";

/**
 * Like `useRealtime`, but coalesces a burst of change events into a single
 * route revalidation after `debounceMs` of quiet.
 *
 * Use for append-heavy tables (e.g. `itemLedger`) where one business action
 * inserts many rows at once: without debouncing, a 300-row posting would fire
 * 300 `revalidate()` calls. Subscribe with a `companyId=eq.<id>` filter so new
 * inserts (not just changes to already-loaded rows) trigger a refetch.
 */
export function useDebouncedRealtime(
  table: string,
  filter: string | undefined,
  debounceMs = 1500
) {
  const { company } = useUser();
  const revalidator = useRevalidator();
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    []
  );

  return useRealtimeChannel({
    topic: `postgres_changes:${table}`,
    dependencies: [company.id, filter, debounceMs],
    setup(channel) {
      return channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter },
        () => {
          // Inserts are already scoped to this company by the `filter` arg, so
          // every event here is relevant — just coalesce the burst.
          if (timeout.current) clearTimeout(timeout.current);
          timeout.current = setTimeout(() => {
            revalidator.revalidate();
          }, debounceMs);
        }
      );
    }
  });
}
