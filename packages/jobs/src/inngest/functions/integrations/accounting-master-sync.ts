/**
 * One-shot master-data sync — customers, vendors and items, in either
 * direction, for any accounting provider.
 *
 * Replaces two jobs that were mirror images of each other:
 *
 * - `accounting-backfill` pushed unmapped Carbon records out. It also carried a
 *   journal-disposition phase (now `accounting-journal-backfill`) and two PULL
 *   phases that could never run — they gated on the entity's configured
 *   `direction`, and all three providers force master data to
 *   `push-to-accounting` / `owner: "carbon"`, so `shouldPull` was always false.
 * - `rillet-import-contacts` pulled remote contacts in. It existed precisely
 *   BECAUSE that direction gate made the backfill's pull unreachable, so it
 *   enqueued `pull-from-accounting` operations explicitly — the same override
 *   the inbound webhook path uses.
 *
 * That override is why `direction` is a payload field rather than something
 * read from the sync config: a pull here is a person saying "import what is
 * already there", not the automatic direction. `owner: "carbon"` still protects
 * a linked record — `pullBatchFromAccounting` skips it — so re-running is safe.
 *
 * What the pull is FOR is the mapping row. Once a Carbon customer is linked to
 * a remote one, `upsertRemote` resolves that mapping before writing, so an
 * invoice raised later updates the original remote record instead of creating a
 * second one.
 *
 * Provider-agnostic by construction: enumeration goes through
 * `provider.listRemoteEntityIds` (declared via `capabilities.importableEntities`)
 * and pushes through the shared mapping service, so adding a provider needs no
 * edit here.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import {
  type AccountingProvider,
  createMappingService,
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  providerSupportsMasterDataImport,
  type SyncContext,
  type SyncDirection
} from "@carbon/ee/accounting";
import { getLogger } from "@carbon/logger";
import { chunkArray } from "@carbon/utils";
import { PostgresDriver } from "kysely";
import z from "zod";
import { inngest } from "../../client";
import {
  drainSyncOperations,
  enqueueSyncOperations,
  getSyncOperationActor,
  type SyncOperationRequest
} from "./accounting-sync-operations";
import {
  MASTER_DATA_TABLES,
  type MasterDataEntityType
} from "./master-data-targets";

const log = getLogger("jobs", "accounting-master-sync");

const MasterSyncPayloadSchema = z.object({
  companyId: z.string(),
  provider: z.nativeEnum(ProviderID),
  /**
   * `push-to-accounting` sends unmapped Carbon records out (the old Xero
   * backfill); `pull-from-accounting` imports what the provider already has
   * (the old Rillet contact import).
   */
  direction: z.enum(["push-to-accounting", "pull-from-accounting"]),
  batchSize: z.number().default(25),
  entityTypes: z
    .object({
      customers: z.boolean().default(true),
      vendors: z.boolean().default(true),
      items: z.boolean().default(true)
    })
    .prefault({})
});

export type AccountingMasterSyncPayload = z.input<
  typeof MasterSyncPayloadSchema
>;

/**
 * Bound on the per-entity batch loop. A push batch that keeps finding unmapped
 * rows would otherwise loop for as long as the provider keeps failing them;
 * stopping is recoverable (re-run the action), spinning is not.
 */
const MAX_BATCHES_PER_ENTITY = 200;

/** Payload selector → the entity type it selects. */
const ENTITY_SELECTORS = [
  { selector: "customers", entityType: "customer" },
  { selector: "vendors", entityType: "vendor" },
  { selector: "items", entityType: "item" }
] as const satisfies readonly {
  selector: "customers" | "vendors" | "items";
  entityType: MasterDataEntityType;
}[];

type EntityCounts = {
  succeeded: number;
  skipped: number;
  failed: number;
  /** Set when the entity was not attempted at all, and why. */
  notAttempted?: string;
};

const emptyCounts = (): EntityCounts => ({
  succeeded: 0,
  skipped: 0,
  failed: 0
});

function shouldPush(direction: SyncDirection): boolean {
  return direction === "push-to-accounting" || direction === "two-way";
}

