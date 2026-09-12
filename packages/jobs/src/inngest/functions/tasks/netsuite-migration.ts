import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  type DetectedGap,
  extractNetSuite,
  mapSnapshotToPlan,
  planCounts,
  SubsidiaryChoiceRequired
} from "@carbon/netsuite";
import { datetime } from "@carbon/utils";
import { NonRetriableError } from "inngest";
import type { Transaction } from "kysely";

import { applyTableRenames } from "../../../backups/renames";
import { getJobDatabaseClient } from "../../../db";
import { getNetSuiteConnection } from "../../../netsuite/credentials";
import { loadMigrationPlan } from "../../../netsuite/load";
import { inngest } from "../../client";
import {
  backupAssetsDir,
  backupDir,
  getCompanyTableCatalog,
  type JobProgress,
  readBackup,
  removeStoragePrefix,
  restoreAssetsFromBackup,
  throttleProgress,
  writeBackupManifest
} from "./company-backup";
import { buildCompanyBackup } from "./company-export";
import { resolveRestoreScope, wipeAndLoad } from "./company-restore";

/**
 * NetSuite → Carbon, in one click.
 *
 * Three phases, one durable step: **extract** reads NetSuite over SuiteQL,
 * **map** turns those rows into a migration plan with no I/O at all, and **load**
 * writes the plan into this company inside a single transaction. The split is
 * what makes the thing testable — mapping is the part with all the product
 * decisions in it, and it runs without a NetSuite account or a database.
 *
 * Carbon only ever READS from NetSuite. There is no write-back, no two-way sync,
 * and nothing in the customer's NetSuite account changes.
 *
 * Safety is reversibility, not caution: the job snapshots the company first and
 * parks on a keep/revert decision, exactly like a demo-data apply. A migration
 * that could not be undone is one nobody would click.
 */

export const NETSUITE_MIGRATION_INTEGRATION = "netsuite-migration";

// Migrate, finalize and revert all take this, so the three can never run
// concurrently for one company — each assumes the marker is its own.
const PER_COMPANY_CONCURRENCY = {
  key: "'netsuite-migration-' + event.data.companyId",
  scope: "env",
  limit: 1
} as const;

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

type MigrationStatus = "running" | "ready" | "failed" | "reverting";

/** What the run report keeps per gap — the prose lives in the catalog, not here. */
type MigrationGapSummary = {
  id: string;
  count: number | null;
  examples: string[];
};

type MigrationReport = {
  accountId: string;
  subsidiaryId: string | null;
  sandbox: boolean;
  /** Rows written per plan section. */
  counts: Record<
    string,
    { inserted: number; updated: number; skipped: number }
  >;
  /** Rows the plan HELD per section, whether or not they were written. */
  extracted: Record<string, number>;
  linked: number;
  warnings: string[];
  notes: string[];
  gaps: MigrationGapSummary[];
};

type MigrationMeta = {
  migrationRunId: string;
  status: MigrationStatus;
  startedAt?: string;
  error?: string | null;
  /** Folder name of the pre-migration snapshot in this company's bucket. */
  snapshotPath?: string;
  /** Scope the forward migration covered, so a revert undoes exactly that. */
  includeGroup?: boolean;
  /** Live phase progress, so a run that takes minutes doesn't look hung. */
  progress?: JobProgress | null;
  /** True when the run only previewed — nothing was written. */
  dryRun?: boolean;
  report?: MigrationReport | null;
  /** Set when the account has several subsidiaries and the user must choose one. */
  subsidiaryChoices?:
    | { id: string; name: string; currencyCode: string | null }[]
    | null;
};

/**
 * One marker row per company. The partial unique index on
 * ("integration","externalId","entityType","companyId") rejects a second row for
 * the same company outright, so identity lives in `metadata.migrationRunId`
 * rather than in `externalId`.
 */
async function readMigrationMarker(
  client: ServiceRole,
  companyId: string
): Promise<{ id: string; metadata: MigrationMeta } | null> {
  const marker = await client
    .from("externalIntegrationMapping")
    .select("id, metadata")
    .eq("integration", NETSUITE_MIGRATION_INTEGRATION)
    .eq("companyId", companyId)
    .maybeSingle();

  if (marker.error) {
    throw new Error(
      `Failed to read the NetSuite migration marker: ${marker.error.message}`
    );
  }
  if (!marker.data) return null;
  return {
    id: marker.data.id,
    metadata: (marker.data.metadata ?? {}) as MigrationMeta
  };
}

