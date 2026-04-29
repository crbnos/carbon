import { useCallback, useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { LineagePayload } from "../utils";

type ExpandDirection = "up" | "down" | "both";

export function useExpandNode(
  onResult: (payload: LineagePayload, originId: string) => void
) {
  const fetcher = useFetcher<LineagePayload>();
  const pendingOriginRef = useRef<string | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && pendingOriginRef.current) {
      onResult(fetcher.data, pendingOriginRef.current);
      pendingOriginRef.current = null;
    }
  }, [fetcher.state, fetcher.data, onResult]);

  const expand = useCallback(
    (entityId: string, direction: ExpandDirection = "both", depth = 1) => {
      pendingOriginRef.current = entityId;
      const params = new URLSearchParams({
        trackedEntityId: entityId,
        direction,
        depth: String(depth)
      });
      fetcher.load(`/api/traceability/expand?${params.toString()}`);
    },
    [fetcher]
  );

  return { expand, isLoading: fetcher.state !== "idle" };
}
