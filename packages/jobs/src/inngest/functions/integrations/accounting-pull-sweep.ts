/**
 * Generic accounting pull sweep — the correctness guarantee behind every
 * provider's inbound sync (webhooks, where a provider supports them, are
 * only a latency optimization: deliveries can be missed, disabled after
 * repeated failures, or unreachable for firewalled self-hosted instances).
 *
 * Every 30 minutes, per company with an ACTIVE accounting integration
 * whose provider implements SupportsIncrementalPull (QBO wraps Intuit's
 * Change Data Capture; Rillet lists changed invoice payments; Xero has no
 * implementation yet and is skipped):
 *
 * 1. Resolve the cursor from `metadata.settings.pullCursor`; default = the
 *    integration row's `updatedAt` (at-or-after install, so pre-connect
 *    history is never pulled). Providers with a capped change feed
 *    (`pullLookbackDays`) get older cursors clamped and noted.
 * 2. provider.listChanges({ since }) → normalized ProviderChange rows. The
 *    provider filters internally to entities whose resolved sync config
 *    allows pull.
 * 3. Dependency filter: changes carrying `dependsOnMapping` are dropped
 *    (without a ledger row) when the named mapping is absent locally —
 *    the ownership filter for providers whose organization is shared by
 *    several Carbon instances (e.g. Rillet payments on another
 *    subsidiary's invoices).
 * 4. `deleted` stubs are logged and skipped (DELETE sync is deliberately
 *    unimplemented, house rule); everything else enqueues a
 *    pull-from-accounting ledger operation with trigger "webhook" (the
 *    established remote-change trigger) and idempotencyKey scope
 *    `pull:<updatedAt>` — stable across cron retries, so re-runs absorb
 *    into the same rows.
 * 5. Drain via the shared machinery (drainSyncOperations).
 * 6. Advance the cursor ONLY when every enqueue succeeded and the drain
 *    returned (Celigo rule: the cursor moves over provably-covered work),
 *    to max(changedSince, every updatedAt seen) — never a server time,
 *    which could outrun a lagging snapshot.
 *
 * A RatelimitError (or any throw) fails the company's step before the
 * cursor write → Inngest retries → the same window is re-fetched and
 * re-absorbed. Drain failures land Failed ledger rows (visible in Sync
 * Activity, retryable there) — they do NOT hold the cursor back; the
 * ledger row is the durable record of the change.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import {
  type AccountingEntityType,
  enqueueSyncOperation,
  findPaymentCompositesByRemoteId,
  getAccountingIntegration,
  getProviderIntegration,
  type ProviderChange,
  ProviderID,
  providerSupportsIncrementalPull,
  type SyncContext
} from "@carbon/ee/accounting";
import { chunkArray } from "@carbon/utils";
import { PostgresDriver } from "kysely";
import { inngest } from "../../client";
import {
  drainSyncOperations,
  getAdvancedPullCursor,
  getPullCursorDecision,
  getPullIdempotencyScope,
  getSyncOperationActor,
  getSyncOperationIdempotencyKey,
  mergePullCursor
} from "./accounting-sync-operations";

// Supabase caps a select at 1000 rows, and a very long .in() list can exceed
// the request URL limit — chunk the dependency-mapping lookup so neither
// truncates (matches the id-chunking in accounting-reconciliation.ts).
const DEPENDENCY_MAPPING_CHUNK_SIZE = 200;

type SweepSummary = {
  changedSince: string | null;
  clamped: boolean;
  changes: number;
  deletedSkipped: number;
  dependencySkipped: number;
  enqueued: number;
  cooldownSkipped: number;
  enqueueErrors: number;
  drain: {
    claimed: number;
    completed: number;
    failed: number;
    skipped: number;
  } | null;
  cursorAdvancedTo: string | null;
  skippedReason?: string;
};

const emptySummary = (): SweepSummary => ({
  changedSince: null,
  clamped: false,
  changes: 0,
  deletedSkipped: 0,
  dependencySkipped: 0,
  enqueued: 0,
  cooldownSkipped: 0,
  enqueueErrors: 0,
  drain: null,
  cursorAdvancedTo: null
});

/**
 * Drop changes whose dependsOnMapping is absent from
 * externalIntegrationMapping. Batched per dependency entity type; a
 * lookup failure keeps the changes (the syncer's own ownership gate skips
 * them benignly) rather than silently losing them.
 */
