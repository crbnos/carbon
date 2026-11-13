// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { isUnsafeStoragePath } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { NonRetriableError } from "inngest";
import type { JobDatabase } from "../db";
import { getCompanyTableCatalog } from "./catalog";
import { writeCompanyBackup } from "./dump";
import { backupDir, snapshotName } from "./format";
import {
  getCompanyGroupId,
  readBackupForLoad,
  resolveRestoreScope,
  wipeAndLoad
} from "./load";
import { ExportScopeViolationError, type ScopeViolation } from "./scope";
import {
  deleteCompanyFiles,
  removeCompanyPaths,
  restoreAssetsFromBackup
} from "./storage";

/**
 * The state of a long backup job, kept in a marker row for the Backups page to
 * read, and the lifecycle a reversible run (a restore, a demo template) shares:
 * snapshot, load, then keep or revert.
 */

const log = getLogger("jobs", "backup-runs");

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

export const RESTORE_INTEGRATION = "company-restore";
export const TEMPLATE_INTEGRATION = "company-template";
export const EXPORT_INTEGRATION = "company-export";

/**
 * Every job that wipes, loads or dumps a company's data takes this key, so no
 * two of them run at once for one company: a template wiping under a restore,
 * or an export reading a half-loaded company.
 */
export const PER_COMPANY_CONCURRENCY = {
  key: "'company-data-' + event.data.companyId",
  scope: "env",
  limit: 1
} as const;

/**
 * Jobs that dump a company (export, and the snapshot a restore or demo-data
 * apply takes first) share this key. A dump holds a snapshot connection plus
 * `TABLE_CONCURRENCY - 1` readers from the process's pool of 16, so two at a
 * time fit; a third would wait on connections until its readers time out.
 */
export const DUMP_CONCURRENCY = {
  key: "'company-dump'",
  scope: "env",
  limit: 2
} as const;

/** The stable keys a job reports its progress under; the page maps each to a
 *  label per job, so the job never bakes in display copy. */
export type JobPhase =
  | "snapshot"
  | "seed"
  | "wipe"
  | "load"
  | "files"
  | "tables";

export type JobProgress = { phase: JobPhase; done: number; total: number };

type RunStatus = "running" | "ready" | "failed" | "reverting";

export type RowsByTable = Array<{ table: string; rows: number }>;

type RunMeta = {
  status: RunStatus;
  /** ISO timestamp the page shows elapsed time from. */
  startedAt?: string;
  error?: string | null;
  progress?: JobProgress | null;
  /** Set when the company's LIVE data has rows whose NOT-NULL FK escapes its
   *  scope: the one failure the page offers a fix for. */
  reason?: "scope-violations" | null;
  /** Per FK edge — never sum into a row count. */
  violations?: ScopeViolation[] | null;
  /** DISTINCT rows per table — the count the user is told. */
  violationRowsByTable?: RowsByTable | null;
};

type ReversibleRunMeta = RunMeta & {
  /** Name of the pre-run snapshot in this company's bucket. */
  snapshotPath?: string | null;
  /** Whether the run covered group-scoped data, so a revert undoes exactly that. */
  includeGroup?: boolean;
  /** Files the run wrote where none existed before: a revert deletes them. */
  addedFiles?: string[];
  /** The run's data change committed. Set inside the load's own transaction
   *  (`markApplied`), so it is true exactly when the company's data is no
   *  longer what the snapshot holds — even when a later step failed. */
  applied?: boolean;
  /** A revert's reload committed: the data is the snapshot's again. Set inside
   *  the revert's transaction, so a retried apply never finishes over it. */
  reverted?: boolean;
};

/**
 * Whether a restore or demo-data run still owns the company's way back: it is
 * in flight, waiting on keep or revert, or failed after its data landed. Only
 * one such run may exist per company, or a second snapshot would capture the
 * first run's data and a revert would put the wrong data back.
 */
export function holdsPendingChange(meta: {
  status: RunStatus;
  applied?: boolean;
}): boolean {
  return meta.status !== "failed" || meta.applied === true;
}

