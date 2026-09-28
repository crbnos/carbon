import { useRealtimeChannel } from "@carbon/react";
import { useCallback, useRef } from "react";
import { useFetchers, useRevalidator } from "react-router";
import { useUser } from "./useUser";

// Revalidate for a realtime change — except while a fetcher on this page is
// submitting. A submission's own writes echo back over realtime mid-action,
// and React Router drops a fetcher's redirect when a newer navigation started
// after the submit (the page then sits on stale data, or a loader gate
// flashes an error for work that just succeeded). Nothing is lost by skipping:
// the router revalidates after every action, the same reason `revalidate()`
// already no-ops during a navigation submission.
export function useRealtimeRevalidator() {
  const revalidator = useRevalidator();
  const fetchers = useFetchers();
  const submitting = useRef(false);
  submitting.current = fetchers.some((f) => f.state === "submitting");

  return useCallback(() => {
    if (!submitting.current) revalidator.revalidate();
  }, [revalidator]);
}

export function useRealtime(table: string, filter?: string) {
  const { company } = useUser();
  const revalidate = useRealtimeRevalidator();

  const channel = useRealtimeChannel({
    topic: `postgres_changes:${table}`,
    dependencies: [company.id, filter],
    setup(channel) {
      return channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: table,
          filter: filter ?? `companyId=eq.${company.id}`
        },
        () => {
          revalidate();
        }
      );
    }
  });

  return channel;
}
