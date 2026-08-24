import { useCarbon } from "@carbon/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OnshapeImportProgressMarker,
  OnshapeImportStatus
} from "./onshapeImportStatus";
import { readOnshapeImportStatus } from "./onshapeImportStatus";
import { useUser } from "./useUser";

const POLL_INTERVAL_MS = 3_000;

/**
 * Whether Carbon is still building an item out from Onshape.
 *
 * POLL ONLY, deliberately. `externalIntegrationMapping` is not in the
 * `supabase_realtime` publication and neither is `methodMaterial`. Adding the
 * publication is a migration plus a new realtime surface for a row that carries
 * integration metadata, so this mirrors the polling half of
 * `useDocumentExtraction` and stops on a terminal state.
 *
 * The marker is opened by whoever dispatched the job and closed by the job;
 * this hook only reads it. `readOnshapeImportStatus` — the pure half — decides
 * what the marker MEANS, and is unit-tested next door.
 */
export function useOnshapeImportStatus(
  itemId: string | null,
  enabled = true
): OnshapeImportStatus {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [progress, setProgress] = useState<OnshapeImportProgressMarker | null>(
    null
  );
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const fetchProgress = useCallback(async () => {
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
      (data?.metadata as { progress?: OnshapeImportProgressMarker } | null)
        ?.progress ?? null;
    setProgress(next);

    clearPoll();
    if (readOnshapeImportStatus(next).running) {
      pollTimerRef.current = setTimeout(() => {
        pollTimerRef.current = null;
        void fetchProgress();
      }, POLL_INTERVAL_MS);
    }
  }, [itemId, carbon, enabled, company.id, clearPoll]);

  useEffect(() => {
    void fetchProgress();
    return () => clearPoll();
  }, [fetchProgress, clearPoll]);

  return readOnshapeImportStatus(progress);
}

export type { OnshapeImportStatus };