export type RestoreRunMeta = ReversibleRunMeta & {
  restoreRunId: string;
  rows?: number;
  /** The backup came from another company; its rows were re-stamped onto this one. */
  foreign?: boolean;
  /** What was restored, so a recovery action can restart the same restore. */
  filePath?: string;
  includeStorage?: "none" | "all";
};

export type TemplateRunMeta = ReversibleRunMeta & {
  templateRunId: string;
  datasetKey?: string;
  planningError?: string | null;
};

export type ExportRunMeta = RunMeta & {
  status: "running" | "failed";
  /** The Inngest run that owns the marker: one marker serves every export of
   *  the company, so an earlier run's failure handler must not touch a later's. */
  exportRunId?: string;
  /** What a failed run asked for, so a recovery retry can reuse it. */
  label?: string | null;
  includeStorage?: "none" | "all";
};

type RunMarker<M extends RunMeta> = {
  read(): Promise<M | null>;
  /** Merge `patch` into the marker, creating it on the first write. */
  write(patch: Partial<M>): Promise<void>;
  clear(): Promise<void>;
  /** The statement that sets `applied`, to run inside the load's transaction
   *  so the flag commits with the data or not at all. */
  markApplied: { sql: string; parameters: unknown[] };
  /** The same, setting `reverted`, for a revert's reload. */
  markReverted: { sql: string; parameters: unknown[] };
};

/**
 * The marker row of one run, keyed by `entityId`: the run id for a restore
 * (several can wait on keep or revert), the company id for the one-per-company
 * template and export runs. `identity` is written last on every write, so an
 * earlier run's id merged in from the row can't shadow this run's. Reads and
 * writes throw: a marker read as absent or silently not written makes a retry
 * snapshot over the real copy, or the page wait forever.
 */
export function runMarker<M extends RunMeta>(
  client: ServiceRole,
  args: {
    integration: string;
    entityType: string;
    entityId: string;
    companyId: string;
    userId: string;
    identity: Partial<M>;
  }
): RunMarker<M> {
  const { integration, entityType, entityId, companyId, userId, identity } =
    args;
  const row = () =>
    client
      .from("externalIntegrationMapping")
      .select("id, metadata")
      .eq("integration", integration)
      .eq("companyId", companyId)
      .eq("entityId", entityId)
      .maybeSingle();
  const stamp = (flag: "applied" | "reverted") => ({
    sql: `UPDATE "externalIntegrationMapping"
        SET "metadata" = coalesce("metadata", '{}'::jsonb) || jsonb_build_object($4::text, true)
        WHERE "integration" = $1 AND "companyId" = $2 AND "entityId" = $3`,
    parameters: [integration, companyId, entityId, flag]
  });

  return {
    async read() {
      const { data, error } = await row();
      if (error) throw new Error(`Failed to read the run: ${error.message}`);
      return data ? ((data.metadata ?? {}) as M) : null;
    },
    async write(patch) {
      const existing = await row();
      if (existing.error) {
        throw new Error(`Failed to read the run: ${existing.error.message}`);
      }
      const metadata = {
        status: "running",
        ...(existing.data?.metadata as object | null),
        ...patch,
        ...identity
      };
      const written = existing.data
        ? await client
            .from("externalIntegrationMapping")
            .update({ metadata })
            .eq("id", existing.data.id)
            .eq("companyId", companyId)
        : await client.from("externalIntegrationMapping").insert({
            entityType,
            entityId,
            integration,
            externalId: entityId,
            metadata,
            companyId,
            createdBy: userId
          });
      if (written.error) {
        throw new Error(`Failed to record the run: ${written.error.message}`);
      }
    },
    async clear() {
      const { error } = await client
        .from("externalIntegrationMapping")
        .delete()
        .eq("integration", integration)
        .eq("companyId", companyId)
        .eq("entityId", entityId);
      if (error) throw new Error(`Failed to clear the run: ${error.message}`);
    },
    markApplied: stamp("applied"),
    markReverted: stamp("reverted")
  };
}

/**
 * Mark the run started. Clears what an earlier attempt, or an earlier run on the
 * same marker, left behind, so a retry never shows the last failure while it runs.
 */
