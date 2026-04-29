import { type MutableRefObject, useEffect } from "react";
import { TRACE_API } from "../constants";
import type { LineagePayload } from "../utils";

type Boundary = { incoming: Set<string>; outgoing: Set<string> };

type Args = {
  payload: LineagePayload;
  boundaryByNode: Boundary;
  markExpandable: (id: string) => void;
  markExhausted: (id: string) => void;
  probeCacheRef: MutableRefObject<Map<string, LineagePayload>>;
  probedRef: MutableRefObject<Set<string>>;
};

export function useProbeBoundary({
  payload,
  boundaryByNode,
  markExpandable,
  markExhausted,
  probeCacheRef,
  probedRef
}: Args) {
  useEffect(() => {
    let cancelled = false;
    const candidates = payload.entities.filter((e) => {
      if (probedRef.current.has(e.id)) return false;
      const hasIn = boundaryByNode.incoming.has(e.id);
      const hasOut = boundaryByNode.outgoing.has(e.id);
      return !hasIn || !hasOut;
    });
    if (candidates.length === 0) return;

    const knownEntityIds = new Set(payload.entities.map((e) => e.id));
    const knownActivityIds = new Set(payload.activities.map((a) => a.id));

    for (const ent of candidates) {
      probedRef.current.add(ent.id);
      const params = new URLSearchParams({
        trackedEntityId: ent.id,
        direction: "both",
        depth: "1"
      });
      fetch(`${TRACE_API.expand}?${params.toString()}`)
        .then((r) => r.json() as Promise<LineagePayload>)
        .then((res) => {
          if (cancelled) return;
          const hasNew =
            res.entities.some((e) => !knownEntityIds.has(e.id)) ||
            res.activities.some((a) => !knownActivityIds.has(a.id));
          if (hasNew) {
            probeCacheRef.current.set(ent.id, res);
            markExpandable(ent.id);
          } else {
            markExhausted(ent.id);
          }
        })
        .catch(() => {
          // probe fail = silently leave indicator off
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    payload,
    boundaryByNode,
    markExpandable,
    markExhausted,
    probeCacheRef,
    probedRef
  ]);
}