export async function filterChangesByDependencyMapping(
  client: ReturnType<typeof getCarbonServiceRole>,
  args: {
    companyId: string;
    integration: string;
    changes: ProviderChange[];
  }
): Promise<{ kept: ProviderChange[]; dependencySkipped: number }> {
  const dependentsByType = new Map<AccountingEntityType, Set<string>>();
  for (const change of args.changes) {
    if (!change.dependsOnMapping) continue;
    const existing = dependentsByType.get(change.dependsOnMapping.entityType);
    if (existing) {
      existing.add(change.dependsOnMapping.remoteId);
    } else {
      dependentsByType.set(
        change.dependsOnMapping.entityType,
        new Set([change.dependsOnMapping.remoteId])
      );
    }
  }

  if (dependentsByType.size === 0) {
    return { kept: args.changes, dependencySkipped: 0 };
  }

  const mappedByType = new Map<AccountingEntityType, Set<string>>();
  for (const [entityType, remoteIds] of dependentsByType) {
    const found = new Set<string>();
    let lookupFailed = false;

    for (const idChunk of chunkArray(
      [...remoteIds],
      DEPENDENCY_MAPPING_CHUNK_SIZE
    )) {
      const result = await client
        .from("externalIntegrationMapping")
        .select("externalId")
        .eq("companyId", args.companyId)
        .eq("integration", args.integration)
        .eq("entityType", entityType)
        .in("externalId", idChunk);

      if (result.error) {
        console.error(
          `[PULL SWEEP] ${args.companyId}/${args.integration}: dependency mapping lookup failed for ${entityType} (${result.error.message}); keeping ${remoteIds.size} change(s) for the syncer's ownership gate`
        );
        lookupFailed = true;
        break;
      }

      for (const row of result.data ?? []) {
        if (row.externalId) found.add(row.externalId);
      }
    }

    // On any chunk failure, fail safe: keep every dependency as present so the
    // change survives to the syncer's ownership gate (matches the pre-chunk path).
    mappedByType.set(entityType, lookupFailed ? remoteIds : found);
  }

  const kept: ProviderChange[] = [];
  let dependencySkipped = 0;
  for (const change of args.changes) {
    if (
      change.dependsOnMapping &&
      !mappedByType
        .get(change.dependsOnMapping.entityType)
        ?.has(change.dependsOnMapping.remoteId)
    ) {
      dependencySkipped++;
      continue;
    }
    kept.push(change);
  }

  return { kept, dependencySkipped };
}

async function sweepCompanyProvider(args: {
  companyId: string;
  providerId: ProviderID;
  database: SyncContext["database"];
}): Promise<SweepSummary> {
  const { companyId, providerId, database } = args;
  const client = getCarbonServiceRole();
  const summary = emptySummary();

  const integration = await getAccountingIntegration(
    client,
    companyId,
    providerId
  );

  const provider = getProviderIntegration(
    client,
    companyId,
    integration.id,
    integration.metadata
  );

  if (!providerSupportsIncrementalPull(provider)) {
    return { ...summary, skippedReason: "provider has no incremental pull" };
  }

  const cursorDecision = getPullCursorDecision({
    integrationMetadata: integration.metadata,
    integrationUpdatedAt: integration.updatedAt ?? null,
    maxLookbackDays: provider.pullLookbackDays
  });
  summary.changedSince = cursorDecision.changedSince;
  summary.clamped = cursorDecision.clamped;
  if (cursorDecision.clamped) {
    console.warn(
      `[PULL SWEEP] ${companyId}/${providerId}: cursor predates the ${provider.pullLookbackDays}-day change-feed window; clamped to ${cursorDecision.changedSince} — changes before the window are recovered by two-way owner semantics or a backfill`
    );
  }

  const listed = await provider.listChanges({
    since: cursorDecision.changedSince
  });
  summary.changes = listed.changes.length;

  const { kept, dependencySkipped } = await filterChangesByDependencyMapping(
    client,
    { companyId, integration: providerId, changes: listed.changes }
  );
  summary.dependencySkipped = dependencySkipped;

  const createdBy = getSyncOperationActor(integration);
  const updatedAts: Array<string | null> = listed.changes.map(
    (change) => change.updatedAt
  );

  // Enqueue one pull-from-accounting ledger operation, folding the result into
  // the summary. Shared by the normal change path and the deleted-payment
  // tombstone path (which fans out over resolved composite ids).
  const enqueueChange = async (
    entityType: AccountingEntityType,
    entityId: string,
    updatedAt: string | null
  ): Promise<void> => {
    const enqueued = await enqueueSyncOperation(client, {
      companyId,
      integration: providerId,
      entityType,
      entityId,
      direction: "pull-from-accounting",
      trigger: "webhook",
      idempotencyKey: getSyncOperationIdempotencyKey({
        entityType,
        entityId,
        direction: "pull-from-accounting",
        scope: getPullIdempotencyScope(updatedAt, cursorDecision.changedSince)
      }),
      createdBy
    });

    if (enqueued.error) {
      summary.enqueueErrors++;
      console.error(
        `[PULL SWEEP] ${companyId}/${providerId}: failed to enqueue ${entityType} ${entityId}: ${enqueued.error}`
      );
    } else if (enqueued.data) {
      summary.enqueued++;
    } else {
      summary.cooldownSkipped++;
    }
  };

  for (const change of kept) {
    if (change.deleted) {
      // A deleted `payment` tombstone still needs to VOID the Carbon payment:
      // resolve the composite(s) from the existing mapping (the tombstone
      // carries only the bare payment id) and enqueue the reversing pull — the
      // payment syncer maps the not-found refetch to status "void". Every other
      // deletion follows the house rule (DELETE sync unimplemented — log+skip).
      if (change.entityType === "payment") {
        const composites = await findPaymentCompositesByRemoteId(client, {
          companyId,
          integration: providerId,
          paymentRemoteId: change.remoteId
        });
        if (composites.length === 0) {
          summary.deletedSkipped++;
          console.info(
            `[PULL SWEEP] ${companyId}/${providerId}: deleted payment ${change.remoteId} has no local mapping — skipping (never synced or not ours)`
          );
          continue;
        }
        for (const composite of composites) {
          await enqueueChange("payment", composite, change.updatedAt);
        }
        continue;
      }

      summary.deletedSkipped++;
      console.info(
        `[PULL SWEEP] ${companyId}/${providerId}: skipping deleted ${change.entityType} ${change.remoteId} (remote deletions are not synced)`
      );
      continue;
    }

    await enqueueChange(change.entityType, change.remoteId, change.updatedAt);
  }

  // Drain through the shared machinery (a RatelimitError propagates so the
  // step retries; claimed rows stay In Flight and become re-claimable once
  // stale)
  const drain = await drainSyncOperations({
    client,
    database,
    companyId,
    integration: providerId,
    provider,
    integrationMetadata: integration.metadata
  });
  summary.drain = {
    claimed: drain.claimed,
    completed: drain.completed,
    failed: drain.failed,
    skipped: drain.skipped
  };

  // Celigo cursor rule: advance only over provably-covered work — every
  // change either enqueued into the ledger (drain failures are durable
  // Failed rows with UI retry, so they do not hold the cursor back) or was
  // terminally logged-and-skipped (deletions, absent dependency mappings).
  if (summary.enqueueErrors > 0) {
    console.warn(
      `[PULL SWEEP] ${companyId}/${providerId}: ${summary.enqueueErrors} enqueue error(s); holding the cursor at ${cursorDecision.changedSince} so the next run re-fetches the window`
    );
    return summary;
  }

  const nextCursor = getAdvancedPullCursor({
    changedSince: cursorDecision.changedSince,
    lastUpdatedTimes: updatedAts
  });

  // Skip the no-op write when an unclamped stored cursor saw no newer
  // changes; clamps and first runs persist so the default/clamp becomes
  // the durable cursor
  const shouldStore =
    nextCursor !== cursorDecision.changedSince ||
    cursorDecision.clamped ||
    cursorDecision.source !== "cursor";

  if (shouldStore) {
    await storePullCursor(client, {
      companyId,
      providerId,
      cursor: nextCursor
    });
    summary.cursorAdvancedTo = nextCursor;
  }

  return summary;
}

