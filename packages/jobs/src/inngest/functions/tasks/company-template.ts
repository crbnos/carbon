import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyTimeZone } from "@carbon/database";
import { getPostgresConnectionPool } from "@carbon/database/client";
import { applyDataset, getDataset } from "@carbon/database/datasets";
import { datetime } from "@carbon/utils";
import { NonRetriableError } from "inngest";
import { getJobDatabaseClient } from "../../../db";
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

export const TEMPLATE_INTEGRATION = "company-template";

// Apply, finalize and revert all take this, so the three can never run
// concurrently for one company — each assumes the marker is its own.
const PER_COMPANY_CONCURRENCY = {
  key: "'company-template-' + event.data.companyId",
  scope: "env",
  limit: 1
} as const;

type ServiceRole = ReturnType<typeof getCarbonServiceRole>;

type TemplateStatus = "running" | "ready" | "failed" | "reverting";

type TemplateMeta = {
  templateRunId: string;
  status: TemplateStatus;
  datasetKey?: string;
  startedAt?: string;
  error?: string | null;
  /** Folder name of the pre-apply snapshot in this company's bucket. */
  snapshotPath?: string;
  /** Scope the forward apply covered, so a revert undoes exactly that. */
  includeGroup?: boolean;
  /** Live phase progress, so a run that takes minutes doesn't look hung. */
  progress?: JobProgress | null;
};

/**
 * One marker row per company, mirroring company-export. The partial unique index
 * on ("integration","externalId","entityType","companyId") means a second row for
 * the same company is rejected outright, so identity lives in the metadata's
 * templateRunId rather than in externalId.
 */
async function readTemplateMarker(
  client: ServiceRole,
  companyId: string
): Promise<{ id: string; metadata: TemplateMeta } | null> {
  const marker = await client
    .from("externalIntegrationMapping")
    .select("id, metadata")
    .eq("integration", TEMPLATE_INTEGRATION)
    .eq("companyId", companyId)
    .maybeSingle();
  if (marker.error) {
    throw new Error(`Failed to read template marker: ${marker.error.message}`);
  }
  if (!marker.data) return null;
  return {
    id: marker.data.id,
    metadata: (marker.data.metadata ?? {}) as TemplateMeta
  };
}

/**
 * Upsert the template marker, merging `patch` into its metadata.
 *
 * On the legacy fire-and-forget path (no snapshot) the marker is cleared on
 * success — a company holding a `failed` marker is the signal that its demo data
 * never landed, which an empty company alone cannot tell you. On the snapshot
 * path it instead settles on `ready` and HOLDS the snapshot path until the user
 * keeps or reverts; clearing it there would strand the snapshot with nothing
 * pointing at it. Errors throw: a marker that silently failed to write is worse
 * than none, because the contract reads a missing marker as "the job never ran".
 */
async function writeTemplateMarker(
  client: ServiceRole,
  args: {
    companyId: string;
    userId: string;
    templateRunId: string;
    patch: Partial<TemplateMeta>;
  }
): Promise<void> {
  const { companyId, userId, templateRunId, patch } = args;
  const existing = await readTemplateMarker(client, companyId);
  const metadata: TemplateMeta = {
    status: "running",
    ...existing?.metadata,
    ...patch,
    // LAST, unlike company-restore's copy of this: readRestoreMarker filters by
    // restoreRunId so its stored id can never differ, but readTemplateMarker
    // looks up by companyId alone. Merged earlier, a previous failed run's id
    // would shadow this one's and the Keep/Revert buttons would post it.
    templateRunId
  };

  const written = existing
    ? await client
        .from("externalIntegrationMapping")
        .update({ metadata })
        .eq("id", existing.id)
        .eq("companyId", companyId)
    : await client.from("externalIntegrationMapping").insert({
        entityType: "template",
        entityId: companyId,
        integration: TEMPLATE_INTEGRATION,
        externalId: "",
        metadata,
        companyId,
        createdBy: userId
      });

  if (written.error) {
    throw new Error(
      `Failed to write template marker: ${written.error.message}`
    );
  }
}

/**
 * Throttled progress writer. Both the apply and the revert run as ONE durable
 * step, so this marker is the only thing the page can read while they work.
 */
function makeProgressReporter(
  client: ServiceRole,
  args: { companyId: string; userId: string; templateRunId: string }
): (p: JobProgress) => Promise<void> {
  return throttleProgress((progress) =>
    writeTemplateMarker(client, { ...args, patch: { progress } })
  );
}

async function clearTemplateMarker(
  client: ServiceRole,
  companyId: string
): Promise<void> {
  const cleared = await client
    .from("externalIntegrationMapping")
    .delete()
    .eq("integration", TEMPLATE_INTEGRATION)
    .eq("companyId", companyId);
  if (cleared.error) {
    throw new Error(
      `Failed to clear template marker: ${cleared.error.message}`
    );
  }
}