/**
 * Upsert the marker, merging `patch` into its metadata.
 *
 * Errors throw: a marker that silently failed to write is worse than none,
 * because the page reads a missing marker as "the migration never ran".
 */
async function writeMigrationMarker(
  client: ServiceRole,
  args: {
    companyId: string;
    userId: string;
    migrationRunId: string;
    patch: Partial<MigrationMeta>;
  }
): Promise<void> {
  const { companyId, userId, migrationRunId, patch } = args;
  const existing = await readMigrationMarker(client, companyId);

  const metadata: MigrationMeta = {
    status: "running",
    ...existing?.metadata,
    ...patch,
    // LAST: the marker is looked up by companyId alone, so merged earlier a
    // previous failed run's id would shadow this one's and the Keep/Revert
    // buttons would post the wrong run.
    migrationRunId
  };

  const written = existing
    ? await client
        .from("externalIntegrationMapping")
        .update({ metadata })
        .eq("id", existing.id)
        .eq("companyId", companyId)
    : await client.from("externalIntegrationMapping").insert({
        entityType: "migration",
        entityId: companyId,
        integration: NETSUITE_MIGRATION_INTEGRATION,
        externalId: "",
        metadata,
        companyId,
        createdBy: userId
      });

  if (written.error) {
    throw new Error(
      `Failed to write the NetSuite migration marker: ${written.error.message}`
    );
  }
}

async function clearMigrationMarker(
  client: ServiceRole,
  companyId: string
): Promise<void> {
  const deleted = await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("integration", NETSUITE_MIGRATION_INTEGRATION)
    .eq("companyId", companyId);

  if (deleted.error) {
    throw new Error(
      `Failed to clear the NetSuite migration marker: ${deleted.error.message}`
    );
  }
}

/**
 * Throttled progress writer.
 *
 * The whole migration is ONE durable step lasting minutes, so this marker is the
 * only thing the page can read while it works. The write goes over supabase-js
 * on its own connection, which is why it is safe to call from inside the load
 * transaction.
 */
function makeProgressReporter(
  client: ServiceRole,
  args: { companyId: string; userId: string; migrationRunId: string }
): (progress: JobProgress) => Promise<void> {
  return throttleProgress((progress) =>
    writeMigrationMarker(client, { ...args, patch: { progress } })
  );
}

/** Thrown to roll a dry run's transaction back once the load has proved itself. */
class DryRunRollback extends Error {
  readonly result: Awaited<ReturnType<typeof loadMigrationPlan>>;

  constructor(result: Awaited<ReturnType<typeof loadMigrationPlan>>) {
    super("dry run");
    this.name = "DryRunRollback";
    this.result = result;
  }
}

function summarizeGaps(gaps: DetectedGap[]): MigrationGapSummary[] {
  return gaps.map((gap) => ({
    id: gap.id,
    count: gap.count,
    examples: gap.examples
  }));
}

