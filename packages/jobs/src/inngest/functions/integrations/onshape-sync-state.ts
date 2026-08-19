import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";

// Persisted Onshape sync state — the layer the three sync triggers (release
// webhook, backfill, per-item re-pull) record their outcomes into. Two
// granularities: one row per item x asset kind ("onshapeItemSyncState") and one
// row per backfill run ("onshapeSyncRun").
//
// Item state machine:
//
//             route writes            job step writes
//   (none) ──▶ queued ──▶ running ──▶ synced | skipped(reason) | failed(error)
//                │                        ▲
//                └── stale >10min ────────┘  (read-side only: the UI re-enables
//                    "didn't start"           re-pull; the next write flips it back)
//
// Run state machine:
//
//   route insert          job onFailure ──▶ failed(error)
//   queued ──▶ running ──▶ completed
//      │           │
//      │           └── cancel route: writes cancelled(cancelledBy) THEN fires
//      │               carbon/onshape-backfill.cancel (cancelOn kills the run,
//      │               which runs no cleanup — the route write IS the record)
//      └── >30min without a progress write reads "no progress" (read-side only)
//
// Three rules hold for everything in this file:
//
//   1. Every write is BEST-EFFORT — it catches, logs and resolves. Bookkeeping
//      must never fail a sync step: a throw here would make Inngest retry an
//      export that already succeeded.
//   2. Terminal states are only ever written explicitly. `isStalled` is a
//      read-side warning and never flips a stored status.
//   3. Every query filters companyId, and every write goes through the
//      service-role client the jobs already hold (both tables are SELECT-only
//      under RLS).

const log = getLogger("jobs", "onshape-sync-state");

type CarbonClient = SupabaseClient<Database>;

type ItemSyncStateInsert =
  Database["public"]["Tables"]["onshapeItemSyncState"]["Insert"];
type SyncRunUpdate = Database["public"]["Tables"]["onshapeSyncRun"]["Update"];

export type OnshapeSyncAssetKind = "model" | "drawing";

export type OnshapeItemSyncStatus =
  | "queued"
  | "running"
  | "synced"
  | "skipped"
  | "failed";

export type OnshapeSyncSource = "webhook" | "backfill" | "manual";

export type OnshapeSyncRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

// Wire codes only — the UI owns the display copy for each of these.
export type OnshapeSkipReason =
  | "revision-not-found"
  | "asset-too-large"
  | "ambiguous-item"
  | "existing-asset";

// A run row's status is terminal once one of these landed; nothing the job
// writes afterwards may overwrite it (a recorded cancel outranks the job's own
// completion write).
const NON_TERMINAL_RUN_STATUSES: OnshapeSyncRunStatus[] = ["queued", "running"];

// Postgres foreign_key_violation. The only FK an item-state write can break is
// "runId" -> onshapeSyncRun, reachable when retention prunes a run while that
// run's own job is still reporting into it.
const FOREIGN_KEY_VIOLATION = "23503";

/** An item row that has sat in `queued` longer than this reads as stalled. */
export const ITEM_SYNC_STALL_MS = 10 * 60 * 1000;

/** A run with no progress write for longer than this reads as stalled. */
export const SYNC_RUN_STALL_MS = 30 * 60 * 1000;

/** How many release references a run row keeps before it only counts them. */
export const RELEASE_CAPTURE_LIMIT = 200;

// --- Item state -------------------------------------------------------------

export interface BuildItemSyncStateInput {
  companyId: string;
  /** Acting user: webhook → installer, backfill → initiator, re-pull → clicker. */
  userId: string;
  itemId: string;
  assetKind: OnshapeSyncAssetKind;
  status: OnshapeItemSyncStatus;
  source: OnshapeSyncSource;
  skipReason?: OnshapeSkipReason | null;
  error?: string | null;
  /** The sync saw an asset that was already attached (never re-downloaded it). */
  observedOnly?: boolean;
  partNumber?: string | null;
  revision?: string | null;
  revisionId?: string | null;
  documentId?: string | null;
  versionId?: string | null;
  elementId?: string | null;
  releaseState?: string | null;
  modelUploadId?: string | null;
  documentPath?: string | null;
  runId?: string | null;
}