export const accountingMasterSyncFunction = inngest.createFunction(
  {
    id: "accounting-master-sync",
    retries: 3,
    // One per company at a time: two concurrent runs would race on the
    // syncers' name-match ladder and could insert the same record twice.
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/accounting-master-sync" },
  async ({ event, step, runId }) => {
    const payload = MasterSyncPayloadSchema.parse(event.data);

    // Scopes the ledger idempotency keys to this run: a retried step
    // re-enqueues onto its own rows, while a fresh run is never blocked by the
    // Completed rows of the last one.
    const runScope = event.id ?? runId;

    // ONE client / integration / provider for the whole run, reused across the
    // listing step and every batch. Providers memoize their remote lists, and
    // some have no get-many endpoint, so sharing the instance means the full
    // drain per entity type runs once rather than once per batch. On an Inngest
    // replay the listing step is skipped and this provider is fresh, so the
    // first re-executing batch re-lists once — bounded, never per-batch.
    // (Built outside step.run: it is a cheap local plus one companyIntegration
    // read, safe to repeat on replay.)
    const client = getCarbonServiceRole();
    const integration = await getAccountingIntegration(
      client,
      payload.companyId,
      payload.provider
    );
    const provider = getProviderIntegration(
      client,
      payload.companyId,
      integration.id,
      integration.metadata
    ) as AccountingProvider;
    const database = getPostgresClient(
      getPostgresConnectionPool(5),
      PostgresDriver
    );

    const createdBy = getSyncOperationActor(integration);
    const result: Record<string, EntityCounts> = {};

    for (const { selector, entityType } of ENTITY_SELECTORS) {
      if (!payload.entityTypes[selector]) continue;

      const counts = emptyCounts();
      result[entityType] = counts;

      const runBatch = (stepId: string, requests: SyncOperationRequest[]) =>
        step.run(stepId, () =>
          syncBatch({
            client,
            database,
            provider,
            integrationMetadata: integration.metadata,
            companyId: payload.companyId,
            integrationId: payload.provider,
            createdBy,
            scope: runScope,
            entityType,
            direction: payload.direction,
            requests
          })
        );

      if (payload.direction === "pull-from-accounting") {
        if (!providerSupportsMasterDataImport(provider, entityType)) {
          // Explicit rather than silently importing nothing: "this provider
          // cannot enumerate vendors" and "this provider has no vendors" are
          // very different answers to give someone who clicked Import.
          counts.notAttempted = `${payload.provider} cannot enumerate ${entityType} records`;
          continue;
        }

        const remoteIds = await step.run(`list-${entityType}`, () =>
          provider.listRemoteEntityIds(entityType)
        );

        for (const [index, batch] of chunkArray(
          remoteIds,
          payload.batchSize
        ).entries()) {
          const batchCounts = await runBatch(
            `pull-${entityType}-batch-${index}`,
            batch.map((remoteId) => ({
              entityType,
              entityId: remoteId,
              direction: "pull-from-accounting" as const
            }))
          );
          counts.succeeded += batchCounts.succeeded;
          counts.skipped += batchCounts.skipped;
          counts.failed += batchCounts.failed;
        }

        continue;
      }

      // push-to-accounting — unlike pull, this DOES respect the configured
      // direction. A person asking to import is overriding the automatic
      // direction on purpose; a person asking to push is asking for the
      // automatic direction to catch up, so an entity configured pull-only
      // must stay pull-only.
      const entityConfig = provider.getSyncConfig(entityType);
      if (!entityConfig?.enabled || !shouldPush(entityConfig.direction)) {
        counts.notAttempted = entityConfig?.enabled
          ? `${entityType} is configured ${entityConfig.direction}`
          : `${entityType} sync is disabled`;
        continue;
      }

      for (let index = 0; index < MAX_BATCHES_PER_ENTITY; index++) {
        const unmappedIds = await step.run(
          `unmapped-${entityType}-${index}`,
          () =>
            createMappingService(
              database,
              payload.companyId
            ).getUnsyncedEntityIds(
              entityType,
              MASTER_DATA_TABLES[entityType],
              payload.provider,
              payload.batchSize
            )
        );

        if (unmappedIds.length === 0) break;

        const batchCounts = await runBatch(
          `push-${entityType}-batch-${index}`,
          unmappedIds.map((entityId) => ({
            entityType,
            entityId,
            direction: "push-to-accounting" as const
          }))
        );

        counts.succeeded += batchCounts.succeeded;
        counts.skipped += batchCounts.skipped;
        counts.failed += batchCounts.failed;

        // A failed push leaves the record unmapped, so it comes straight back
        // from getUnsyncedEntityIds. Its idempotency key (same run scope)
        // absorbs the re-enqueue, so the drain claims nothing — which is the
        // signal that the loop is no longer making progress.
        if (
          unmappedIds.length < payload.batchSize ||
          batchCounts.claimed === 0
        ) {
          break;
        }

        await step.sleep(`push-${entityType}-delay-${index}`, "2s");
      }
    }

    log.info("Master data sync complete", {
      companyId: payload.companyId,
      provider: payload.provider,
      direction: payload.direction,
      result
    });

    return {
      companyId: payload.companyId,
      provider: payload.provider,
      direction: payload.direction,
      entities: result
    };
  }
);

/**
 * Enqueue one batch of ledger operations and drain them.
 *
 * A drain failure lands Failed ledger rows — visible and retryable in Sync
 * Activity — rather than throwing, so one unmappable record cannot abandon the
 * rest of the run. A `RatelimitError` is the exception: it propagates out of
 * the step so Inngest retries with backoff, and the idempotency keys absorb the
 * re-enqueue.
 *
 * The job this push path came from wrapped its drain in a `withRateLimitRetry`
 * helper that awaited `step.sleep` from INSIDE a `step.run` — a nested-step
 * violation. Letting the error reach Inngest is both correct and what the pull
 * path already did.
 */
async function syncBatch(args: {
  client: ReturnType<typeof getCarbonServiceRole>;
  database: SyncContext["database"];
  provider: AccountingProvider;
  integrationMetadata: Awaited<
    ReturnType<typeof getAccountingIntegration>
  >["metadata"];
  companyId: string;
  integrationId: string;
  createdBy: string;
  scope: string;
  entityType: MasterDataEntityType;
  direction: "push-to-accounting" | "pull-from-accounting";
  requests: SyncOperationRequest[];
}): Promise<EntityCounts & { claimed: number }> {
  const counts = { ...emptyCounts(), claimed: 0 };
  if (args.requests.length === 0) return counts;

  const outcomes = await enqueueSyncOperations(args.client, {
    companyId: args.companyId,
    integration: args.integrationId,
    trigger: "backfill",
    createdBy: args.createdBy,
    scope: args.scope,
    requests: args.requests
  });

  for (const outcome of outcomes) {
    if (outcome.outcome !== "error") continue;
    counts.failed++;
    log.error("Failed to enqueue a master-data sync operation", {
      companyId: args.companyId,
      entityType: outcome.entityType,
      entityId: outcome.entityId,
      error: outcome.error
    });
  }

  const drained = await drainSyncOperations({
    client: args.client,
    database: args.database,
    companyId: args.companyId,
    integration: args.integrationId,
    provider: args.provider,
    integrationMetadata: args.integrationMetadata
  });

  counts.claimed = drained.claimed;

  // A drain processes every claimable operation for the company, not just this
  // batch's. Attributing its result to THIS batch is correct only because
  // `concurrency: { limit: 1 }` plus the sequential batch loop mean earlier
  // batches are already Completed (never re-claimed) and later ones are not
  // enqueued yet — so the only ops in flight for this (direction, entityType)
  // are the ones just enqueued. The filters guard against unrelated ops the
  // drain also picks up. Revisit if either invariant changes.
  for (const group of drained.groups) {
    if (group.direction !== args.direction) continue;
    if (group.entityType !== args.entityType) continue;
    counts.succeeded += group.result.successCount;
    counts.skipped += group.result.skippedCount;
    counts.failed += group.result.errorCount;
  }

  return counts;
}