export function startRun<M extends RunMeta>(
  marker: RunMarker<M>,
  patch: Partial<M>
): Promise<void> {
  return marker.write({
    status: "running",
    startedAt: datetime.timestamp(),
    progress: null,
    error: null,
    reason: null,
    violations: null,
    violationRowsByTable: null,
    ...patch
  });
}

const PROGRESS_THROTTLE_MS = 250;

/**
 * A run's progress writer. Same-phase ticks inside the throttle window are
 * dropped, but a phase change or a terminal `done === total` always goes out:
 * the wipe and load loops report per table, and each write is a read-then-write
 * of the marker. Progress is a nicety, so a failed write is logged, never fails
 * the run. It writes over its own connection, so it is safe inside a load
 * transaction.
 */
export function progressWriter(
  marker: Pick<RunMarker<RunMeta>, "write">
): (p: JobProgress) => Promise<void> {
  let lastAt = 0;
  let lastPhase = "";
  return async (progress) => {
    const now = Date.now();
    const terminal = progress.done >= progress.total;
    if (
      progress.phase === lastPhase &&
      !terminal &&
      now - lastAt < PROGRESS_THROTTLE_MS
    ) {
      return;
    }
    lastPhase = progress.phase;
    lastAt = now;
    await marker.write({ progress }).catch((err) =>
      log.warn("Failed to record progress", {
        error: err instanceof Error ? err.message : String(err)
      })
    );
  };
}

/**
 * Record `err` as the run's failure and return what the job should throw. A
 * scope-violation verdict is deterministic, so it is not retried: a retry would
 * only flicker the marker running → failed under the page's fix button. A failed
 * marker write is logged and never hides `err`.
 */
export async function failRun(
  marker: RunMarker<RunMeta>,
  err: unknown,
  prefix = ""
): Promise<unknown> {
  const message = `${prefix}${err instanceof Error ? err.message : String(err)}`;
  const scope = err instanceof ExportScopeViolationError;
  try {
    await marker.write({
      status: "failed",
      progress: null,
      error: message.slice(0, 2000),
      ...(scope
        ? {
            reason: "scope-violations",
            violations: err.violations,
            violationRowsByTable: err.rowsByTable
          }
        : {})
    });
  } catch (markerErr) {
    log.error("Failed to mark the run failed", {
      error: markerErr instanceof Error ? markerErr.message : String(markerErr)
    });
  }
  return scope ? new NonRetriableError(message, { cause: err }) : err;
}

/**
 * A job's `onFailure`: mark its run failed when the job died without reaching
 * its own catch (a timeout, an out-of-memory kill), so the run does not stay
 * "running" and lock the company out of every later run. Only the state THIS
 * job leaves (`stuck`) on a marker it `owns` is failed: an apply's handler must
 * not fail the user's revert, nor an export's a later export on the same row.
 */
export async function failStuckRun<M extends RunMeta>(
  marker: RunMarker<M>,
  err: unknown,
  stuck: "running" | "reverting",
  owns: (meta: M) => boolean = () => true
): Promise<void> {
  const meta = await marker.read();
  if (meta?.status !== stuck || !owns(meta)) return;
  await failRun(marker, err, stuck === "reverting" ? "Revert failed: " : "");
}

/**
 * What a restore or demo-data apply's work step does with its own marker:
 * `skip` when it has nothing left to do, `finish` the post-commit work when
 * its data already committed (loading again would wipe what an earlier attempt
 * loaded), or `start` from the top. The job's first step (`claimRun`) wrote
 * the marker, so a missing one was kept, dismissed or reverted during a retry
 * backoff: starting over would bring back what the user just removed.
 */
export function resumeRun(
  meta: Pick<ReversibleRunMeta, "status" | "applied" | "reverted"> | null
): "start" | "finish" | "skip" {
  if (!meta) return "skip";
  if (meta.status === "ready" || meta.status === "reverting" || meta.reverted) {
    return "skip";
  }
  return meta.applied ? "finish" : "start";
}