export const companyTemplateFunction = inngest.createFunction(
  {
    id: "company-template",
    retries: 1,
    // The unkeyed limit stops N companies onboarding together from outnumbering
    // the pool below — each run holds one of its two connections for a whole
    // transaction.
    concurrency: [{ limit: 2 }, PER_COMPANY_CONCURRENCY]
  },
  { event: "carbon/company-template" },
  async ({ event, step, logger }) => {
    const {
      companyId,
      userId,
      datasetKey,
      templateRunId,
      snapshot: takeSnapshot = false
    } = event.data;

    return await step.run("apply-template", async () => {
      const client = getCarbonServiceRole();

      const dataset = getDataset(datasetKey);
      if (!dataset) {
        const error = `Unknown dataset "${datasetKey}"`;
        await writeTemplateMarker(client, {
          companyId,
          userId,
          templateRunId,
          patch: { status: "failed", datasetKey, error }
        });
        // Retrying an unknown key can never succeed.
        throw new NonRetriableError(error);
      }

      // A pending keep/revert owns the only snapshot of the user's real data.
      // Applying again would overwrite it, so refuse until it is resolved. A
      // marker naming THIS run is a retry of it, not a second apply.
      const existing = await readTemplateMarker(client, companyId);
      if (
        existing &&
        existing.metadata.templateRunId !== templateRunId &&
        existing.metadata.status !== "failed"
      ) {
        throw new NonRetriableError(
          "A demo data change is already pending — keep or revert it first."
        );
      }

      await writeTemplateMarker(client, {
        companyId,
        userId,
        templateRunId,
        patch: {
          status: "running",
          datasetKey,
          startedAt: datetime.timestamp(),
          // A retry, or a new run after a failed one, inherits that marker's error.
          error: null
        }
      });

      const report = makeProgressReporter(client, {
        companyId,
        userId,
        templateRunId
      });

      // Everything past the `running` marker must be able to reach the failure
      // marker. getCompanyTimeZone throws on a read error and pool.connect()
      // throws on its 10s acquisition timeout — outside this try, either would
      // leave the marker stuck on `running` forever. The snapshot is inside for
      // the same reason.
      const pool = getPostgresConnectionPool(2);
      let pgClient: Parameters<typeof applyDataset>[0] | null = null;
      try {
        let snapshotPath = existing?.metadata.snapshotPath ?? undefined;
        if (takeSnapshot && !snapshotPath) {
          // IDEMPOTENT: a prior attempt's snapshot is reused, never retaken — a
          // retry after the apply committed would otherwise capture the SEEDED
          // state and overwrite the user's real pre-apply copy.
          const db = getJobDatabaseClient(1);
          const { includeGroup } = await resolveRestoreScope(client, companyId);
          snapshotPath = `_pre-template-${templateRunId}`;
          const snap = await buildCompanyBackup(client, db, {
            companyId,
            userId,
            label: `Pre-template ${templateRunId}`,
            includeStorage: "all",
            name: snapshotPath,
            onProgress: (p) => report({ ...p, phase: "snapshot" })
          });
          await writeBackupManifest(
            client,
            companyId,
            snapshotPath,
            snap.manifest
          );
          await writeTemplateMarker(client, {
            companyId,
            userId,
            templateRunId,
            patch: { snapshotPath, includeGroup }
          });
        }

        const timeZone = await getCompanyTimeZone(client, companyId);

        // A dedicated pool: applyDataset holds one connection for the whole
        // transaction, and the shared size-1 pool behind getJobDatabaseClient is
        // what the event drainer and workflow matcher run on.
        pgClient = await pool.connect();
        await applyDataset(pgClient, {
          companyId,
          userId,
          dataset,
          timeZone,
          // Tied to takeSnapshot deliberately: wiping without a snapshot would
          // be unrecoverable, so the two are never allowed to diverge.
          wipeFirst: takeSnapshot,
          log: (message) => logger.info(message, { companyId, templateRunId }),
          // Safe inside applyDataset's open transaction: the marker write goes
          // over supabase-js (its own connection), never `pgClient`.
          onProgress: (p) => report({ ...p, phase: "seed" })
        });
      } catch (err) {
        await writeTemplateMarker(client, {
          companyId,
          userId,
          templateRunId,
          patch: {
            status: "failed",
            datasetKey,
            progress: null,
            error: (err as Error).message
          }
        });
        throw err;
      } finally {
        pgClient?.release();
      }

      if (takeSnapshot) {
        // Parked on keep/revert — the marker holds the snapshot until the user
        // decides.
        await writeTemplateMarker(client, {
          companyId,
          userId,
          templateRunId,
          patch: { status: "ready", progress: null }
        });
      } else {
        // The data landing IS the success signal; a lingering marker would read
        // as an unfinished run.
        await clearTemplateMarker(client, companyId);
      }

      return { templateRunId, datasetKey };
    });
  }
);