/**
 * Read-modify-write against the RAW stored metadata (not the zod-parsed
 * copy from getAccountingIntegration) so no sibling key can be clobbered —
 * same contract as the reconciliation report store.
 */
async function storePullCursor(
  client: ReturnType<typeof getCarbonServiceRole>,
  args: { companyId: string; providerId: ProviderID; cursor: string }
): Promise<void> {
  const current = await client
    .from("companyIntegration")
    .select("metadata")
    .eq("id", args.providerId)
    .eq("companyId", args.companyId)
    .single();

  if (current.error) {
    throw new Error(
      `Failed to read integration metadata: ${current.error.message}`
    );
  }

  const merged = mergePullCursor(current.data?.metadata, args.cursor);

  const updated = await client
    .from("companyIntegration")
    .update({ metadata: merged as any })
    .eq("id", args.providerId)
    .eq("companyId", args.companyId);

  if (updated.error) {
    throw new Error(`Failed to store pull cursor: ${updated.error.message}`);
  }
}

export const accountingPullSweepFunction = inngest.createFunction(
  { id: "accounting-pull-sweep", retries: 2 },
  { cron: "*/30 * * * *" }, // every 30 minutes
  async ({ step }) => {
    const client = getCarbonServiceRole();

    // Every ACTIVE accounting integration; providers without an
    // incremental pull skip cheaply inside their step
    const targets = await step.run("find-pull-sweep-targets", async () => {
      const integrations = await client
        .from("companyIntegration")
        .select("id, companyId")
        .in("id", Object.values(ProviderID))
        .eq("active", true);

      if (integrations.error) {
        throw new Error(
          `Failed to list accounting integrations: ${integrations.error.message}`
        );
      }

      return (integrations.data ?? []).map((row) => ({
        companyId: row.companyId,
        providerId: row.id as ProviderID
      }));
    });

    if (targets.length === 0) {
      return { targets: 0, results: [] };
    }

    const results: Array<
      { companyId: string; providerId: ProviderID } & SweepSummary
    > = [];

    for (const target of targets) {
      const result = await step.run(
        `sweep-${target.providerId}-${target.companyId}`,
        async () => {
          // getPostgresConnectionPool returns a process-lifetime singleton
          // (cached, shared with any other caller requesting the same size) —
          // never end it here, or a concurrent invocation queries an ended pool
          // (matches events/sync.ts).
          const pool = getPostgresConnectionPool(5);
          const database = getPostgresClient(pool, PostgresDriver);
          return await sweepCompanyProvider({
            companyId: target.companyId,
            providerId: target.providerId,
            database
          });
        }
      );

      results.push({ ...target, ...result });
    }

    return { targets: targets.length, results };
  }
);