export type OnshapeItemSyncStateWrite = Omit<
  ItemSyncStateInsert,
  "id" | "createdBy" | "createdAt" | "updatedBy" | "updatedAt"
>;

// Pure: the full column set for one item x asset kind, with every optional
// field spelled out as null. The explicit nulls are load-bearing — the same
// object updates an existing row, so a value the new outcome doesn't have
// (a cleared error, a dropped skip reason) has to be written away rather than
// left behind from the previous sync.
export function buildItemSyncState(
  input: BuildItemSyncStateInput
): OnshapeItemSyncStateWrite {
  return {
    companyId: input.companyId,
    itemId: input.itemId,
    assetKind: input.assetKind,
    status: input.status,
    source: input.source,
    skipReason: input.skipReason ?? null,
    error: input.error ?? null,
    observedOnly: input.observedOnly ?? false,
    partNumber: input.partNumber ?? null,
    revision: input.revision ?? null,
    revisionId: input.revisionId ?? null,
    documentId: input.documentId ?? null,
    versionId: input.versionId ?? null,
    elementId: input.elementId ?? null,
    releaseState: input.releaseState ?? null,
    modelUploadId: input.modelUploadId ?? null,
    documentPath: input.documentPath ?? null,
    runId: input.runId ?? null
  };
}

export interface StateWriteResult {
  /** Whether the write reached the database and changed a row. */
  applied: boolean;
}

// Best-effort upsert of one item x asset kind row. Read-then-write rather than
// a PostgREST upsert so an update keeps the row's original createdBy/createdAt
// (an upsert overwrites every column it carries), and so a never-updated
// `queued` row keeps a null updatedAt for the stall read to fall back from.
export async function upsertItemSyncState(
  carbon: CarbonClient,
  input: BuildItemSyncStateInput
): Promise<StateWriteResult> {
  try {
    const row = buildItemSyncState(input);
    const existing = await carbon
      .from("onshapeItemSyncState")
      .select("id")
      .eq("companyId", input.companyId)
      .eq("itemId", input.itemId)
      .eq("assetKind", input.assetKind)
      .maybeSingle();
    if (existing.error) {
      throw new Error(existing.error.message);
    }

    // A run pruned mid-flight must cost the attribution, not the outcome: the
    // status and identifiers are the record of what happened to this asset, and
    // "runId" only says which bulk run noticed it.
    const withoutRunAttribution = { ...row, runId: null };

    if (existing.data) {
      const existingRowId = existing.data.id;
      const updateState = (values: typeof row) =>
        carbon
          .from("onshapeItemSyncState")
          .update({
            ...values,
            updatedBy: input.userId,
            updatedAt: new Date().toISOString()
          })
          .eq("id", existingRowId)
          .eq("companyId", input.companyId);

      let updated = await updateState(row);
      if (updated.error?.code === FOREIGN_KEY_VIOLATION && row.runId) {
        updated = await updateState(withoutRunAttribution);
      }
      if (updated.error) {
        throw new Error(updated.error.message);
      }
      return { applied: true };
    }

    const insertState = (values: typeof row) =>
      carbon
        .from("onshapeItemSyncState")
        .insert({ ...values, createdBy: input.userId });

    let inserted = await insertState(row);
    if (inserted.error?.code === FOREIGN_KEY_VIOLATION && row.runId) {
      inserted = await insertState(withoutRunAttribution);
    }
    if (inserted.error) {
      throw new Error(inserted.error.message);
    }
    return { applied: true };
  } catch (writeError) {
    log.error(
      "onshape sync state: item write failed (sync itself is unaffected)",
      {
        companyId: input.companyId,
        itemId: input.itemId,
        assetKind: input.assetKind,
        status: input.status,
        error: writeError instanceof Error ? writeError.message : writeError
      }
    );
    return { applied: false };
  }
}

export interface MarkItemSyncFailedByElementInput {
  companyId: string;
  userId: string;
  /** The released Onshape element the failed run was syncing. */
  elementId: string;
  /**
   * The released revision the failed run was syncing. Required to attribute the
   * failure: one element is released over and over, and each revision is its own
   * Carbon item row. Absent (the release payload carried no revision id) means
   * the failure is not attributable and nothing is written.
   */
  revisionId?: string | null;
  assetKind: OnshapeSyncAssetKind;
  error: string;
}

