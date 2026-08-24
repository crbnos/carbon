import { useCarbon } from "@carbon/auth";
import type { OnshapeImportStage } from "@carbon/ee/onshape";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "./useUser";

const POLL_INTERVAL_MS = 3_000;

/**
 * How long a start with no ending is believed.
 *
 * `onshape-bom-import` is declared `retries: 10` and its `onFailure` handler
 * stamps a failure — but a run killed outside that path (a deploy mid-run, an
 * Inngest incident) reaches neither ending. Past the cap the item stops
 * claiming to be importing: the state is UNKNOWN, not running. A blocking UI
 * must say so rather than spin forever.
 */
const STALE_AFTER_MS = 15 * 60 * 1000;

/** How long the "finished" state is worth showing after the fact. */
const FRESH_FINISH_MS = 60 * 1000;

type ImportProgress = {
  startedAt?: string;
  stage?: OnshapeImportStage;
  done?: number;
  total?: number;
  finishedAt?: string;
  failedAt?: string;
  error?: string;
  attentionCount?: number;
};

export type OnshapeImportStatus = {
  /** An import is believed to be running right now. */
  running: boolean;
  /** It finished within the last minute — worth saying once. */
  justFinished: boolean;
  /** It reported a failure, or outlived the staleness cap without an ending. */
  failed: boolean;
  /** Why it failed, when the run got far enough to say. */
  error: string | null;
  /**
   * The run outlived the cap with no ending at all, as opposed to reporting a
   * failure. Distinct because there is nothing to tell the user about the
   * cause, and the work may in fact have completed.
   */
  stalled: boolean;
  stage: OnshapeImportStage | null;
  done: number | null;
  total: number | null;
  attentionCount: number;
};

const IDLE: OnshapeImportStatus = {
  running: false,
  justFinished: false,
  failed: false,
  error: null,
  stalled: false,
  stage: null,
  done: null,
  total: null,
  attentionCount: 0
};

function readStatus(progress: ImportProgress | null): OnshapeImportStatus {
  if (!progress?.startedAt) return IDLE;

  const startedAt = Date.parse(progress.startedAt);
  if (!Number.isFinite(startedAt)) return IDLE;

  // A reported failure wins over everything: the run said what happened, and
  // that is the one thing worth showing.
  if (progress.failedAt) {
    return {
      ...IDLE,
      failed: true,
      error: progress.error ?? null,
      stage: progress.stage ?? null
    };
  }

  if (!progress.finishedAt) {
    if (Date.now() - startedAt > STALE_AFTER_MS) {
      return { ...IDLE, failed: true, stalled: true };
    }
    return {
      ...IDLE,
      running: true,
      stage: progress.stage ?? null,
      done: typeof progress.done === "number" ? progress.done : null,
      total: typeof progress.total === "number" ? progress.total : null
    };
  }

  const finishedAt = Date.parse(progress.finishedAt);
  return {
    ...IDLE,
    justFinished:
      Number.isFinite(finishedAt) && Date.now() - finishedAt < FRESH_FINISH_MS,
    attentionCount: progress.attentionCount ?? 0
  };
}

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
 * this hook only reads it.
 */
export function useOnshapeImportStatus(
  itemId: string | null,
  enabled = true
): OnshapeImportStatus {
  const { carbon } = useCarbon();
  const { company } = useUser();
  const [progress, setProgress] = useState<ImportProgress | null>(null);
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
      (data?.metadata as { progress?: ImportProgress } | null)?.progress ??
      null;
    setProgress(next);

    clearPoll();
    if (readStatus(next).running) {
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

  return readStatus(progress);
}

export { readStatus as readOnshapeImportStatus, STALE_AFTER_MS };