export const netsuiteMigrationFunction = inngest.createFunction(
  {
    id: "netsuite-migration",
    // One retry only. A migration is not idempotent to RE-RUN blindly — it is
    // idempotent by external id, which is a different thing: a retry after a
    // partial extract re-reads NetSuite from scratch, which is correct but slow.
    retries: 1,
    // The unkeyed limit bounds how many companies migrate at once, because each
    // run holds a database connection for a whole transaction.
    concurrency: [{ limit: 2 }, PER_COMPANY_CONCURRENCY]
  },
  { event: "carbon/netsuite-migration" },
  async ({ event, step, logger }) => {
    const {
      companyId,
      userId,
      migrationRunId,
      subsidiaryId = null,
      dryRun = false
    } = event.data;

    return await step.run("migrate-from-netsuite", async () => {
      const client = getCarbonServiceRole();

      // One change at a time. A second migration while one is still pending
      // review would overwrite the only snapshot of the company's real data.
      const existing = await readMigrationMarker(client, companyId);
      if (
        existing &&
        existing.metadata.migrationRunId !== migrationRunId &&
        existing.metadata.status !== "failed"
      ) {
        throw new NonRetriableError(
          "A NetSuite migration is already pending — keep or revert it first."
        );
      }

      await writeMigrationMarker(client, {
        companyId,
        userId,
        migrationRunId,
        patch: {
          status: "running",
          startedAt: datetime.timestamp(),
          error: null,
          dryRun,
          report: null,
          subsidiaryChoices: null,
          progress: null
        }
      });

      const report = makeProgressReporter(client, {
        companyId,
        userId,
        migrationRunId
      });
      const db = getJobDatabaseClient(2);

      try {
        // ── Connect ──────────────────────────────────────────────────────────
        await report({ phase: "connect", done: 0, total: 1 });
        const connection = await getNetSuiteConnection(companyId);
        await report({ phase: "connect", done: 1, total: 1 });

        // ── Extract ──────────────────────────────────────────────────────────
        const snapshot = await extractNetSuite(
          connection.client,
          connection.accountId,
          {
            subsidiaryId,
            onProgress: (progress) => report({ ...progress, phase: "extract" }),
            log: (message) =>
              logger.info(message, { companyId, migrationRunId })
          }
        );

        // ── Map ──────────────────────────────────────────────────────────────
        await report({ phase: "map", done: 0, total: 1 });
        const mapped = mapSnapshotToPlan(snapshot);
        await report({ phase: "map", done: 1, total: 1 });

        // ── Snapshot ─────────────────────────────────────────────────────────
        // Reused, never retaken: an attempt that ran after the load committed
        // would capture the MIGRATED state and destroy the pre-migration copy.
        let snapshotPath = existing?.metadata.snapshotPath ?? undefined;
        let includeGroup = existing?.metadata.includeGroup ?? false;

        if (!dryRun && !snapshotPath) {
          const scope = await resolveRestoreScope(client, companyId);
          includeGroup = scope.includeGroup;
          snapshotPath = `_pre-netsuite-${migrationRunId}`;

          const snap = await buildCompanyBackup(client, db, {
            companyId,
            userId,
            label: `Before NetSuite migration ${migrationRunId}`,
            includeStorage: "all",
            name: snapshotPath,
            onProgress: (progress) => report({ ...progress, phase: "snapshot" })
          });
          await writeBackupManifest(
            client,
            companyId,
            snapshotPath,
            snap.manifest
          );
          await writeMigrationMarker(client, {
            companyId,
            userId,
            migrationRunId,
            patch: { snapshotPath, includeGroup }
          });
        }

        // ── Load ─────────────────────────────────────────────────────────────
        // One transaction for the whole plan: a failure in the last section
        // rolls back the first. A half-migrated company — customers but no
        // items, orders pointing at items that do not exist — is not a state
        // anybody could reason about, let alone clean up.
        let loadResult: Awaited<ReturnType<typeof loadMigrationPlan>>;
        try {
          loadResult = await db.transaction().execute(async (trx) => {
            const result = await loadMigrationPlan(
              trx as Transaction<KyselyDatabase>,
              {
                companyId,
                userId,
                plan: mapped.plan,
                onProgress: (progress) =>
                  report({ ...progress, phase: "load" }),
                log: (message) =>
                  logger.info(message, { companyId, migrationRunId })
              }
            );
            // A dry run takes the SAME path and then refuses to commit. A
            // preview that ran different code would prove nothing about the
            // migration it is previewing.
            if (dryRun) throw new DryRunRollback(result);
            return result;
          });
        } catch (error) {
          if (!(error instanceof DryRunRollback)) throw error;
          loadResult = error.result;
        }

        const runReport: MigrationReport = {
          accountId: snapshot.accountId,
          subsidiaryId: snapshot.subsidiaryId,
          sandbox: snapshot.sandbox,
          counts: loadResult.counts,
          extracted: planCounts(mapped.plan),
          linked: loadResult.linked,
          warnings: loadResult.warnings,
          notes: mapped.notes,
          gaps: summarizeGaps(mapped.gaps)
        };

        await writeMigrationMarker(client, {
          companyId,
          userId,
          migrationRunId,
          patch: {
            status: "ready",
            progress: null,
            report: runReport,
            error: null
          }
        });

        return { migrationRunId, dryRun, counts: loadResult.counts };
      } catch (error) {
        // A OneWorld account with several subsidiaries needs a DECISION, not a
        // retry: the choices go on the marker so the page can render them.
        if (error instanceof SubsidiaryChoiceRequired) {
          await writeMigrationMarker(client, {
            companyId,
            userId,
            migrationRunId,
            patch: {
              status: "failed",
              progress: null,
              error: error.message,
              subsidiaryChoices: error.subsidiaries.map((subsidiary) => ({
                id: subsidiary.id,
                name: subsidiary.name,
                currencyCode: subsidiary.currencyCode
              }))
            }
          });
          throw new NonRetriableError(error.message);
        }

        await writeMigrationMarker(client, {
          companyId,
          userId,
          migrationRunId,
          patch: {
            status: "failed",
            progress: null,
            error:
              error instanceof Error ? error.message : "The migration failed"
          }
        });
        throw error;
      }
    });
  }
);