// Failure path for the webhook sync: the run failed before it could return the
// resolved item, so the row is reached by the released element + revision it was
// syncing (both persisted by every prior sync of that release). The revision is
// part of the key because one Onshape element carries every revision of the part
// while each Carbon revision is its OWN item row — an element-wide update would
// rewrite the sibling revisions' recorded outcomes with this revision's error.
// A first-ever sync that fails before matching has no row to flip — that is
// recorded at run level only.
export async function markItemSyncStateFailedByElement(
  carbon: CarbonClient,
  input: MarkItemSyncFailedByElementInput
): Promise<StateWriteResult> {
  if (!input.revisionId) {
    log.warn(
      "onshape sync state: failure not attributable to a revision — leaving every row for this element as recorded",
      {
        companyId: input.companyId,
        elementId: input.elementId,
        assetKind: input.assetKind
      }
    );
    return { applied: false };
  }
  try {
    const updated = await carbon
      .from("onshapeItemSyncState")
      .update(
        {
          status: "failed",
          error: input.error,
          updatedBy: input.userId,
          updatedAt: new Date().toISOString()
        },
        { count: "exact" }
      )
      .eq("companyId", input.companyId)
      .eq("elementId", input.elementId)
      .eq("revisionId", input.revisionId)
      .eq("assetKind", input.assetKind);
    if (updated.error) {
      throw new Error(updated.error.message);
    }
    return { applied: (updated.count ?? 0) > 0 };
  } catch (writeError) {
    log.error("onshape sync state: item failure write failed", {
      companyId: input.companyId,
      elementId: input.elementId,
      revisionId: input.revisionId,
      assetKind: input.assetKind,
      error: writeError instanceof Error ? writeError.message : writeError
    });
    return { applied: false };
  }
}

export interface MarkItemSyncFailedByItemInput {
  companyId: string;
  userId: string;
  itemId: string;
  assetKind: OnshapeSyncAssetKind;
  error: string;
  /**
   * Only flip a row currently in one of these statuses. Omit to flip whatever
   * the row holds.
   */
  onlyFromStatuses?: OnshapeItemSyncStatus[];
}

// Failure path for a sync that already knows WHICH item it was working on (the
// per-item re-pull). An update, never an upsert: the identifiers a previous
// sync persisted are what a later re-pull reads, so a failure records the
// status and error without touching the rest of the row. A row that does not
// exist is left alone — a failure has nothing to attribute itself to.
export async function markItemSyncStateFailedByItem(
  carbon: CarbonClient,
  input: MarkItemSyncFailedByItemInput
): Promise<StateWriteResult> {
  try {
    const now = new Date().toISOString();
    let update = carbon
      .from("onshapeItemSyncState")
      .update(
        {
          status: "failed",
          error: input.error,
          updatedBy: input.userId,
          updatedAt: now
        },
        { count: "exact" }
      )
      .eq("companyId", input.companyId)
      .eq("itemId", input.itemId)
      .eq("assetKind", input.assetKind);
    if (input.onlyFromStatuses) {
      update = update.in("status", input.onlyFromStatuses);
    }
    const updated = await update;
    if (updated.error) {
      throw new Error(updated.error.message);
    }
    return { applied: (updated.count ?? 0) > 0 };
  } catch (writeError) {
    log.error("onshape sync state: item failure write failed", {
      companyId: input.companyId,
      itemId: input.itemId,
      assetKind: input.assetKind,
      error: writeError instanceof Error ? writeError.message : writeError
    });
    return { applied: false };
  }
}

// --- Asset provenance -------------------------------------------------------

/**
 * What a sync may claim about a matched release whose item already holds an
 * asset of that kind:
 *
 *   - `already-synced` — a state row proves THIS integration attached THIS
 *     released revision. The export is skipped and nothing is written: the
 *     existing row already says so, accurately.
 *   - `existing-asset` — something is attached, but nothing proves we fetched
 *     it. The export is still skipped (an attached asset is never clobbered and
 *     Onshape quota is never spent on one), and the row records exactly that
 *     much: skipped, reason `existing-asset`, observed only.
 *   - `sync` — nothing is attached, so the release needs an export.
 */