/**
 * Refuse a restore or demo-data run while another one holds the company's way
 * back (`holdsPendingChange`). `own` names the run asking, so its own marker,
 * on a retry, never blocks it. Every such job holds `PER_COMPANY_CONCURRENCY`,
 * so no other run can start between this read and the caller's snapshot.
 */
export async function assertNoPendingChange(
  client: ServiceRole,
  companyId: string,
  own: { restoreRunId?: string; templateRunId?: string }
): Promise<void> {
  const { data, error } = await client
    .from("externalIntegrationMapping")
    .select("integration, metadata")
    .eq("companyId", companyId)
    .in("integration", [RESTORE_INTEGRATION, TEMPLATE_INTEGRATION]);
  if (error) throw new Error(`Failed to read the runs: ${error.message}`);
  const blocking = (data ?? []).find((m) => {
    const meta = (m.metadata ?? {}) as Partial<
      RestoreRunMeta & TemplateRunMeta
    >;
    if (!meta.status) return false;
    const isOwn =
      m.integration === RESTORE_INTEGRATION
        ? meta.restoreRunId === own.restoreRunId
        : meta.templateRunId === own.templateRunId;
    return !isOwn && holdsPendingChange({ ...meta, status: meta.status });
  });
  if (blocking) {
    throw new NonRetriableError(
      blocking.integration === RESTORE_INTEGRATION
        ? "A restore is waiting to be kept or reverted. Resolve it first."
        : "A demo data change is waiting to be kept or reverted. Resolve it first."
    );
  }
}

/**
 * The snapshot a revert loads back, recorded on the marker with `record`. A prior
 * attempt's snapshot is reused, never retaken: a retry after the load committed
 * would otherwise capture the loaded data over the company's real copy.
 */
export async function takeSnapshot<M extends ReversibleRunMeta>(
  client: ServiceRole,
  db: JobDatabase,
  marker: RunMarker<M>,
  args: {
    run: "restore" | "template";
    runId: string;
    companyId: string;
    userId: string;
    record: Partial<M>;
    onProgress: (p: JobProgress) => Promise<void>;
  }
): Promise<string> {
  const existing = (await marker.read())?.snapshotPath;
  if (existing) return existing;
  const name = snapshotName(args.run, args.runId);
  try {
    await writeCompanyBackup(client, db, {
      companyId: args.companyId,
      userId: args.userId,
      label: `Pre-${args.run} ${args.runId}`,
      includeStorage: "all",
      snapshot: true,
      name,
      onProgress: (p) => args.onProgress({ ...p, phase: "snapshot" })
    });
  } catch (err) {
    // Never recorded, so nothing else would ever delete it.
    await deleteCompanyFiles(client, args.companyId, backupDir(name)).catch(
      (cleanupErr) =>
        log.error("Failed to delete a partial snapshot", {
          companyId: args.companyId,
          name,
          error:
            cleanupErr instanceof Error
              ? cleanupErr.message
              : String(cleanupErr)
        })
    );
    throw err;
  }
  await marker.write({ ...args.record, snapshotPath: name });
  return name;
}

/**
 * Keep a settled run: clear its marker, then delete its snapshot. Also
 * dismisses a failed one, which may still hold a snapshot. A run still in
 * flight is refused, or the marker would go out from under it.
 */
export async function keepRun(
  client: ServiceRole,
  marker: RunMarker<ReversibleRunMeta>,
  companyId: string
): Promise<boolean> {
  const meta = await marker.read();
  if (!meta) return false;
  if (meta.status !== "ready" && meta.status !== "failed") {
    throw new NonRetriableError(`Cannot keep a run that is ${meta.status}`);
  }
  await marker.clear();
  if (meta.snapshotPath)
    await deleteSnapshot(client, companyId, meta.snapshotPath);
  return true;
}

/** Best-effort, after the marker naming it is gone: a crash in between leaks
 *  files, never leaves a marker pointing at a deleted snapshot. */