/**
 * Keep a finished migration — drop the pre-migration snapshot, then clear the
 * marker. Backs BOTH the Keep button (on `ready`) and Dismiss (on `failed`):
 * the same operation under two labels.
 */
export const netsuiteMigrationFinalizeFunction = inngest.createFunction(
  {
    id: "netsuite-migration-finalize",
    retries: 1,
    concurrency: PER_COMPANY_CONCURRENCY
  },
  { event: "carbon/netsuite-migration-finalize" },
  async ({ event, step }) => {
    const { companyId, migrationRunId } = event.data;

    return await step.run("finalize-netsuite-migration", async () => {
      const client = getCarbonServiceRole();
      const marker = await readMigrationMarker(client, companyId);
      if (!marker) return { migrationRunId, resolved: false };

      const { status, snapshotPath } = marker.metadata;
      if (status !== "ready" && status !== "failed") {
        throw new NonRetriableError(
          `Cannot resolve a NetSuite migration that is ${status}`
        );
      }

      if (snapshotPath) {
        await removeStoragePrefix(client, companyId, backupDir(snapshotPath));
      }
      await clearMigrationMarker(client, companyId);

      return { migrationRunId, resolved: true };
    });
  }
);

/**
 * Undo a migration by reloading the pre-migration snapshot.
 *
 * On failure the snapshot stays on the marker so the revert can be retried — a
 * bare row-delete from app code would strand the only copy of the company's
 * pre-migration data in the bucket with nothing pointing at it.
 */
export const netsuiteMigrationRevertFunction = inngest.createFunction(
  {
    id: "netsuite-migration-revert",
    retries: 1,
    concurrency: PER_COMPANY_CONCURRENCY
  },
  { event: "carbon/netsuite-migration-revert" },
  async ({ event, step, logger }) => {
    const { companyId, userId, migrationRunId } = event.data;

    return await step.run("revert-netsuite-migration", async () => {
      const client = getCarbonServiceRole();
      const marker = await readMigrationMarker(client, companyId);
      const snapshotPath = marker?.metadata.snapshotPath;

      if (!snapshotPath) {
        // Deliberately not a silent no-op: the user pressed Revert and is owed
        // an answer about why nothing happened.
        logger.error("No snapshot to revert to", { companyId, migrationRunId });
        await writeMigrationMarker(client, {
          companyId,
          userId,
          migrationRunId,
          patch: {
            status: "failed",
            progress: null,
            error:
              "No snapshot was recorded for this run, so it cannot be reverted."
          }
        });
        return { migrationRunId, reverted: false };
      }

      await writeMigrationMarker(client, {
        companyId,
        userId,
        migrationRunId,
        patch: {
          status: "reverting",
          startedAt: datetime.timestamp(),
          progress: null
        }
      });

      const db = getJobDatabaseClient(2);
      const report = makeProgressReporter(client, {
        companyId,
        userId,
        migrationRunId
      });

      try {
        const rawSnapshot = await readBackup(client, companyId, snapshotPath);
        const { targetGroupId } = await resolveRestoreScope(client, companyId);
        const catalog = await getCompanyTableCatalog(db);
        // The snapshot predates any migration that has run since it was taken.
        const snapshot = applyTableRenames(catalog, rawSnapshot);

        const { rows, idRewrite } = await wipeAndLoad(db, catalog, snapshot, {
          companyId,
          userId: "",
          remap: false,
          includeGroup: marker?.metadata.includeGroup ?? false,
          targetGroupId,
          onProgress: report
        });

        await report({ phase: "files", done: 0, total: 1 });
        await restoreAssetsFromBackup(client, {
          files: snapshot.manifest.storage,
          srcBucket: companyId,
          srcPrefix: backupAssetsDir(snapshotPath),
          sourceCompanyId: companyId,
          companyId,
          idRewrite
        });

        await removeStoragePrefix(client, companyId, backupDir(snapshotPath));
        await clearMigrationMarker(client, companyId);

        return { migrationRunId, reverted: true, rows };
      } catch (error) {
        await writeMigrationMarker(client, {
          companyId,
          userId,
          migrationRunId,
          patch: {
            status: "failed",
            progress: null,
            error: `Revert failed: ${error instanceof Error ? error.message : "unknown error"}`
          }
        });
        throw error;
      }
    });
  }
);