export type OnshapeAssetDisposition =
  | "already-synced"
  | "existing-asset"
  | "sync";

/** The provenance columns of one `onshapeItemSyncState` row. */
export interface OnshapeAssetProvenance {
  status: string;
  revisionId: string | null;
  elementId: string | null;
}

export interface OnshapeReleasedAsset {
  /** An asset of this kind hangs off the item — provenance unknown. */
  assetAttached: boolean;
  /** The released revision's own id, when the release carries one. */
  revisionId: string | null;
  /** The released element the asset would be exported from. */
  elementId: string;
}

// Does this row prove we synced this exact released revision? The revision id is
// the precise key; the element id is enough on its own because a row is already
// scoped to one item x asset kind and every Carbon revision is its own item.
function provesOnshapeSync(
  release: OnshapeReleasedAsset,
  provenance: OnshapeAssetProvenance | null | undefined
): boolean {
  if (provenance?.status !== "synced") {
    return false;
  }
  return release.revisionId
    ? provenance.revisionId === release.revisionId
    : provenance.elementId === release.elementId;
}

// Pure. An attached file proves only that SOMETHING is attached: a quality
// certificate someone uploaded by hand is a PDF like any other, and a manually
// uploaded model fills modelUploadId like any other. This table is the only
// record of what the Onshape sync itself fetched, so it is the only thing that
// may promote an attachment to "synced".
export function classifyOnshapeReleasedAsset(
  release: OnshapeReleasedAsset,
  provenance: OnshapeAssetProvenance | null | undefined
): OnshapeAssetDisposition {
  if (!release.assetAttached) {
    return "sync";
  }
  return provesOnshapeSync(release, provenance)
    ? "already-synced"
    : "existing-asset";
}

// --- Run progress -----------------------------------------------------------

// A release Onshape reported that the run could not attach to exactly one item.
// Type alias (not an interface) so it satisfies the generated JSONB column type.
export type OnshapeReleaseReference = {
  partNumber: string;
  revision: string;
  state: string | null;
};

export interface OnshapeRunProgress {
  pagesProcessed: number;
  revisionsScanned: number;
  matched: number;
  synced: number;
  skippedNoItem: number;
  skippedAlreadySynced: number;
  skippedNonModel: number;
  skippedTooLarge: number;
  failed: number;
  unmatchedReleases: OnshapeReleaseReference[];
  unmatchedOverflow: number;
  ambiguousReleases: OnshapeReleaseReference[];
  ambiguousOverflow: number;
}

export type OnshapeRunCounterDelta = Partial<
  Pick<
    OnshapeRunProgress,
    | "pagesProcessed"
    | "revisionsScanned"
    | "matched"
    | "synced"
    | "skippedNoItem"
    | "skippedAlreadySynced"
    | "skippedNonModel"
    | "skippedTooLarge"
    | "failed"
  >
>;

export function createRunProgress(): OnshapeRunProgress {
  return {
    pagesProcessed: 0,
    revisionsScanned: 0,
    matched: 0,
    synced: 0,
    skippedNoItem: 0,
    skippedAlreadySynced: 0,
    skippedNonModel: 0,
    skippedTooLarge: 0,
    failed: 0,
    unmatchedReleases: [],
    unmatchedOverflow: 0,
    ambiguousReleases: [],
    ambiguousOverflow: 0
  };
}

// Pure: adds a delta and returns a new progress value. The backfill keeps its
// accumulator at function-body level, where the Inngest body replays on every
// step — so accumulation has to be a deterministic fold over memoized step
// results, never a read-modify-write against the database.
export function accumulateRunCounters(
  progress: OnshapeRunProgress,
  delta: OnshapeRunCounterDelta
): OnshapeRunProgress {
  return {
    ...progress,
    pagesProcessed: progress.pagesProcessed + (delta.pagesProcessed ?? 0),
    revisionsScanned: progress.revisionsScanned + (delta.revisionsScanned ?? 0),
    matched: progress.matched + (delta.matched ?? 0),
    synced: progress.synced + (delta.synced ?? 0),
    skippedNoItem: progress.skippedNoItem + (delta.skippedNoItem ?? 0),
    skippedAlreadySynced:
      progress.skippedAlreadySynced + (delta.skippedAlreadySynced ?? 0),
    skippedNonModel: progress.skippedNonModel + (delta.skippedNonModel ?? 0),
    skippedTooLarge: progress.skippedTooLarge + (delta.skippedTooLarge ?? 0),
    failed: progress.failed + (delta.failed ?? 0)
  };
}