async function deleteSnapshot(
  client: ServiceRole,
  companyId: string,
  snapshotPath: string
): Promise<void> {
  await deleteCompanyFiles(client, companyId, backupDir(snapshotPath)).catch(
    (err) =>
      log.error("Failed to delete a run's snapshot", {
        companyId,
        snapshotPath,
        error: err instanceof Error ? err.message : String(err)
      })
  );
}

/**
 * Undo a run: wipe the company again and load its snapshot back, the same scope
 * the run covered, then clear the marker and delete the snapshot. The snapshot
 * is this company's own data, so it loads verbatim. On failure, or when files
 * could not be put back, the marker keeps the snapshot so the revert can be
 * retried. Only a run whose change is pending is reverted: a failed run whose
 * data never landed holds a snapshot that is not the way back to anything.
 */
export async function revertRun(
  client: ServiceRole,
  db: JobDatabase,
  marker: RunMarker<ReversibleRunMeta>,
  companyId: string
): Promise<{ reverted: boolean; rows?: number }> {
  const meta = await marker.read();
  // Running: an apply still in flight. Reverting: a retry of this revert.
  if (!meta || meta.status === "running" || !holdsPendingChange(meta)) {
    return { reverted: false };
  }
  const snapshotPath = meta.snapshotPath;
  if (!snapshotPath) {
    // Failed, not a quiet no-op: a marker left as it was would keep offering a
    // Revert that does nothing. Failed offers Dismiss.
    await marker.write({
      status: "failed",
      progress: null,
      error: "No snapshot was recorded for this run, so it cannot be reverted."
    });
    return { reverted: false };
  }

  // Group-scoped data (chart of accounts, currencies, dimensions) is wiped and
  // reloaded only while the company is the group's sole member. A company that
  // joined since shares it now, and its rows point at it.
  if (meta.includeGroup) {
    const { includeGroup } = await resolveRestoreScope(client, companyId);
    if (!includeGroup) {
      await marker.write({
        status: "failed",
        progress: null,
        error:
          "Another company joined this company's group after this change. " +
          "Reverting would replace the chart of accounts, currencies and " +
          "dimensions it now shares, so this change can only be kept."
      });
      return { reverted: false };
    }
  }

  await marker.write({
    status: "reverting",
    startedAt: datetime.timestamp(),
    progress: null
  });
  const report = progressWriter(marker);

  try {
    const catalog = await getCompanyTableCatalog(db);
    const snapshot = await readBackupForLoad(
      client,
      companyId,
      snapshotPath,
      catalog
    );
    const { rows, idRewrite } = await wipeAndLoad(db, catalog, snapshot, {
      companyId,
      remap: null,
      includeGroup: meta.includeGroup ?? false,
      targetGroupId: await getCompanyGroupId(client, companyId),
      onProgress: report,
      markApplied: marker.markReverted
    });
    const files = await restoreAssetsFromBackup(
      client,
      {
        files: snapshot.manifest.storage,
        name: snapshotPath,
        sourceCompanyId: companyId,
        companyId,
        idRewrite
      },
      (done, total) => report({ phase: "files", done, total })
    );
    // The data is already back: a file left behind is only logged.
    // Recorded from a user-editable manifest by older runs: only keys inside
    // this company's folder are ever deleted.
    const addedFiles = (meta.addedFiles ?? []).filter(
      (p) => p.startsWith(`${companyId}/`) && !isUnsafeStoragePath(p)
    );
    await removeCompanyPaths(client, companyId, addedFiles).catch((err) =>
      log.error("Failed to delete files a reverted run added", {
        companyId,
        files: meta.addedFiles?.length,
        error: err instanceof Error ? err.message : String(err)
      })
    );
    if (files.failed > 0) {
      // `applied` stays: Keep and Revert stay offered, and the snapshot with them.
      await marker.write({
        status: "failed",
        progress: null,
        error:
          `The data was reverted, but ${files.failed} file(s) could not be ` +
          "restored. Revert again to retry them."
      });
      return { reverted: false, rows };
    }
    await marker.clear();
    await deleteSnapshot(client, companyId, snapshotPath);
    return { reverted: true, rows };
  } catch (err) {
    throw await failRun(marker, err, "Revert failed: ");
  }
}