/**
 * Resolve an applied demo template — delete the pre-apply snapshot, then the
 * marker. Backs BOTH buttons: "Keep" on a `ready` run and "Dismiss" on a `failed`
 * one. They are the same operation, and routing them here rather than deleting
 * the row from the app is what keeps the snapshot folder from being orphaned:
 * a `failed` revert deliberately leaves `snapshotPath` set so the user can retry,
 * so a bare row-delete would strand the only copy of their pre-apply data.
 */
export const companyTemplateFinalizeFunction = inngest.createFunction(
  {
    id: "company-template-finalize",
    retries: 1,
    concurrency: PER_COMPANY_CONCURRENCY
  },
  { event: "carbon/company-template-finalize" },
  async ({ event, step, logger }) => {
    const { companyId, templateRunId } = event.data;

    return await step.run("finalize-template", async () => {
      const client = getCarbonServiceRole();
      const marker = await readTemplateMarker(client, companyId);
      if (!marker) return { templateRunId, resolved: false };

      // Only a settled run can be resolved. The shared concurrency key already
      // serialises the three functions, but an apply is enqueued rather than
      // held, so a mistimed request could still arrive mid-run and delete the
      // marker out from under it.
      const { status } = marker.metadata;
      if (status !== "ready" && status !== "failed") {
        throw new NonRetriableError(
          `Cannot resolve a demo template that is ${status}`
        );
      }

      const snapshotPath = marker.metadata.snapshotPath;
      if (snapshotPath) {
        await removeStoragePrefix(client, companyId, backupDir(snapshotPath));
      }
      await clearTemplateMarker(client, companyId);

      logger.info("Demo template resolved", {
        companyId,
        templateRunId,
        status
      });
      return { templateRunId, resolved: true };
    });
  }
);

/** Undo an applied demo template — wipe again and reload the pre-apply snapshot. */
export const companyTemplateRevertFunction = inngest.createFunction(
  {
    id: "company-template-revert",
    retries: 1,
    concurrency: PER_COMPANY_CONCURRENCY
  },
  { event: "carbon/company-template-revert" },
  async ({ event, step, logger }) => {
    const { companyId, userId, templateRunId } = event.data;

    return await step.run("revert-template", async () => {
      const client = getCarbonServiceRole();
      const db = getJobDatabaseClient(1);

      const marker = await readTemplateMarker(client, companyId);
      const snapshotPath = marker?.metadata.snapshotPath;
      if (!snapshotPath) {
        // Settle as failed rather than returning quietly: the marker is what
        // blocks a new apply, so a silent no-op leaves the user with a Revert
        // button that does nothing and no way forward. Failed offers Dismiss.
        logger.error("Nothing to revert — no snapshot on marker", {
          companyId,
          templateRunId
        });
        if (marker) {
          await writeTemplateMarker(client, {
            companyId,
            userId,
            templateRunId,
            patch: {
              status: "failed",
              progress: null,
              error:
                "No snapshot was recorded for this run, so it cannot be reverted."
            }
          });
        }
        return { templateRunId, reverted: false };
      }

      // Flag the run as reverting so the page can show it is in flight.
      await writeTemplateMarker(client, {
        companyId,
        userId,
        templateRunId,
        patch: {
          status: "reverting",
          startedAt: datetime.timestamp(),
          progress: null
        }
      });
      const report = makeProgressReporter(client, {
        companyId,
        userId,
        templateRunId
      });

      try {
        // The snapshot is THIS company's own pre-apply data — ids and scope
        // already belong here, so it loads verbatim (no remap). Wipe + reload the
        // SAME scope the forward apply covered so the undo is exact. Note this is
        // the restore engine's tabula-rasa wipe, not the dataset wipe the forward
        // apply used: the snapshot carries the config back, so nothing is kept.
        const snapshot = await readBackup(client, companyId, snapshotPath);
        const { targetGroupId } = await resolveRestoreScope(client, companyId);
        const catalog = await getCompanyTableCatalog(db);
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
        await clearTemplateMarker(client, companyId);

        logger.info("Demo template reverted", {
          companyId,
          templateRunId,
          rows
        });
        return { templateRunId, reverted: true, rows };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Leave the marker (with the snapshot still set) so the user can retry
        // the revert; surface the failure.
        await writeTemplateMarker(client, {
          companyId,
          userId,
          templateRunId,
          patch: {
            status: "failed",
            progress: null,
            error: `Revert failed: ${message}`
          }
        });
        logger.error("Demo template revert failed", {
          companyId,
          templateRunId,
          error: message
        });
        throw err;
      }
    });
  }
);