// Keeps the first RELEASE_CAPTURE_LIMIT references and counts the rest, so one
// pathological catalog can't grow a run row without bound.
function appendCappedReleases(
  captured: OnshapeReleaseReference[],
  overflow: number,
  incoming: OnshapeReleaseReference[]
): { captured: OnshapeReleaseReference[]; overflow: number } {
  const room = Math.max(RELEASE_CAPTURE_LIMIT - captured.length, 0);
  const kept = incoming.slice(0, room);
  return {
    captured: kept.length > 0 ? [...captured, ...kept] : captured,
    overflow: overflow + (incoming.length - kept.length)
  };
}

export function captureUnmatchedReleases(
  progress: OnshapeRunProgress,
  incoming: OnshapeReleaseReference[]
): OnshapeRunProgress {
  const appended = appendCappedReleases(
    progress.unmatchedReleases,
    progress.unmatchedOverflow,
    incoming
  );
  return {
    ...progress,
    unmatchedReleases: appended.captured,
    unmatchedOverflow: appended.overflow
  };
}

export function captureAmbiguousReleases(
  progress: OnshapeRunProgress,
  incoming: OnshapeReleaseReference[]
): OnshapeRunProgress {
  const appended = appendCappedReleases(
    progress.ambiguousReleases,
    progress.ambiguousOverflow,
    incoming
  );
  return {
    ...progress,
    ambiguousReleases: appended.captured,
    ambiguousOverflow: appended.overflow
  };
}

function runProgressColumns(progress: OnshapeRunProgress): SyncRunUpdate {
  return {
    pagesProcessed: progress.pagesProcessed,
    revisionsScanned: progress.revisionsScanned,
    matched: progress.matched,
    synced: progress.synced,
    skippedNoItem: progress.skippedNoItem,
    skippedAlreadySynced: progress.skippedAlreadySynced,
    skippedNonModel: progress.skippedNonModel,
    skippedTooLarge: progress.skippedTooLarge,
    failed: progress.failed,
    unmatchedReleases: progress.unmatchedReleases,
    unmatchedOverflow: progress.unmatchedOverflow,
    ambiguousReleases: progress.ambiguousReleases,
    ambiguousOverflow: progress.ambiguousOverflow
  };
}

export interface RunWriteInput {
  companyId: string;
  /** Absent on events queued before v2 — those runs are untracked, not invented. */
  runId?: string | null;
  userId: string;
}

// Promotes the route's `queued` row to `running`. The status filter is the
// guard: a run cancelled between the route insert and the job's first step
// stays cancelled instead of being restarted.
export async function markRunRunning(
  carbon: CarbonClient,
  input: RunWriteInput
): Promise<StateWriteResult> {
  if (!input.runId) {
    return { applied: false };
  }
  const runId = input.runId;
  try {
    const now = new Date().toISOString();
    const updated = await carbon
      .from("onshapeSyncRun")
      .update(
        {
          status: "running",
          startedAt: now,
          updatedBy: input.userId,
          updatedAt: now
        },
        { count: "exact" }
      )
      .eq("id", runId)
      .eq("companyId", input.companyId)
      .eq("status", "queued");
    if (updated.error) {
      throw new Error(updated.error.message);
    }
    return { applied: (updated.count ?? 0) > 0 };
  } catch (writeError) {
    log.error("onshape sync state: run start write failed", {
      companyId: input.companyId,
      runId,
      error: writeError instanceof Error ? writeError.message : writeError
    });
    return { applied: false };
  }
}

