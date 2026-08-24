import type { OnshapeImportStage } from "@carbon/ee/onshape";

// The pure half of `useOnshapeImportStatus`, in its own module so it can be
// unit-tested. The hook itself imports `@carbon/auth` and `useUser`, which pull
// the glossary's Lingui macros through a transform the test config does not run
// — the same reason `packages/ee/src/onshape/lib/token.ts` exists.
//
// It is worth testing on its own: the create modal BLOCKS on what this returns,
// so "running" that never becomes anything else is a user stuck in a dialog.

/**
 * How long a start with no ending is believed.
 *
 * Both Onshape jobs are `retries: 10` and stamp a failure through `onFailure` —
 * but a run killed outside that path (a deploy mid-run, an Inngest incident)
 * reaches neither ending. Past the cap the item stops claiming to be importing:
 * the state is UNKNOWN, not running.
 */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** How long the "finished" state is worth showing after the fact. */
export const FRESH_FINISH_MS = 60 * 1000;

export type OnshapeImportProgressMarker = {
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

export function readOnshapeImportStatus(
  progress: OnshapeImportProgressMarker | null
): OnshapeImportStatus {
  // A marker with no start describes an import that never began — including a
  // finish written with nothing to merge into. Reading that as finished would
  // let a blocking UI move on from a part nothing built.
  if (!progress?.startedAt) return IDLE;

  const startedAt = Date.parse(progress.startedAt);
  if (!Number.isFinite(startedAt)) return IDLE;

  // A reported failure wins over everything, including a finish written
  // alongside it: the run said what happened, and that is what the person
  // waiting needs told.
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
