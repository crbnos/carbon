import { useCarbon } from "@carbon/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "./useUser";

const POLL_INTERVAL_MS = 3_000;

/**
 * How long a start with no finish is believed.
 *
 * `onshape-bom-import` is declared `retries: 10` and a crashed run never
 * reaches its finish stamp, so a `startedAt` can outlive the job that wrote it.
 * Past the cap the item stops claiming to be importing rather than saying so
 * forever — the state is unknown, not running.
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

/** How long the "finished" state is worth showing after the fact. */
const FRESH_FINISH_MS = 60 * 1000;

type BomImportMarker = {
  startedAt?: string;
  finishedAt?: string;
  attentionCount?: number;
};

export type OnshapeImportStatus = {
  /** A BOM import is believed to be running right now. */
  running: boolean;
  /** It finished within the last minute — worth saying once. */
  justFinished: boolean;
  attentionCount: number;
};

function readStatus(marker: BomImportMarker | null): OnshapeImportStatus {
  const idle = { running: false, justFinished: false, attentionCount: 0 };
  if (!marker?.startedAt) return idle;

  const startedAt = Date.parse(marker.startedAt);
  if (!Number.isFinite(startedAt)) return idle;

  if (!marker.finishedAt) {
    return Date.now() - startedAt > STALE_AFTER_MS
      ? idle
      : { running: true, justFinished: false, attentionCount: 0 };
  }

  const finishedAt = Date.parse(marker.finishedAt);
  return {
    running: false,
    justFinished:
      Number.isFinite(finishedAt) && Date.now() - finishedAt < FRESH_FINISH_MS,
    attentionCount: marker.attentionCount ?? 0
  };
}

/**
 * Whether an Onshape BOM import is running against an item.
 *
 * POLL ONLY, deliberately. `externalIntegrationMapping` is not in the
 * `supabase_realtime` publication and neither is `methodMaterial` — which is
 * why the import route's toast says "reload the page in a moment". Adding the
 * publication is a migration plus a new realtime surface for a row that carries
 * integration metadata, so this mirrors the polling half of
 * `useDocumentExtraction` and stops on a terminal state.
 *
 * The marker itself is written by whoever dispatched the job and closed by the
 * job; this hook only reads it.
 */
export function useOnshapeImportStatus(
  itemId: string | null,
  enabled = true
): OnshapeImportStatus {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [marker, setMarker] = useState<BomImportMarker | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchMarker = useCallback(async () => {
    if (!itemId || !carbon || !enabled) return;

    // The SELECT policy on this table allows any employee in the company, so
    // the user's own client is enough — only the WRITES need the service role.
    const { data } = await carbon
      .from("externalIntegrationMapping")
      .select("metadata")
      .eq("integration", "onshapeElement")
      .eq("entityType", "item")
      .eq("entityId", itemId)
      .eq("companyId", company.id)
      .maybeSingle();

    const next =
      (data?.metadata as { bomImport?: BomImportMarker } | null)?.bomImport ??
      null;
    setMarker(next);

    clearPoll();
    if (readStatus(next).running) {
      pollTimerRef.current = setTimeout(() => {
        pollTimerRef.current = null;
        void fetchMarker();
      }, POLL_INTERVAL_MS);
    }
  }, [itemId, carbon, enabled, company.id, clearPoll]);

  useEffect(() => {
    void fetchMarker();
    return () => clearPoll();
  }, [fetchMarker, clearPoll]);

  return readStatus(marker);
}

export { readStatus as readOnshapeImportStatus, STALE_AFTER_MS };