// One memoized progress write per page. A cancelled/terminal run stops
// accruing progress — the status filter, not a read, enforces that.
export async function writeRunProgress(
  carbon: CarbonClient,
  input: RunWriteInput & { progress: OnshapeRunProgress }
): Promise<StateWriteResult> {
  if (!input.runId) {
    return { applied: false };
  }
  const runId = input.runId;
  try {
    const updated = await carbon
      .from("onshapeSyncRun")
      .update(
        {
          ...runProgressColumns(input.progress),
          updatedBy: input.userId,
          updatedAt: new Date().toISOString()
        },
        { count: "exact" }
      )
      .eq("id", runId)
      .eq("companyId", input.companyId)
      .in("status", NON_TERMINAL_RUN_STATUSES);
    if (updated.error) {
      throw new Error(updated.error.message);
    }
    return { applied: (updated.count ?? 0) > 0 };
  } catch (writeError) {
    log.error("onshape sync state: run progress write failed", {
      companyId: input.companyId,
      runId,
      error: writeError instanceof Error ? writeError.message : writeError
    });
    return { applied: false };
  }
}

export interface FinalizeRunInput extends RunWriteInput {
  status: Extract<OnshapeSyncRunStatus, "completed" | "failed">;
  error?: string | null;
  /** Final counters, so a completed run's row is authoritative. */
  progress?: OnshapeRunProgress;
}

// Terminal write for the job's own outcome. The status filter keeps it from
// overwriting a state the job doesn't own: a run the cancel route already
// recorded as `cancelled` (or a terminal state written by an earlier attempt)
// is left exactly as recorded.
export async function finalizeRun(
  carbon: CarbonClient,
  input: FinalizeRunInput
): Promise<StateWriteResult> {
  if (!input.runId) {
    return { applied: false };
  }
  const runId = input.runId;
  try {
    const now = new Date().toISOString();
    const updated = await carbon
      .from("onshapeSyncRun")
      .update(
        {
          ...(input.progress ? runProgressColumns(input.progress) : {}),
          status: input.status,
          error: input.error ?? null,
          finishedAt: now,
          updatedBy: input.userId,
          updatedAt: now
        },
        { count: "exact" }
      )
      .eq("id", runId)
      .eq("companyId", input.companyId)
      .in("status", NON_TERMINAL_RUN_STATUSES);
    if (updated.error) {
      throw new Error(updated.error.message);
    }
    if ((updated.count ?? 0) === 0) {
      log.info(
        "onshape sync state: run already terminal — leaving the recorded state",
        { companyId: input.companyId, runId, attemptedStatus: input.status }
      );
      return { applied: false };
    }
    return { applied: true };
  } catch (writeError) {
    log.error("onshape sync state: run finalize write failed", {
      companyId: input.companyId,
      runId,
      status: input.status,
      error: writeError instanceof Error ? writeError.message : writeError
    });
    return { applied: false };
  }
}

// --- Stall reads ------------------------------------------------------------

export type OnshapeStallSubject =
  | {
      kind: "item";
      status: OnshapeItemSyncStatus;
      createdAt: string;
      updatedAt?: string | null;
    }
  | {
      kind: "run";
      status: OnshapeSyncRunStatus;
      createdAt: string;
      updatedAt?: string | null;
    };

// Read-side heartbeat, keyed on the row's own updatedAt (falling back to
// createdAt for a never-updated row — there is no separate lastSyncedAt
// column). WARNING ONLY: this never writes, and the next real write flips a
// row back to live simply by refreshing updatedAt. Terminal states and the
// backfill's 409 start-guard are unaffected by it.
export function isStalled(
  subject: OnshapeStallSubject,
  now: Date = new Date()
): boolean {
  const referenceTimestamp = Date.parse(subject.updatedAt ?? subject.createdAt);
  if (Number.isNaN(referenceTimestamp)) {
    return false;
  }
  const elapsedMs = now.getTime() - referenceTimestamp;

  if (subject.kind === "item") {
    // Only `queued` reads stalled: a `running` item is inside a step Inngest is
    // still retrying, and every other status is an outcome.
    return subject.status === "queued" && elapsedMs > ITEM_SYNC_STALL_MS;
  }

  return (
    (subject.status === "queued" || subject.status === "running") &&
    elapsedMs > SYNC_RUN_STALL_MS
  );
}
