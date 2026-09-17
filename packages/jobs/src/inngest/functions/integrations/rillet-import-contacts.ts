/**
 * Rillet contact import — the "Import customers & vendors" action on the
 * Rillet integration settings page.
 *
 * Rillet's Customers and Vendors are pushed to, never pulled from, by the
 * automatic sync (`buildRilletSyncConfig` forces `push-to-accounting` /
 * `owner: "carbon"` for both). This job is the one place that goes the
 * other way, and only because a person asked it to: it lists the Rillet
 * organization's customers and vendors and enqueues explicit
 * `pull-from-accounting` ledger operations, which `drainSyncOperations`
 * routes to the syncers' pull path — the same direction override the
 * inbound webhook path uses.
 *
 * What the import is FOR is the mapping row. `RilletCustomerSyncer`'s
 * `upsertRemote` resolves `getRemoteId(localId)` before writing, so once a
 * Carbon customer is linked to a Rillet customer, a sales invoice raised in
 * Carbon PUTs that existing Rillet customer instead of creating a second
 * one. Same for vendors and bills.
 *
 * Re-running is safe by construction, at two levels: a record that already
 * carries a mapping is skipped by `pullBatchFromAccounting`'s
 * `owner: "carbon"` gate (Rillet never overwrites a linked Carbon record),
 * and an unlinked Rillet record resolves to an existing Carbon customer
 * through the syncer's match ladder (mapping → `carbon` external_reference
 * → unique name) rather than inserting a duplicate.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import {
  type AccountingEntityType,
  type AccountingProvider,
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  type RilletProvider,
  type SyncContext
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

/**
 * Remote ids enqueued and drained per step. Kept at the shared claim limit's
 * order of magnitude so one step is one drain pass, and small enough that a
 * step's work is re-doable if Inngest retries it.
 */
const log = getLogger("jobs", "rillet-import-contacts");

const IMPORT_BATCH_SIZE = 50;

const ImportPayloadSchema = z.object({
  companyId: z.string(),
  entityTypes: z
    .object({
      customers: z.boolean().default(true),
      vendors: z.boolean().default(true)
    })
    .prefault({})
});

export type RilletImportContactsPayload = z.input<typeof ImportPayloadSchema>;

type ImportedCounts = { imported: number; skipped: number; failed: number };

const emptyCounts = (): ImportedCounts => ({
  imported: 0,
  skipped: 0,
  failed: 0
});

export const rilletImportContactsFunction = inngest.createFunction(
  {
    id: "rillet-import-contacts",
    retries: 3,
    // One import per company at a time: two concurrent runs would race on
    // the same name-match ladder and could insert the same customer twice.
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/rillet-import-contacts" },
  async ({ event, step, runId }) => {
    const payload = ImportPayloadSchema.parse(event.data);

    // Scopes the ledger idempotency keys to this run: a retried step
    // re-enqueues onto its own rows, while a fresh import is never blocked
    // by the Completed rows of the last one.
    const importRunId = event.id ?? runId;

    const result = {
      customers: emptyCounts(),
      vendors: emptyCounts()
    };

    // ONE client / integration / provider for the whole import, reused across
    // the id-listing step and every batch. The provider memoizes
    // listCustomers/listVendors, and Rillet has no get-many endpoint, so
    // sharing the instance means the full cursor drain per entity type runs
    // ONCE (in the list step) and every batch's fetchRemoteBatch reads that
    // cached list — instead of re-scanning /customers per 50-id batch. On an
    // Inngest replay the list step is skipped and this provider is fresh, so
    // the first re-executing batch re-lists once; still bounded, never
    // per-batch. (Created outside step.run because provider construction is a
    // cheap local + one companyIntegration read, safe to repeat on replay.)
    const client = getCarbonServiceRole();
    const integration = await getAccountingIntegration(
      client,
      payload.companyId,
      ProviderID.RILLET
    );
    const provider = getProviderIntegration(
      client,
      payload.companyId,
      integration.id,
      integration.metadata
    ) as RilletProvider;
    const database = getPostgresClient(
      getPostgresConnectionPool(5),
      PostgresDriver
    );

    // List both families up front, in ONE step. Rillet cursors expire after
    // 2 hours and are never resumed across runs, so the list is a single pass.
    const listed = await step.run("list-rillet-contacts", async () => {
      const customers = payload.entityTypes.customers
        ? (await provider.listCustomers()).map((customer) => customer.id)
        : [];
      const vendors = payload.entityTypes.vendors
        ? (await provider.listVendors()).map((vendor) => vendor.id)
        : [];

      return { customers, vendors };
    });

    for (const [entityType, remoteIds] of [
      ["customer", listed.customers],
      ["vendor", listed.vendors]
    ] as const) {
      const batches = chunkArray(remoteIds, IMPORT_BATCH_SIZE);

      for (const [index, batch] of batches.entries()) {
        const counts = await step.run(
          `import-${entityType}-batch-${index}`,
          () =>
            importBatch({
              client,
              integration,
              provider,
              database,
              companyId: payload.companyId,
              entityType,
              remoteIds: batch,
              scope: importRunId
            })
        );

        const target = entityType === "customer" ? "customers" : "vendors";
        result[target].imported += counts.imported;
        result[target].skipped += counts.skipped;
        result[target].failed += counts.failed;
      }
    }

    return {
      companyId: payload.companyId,
      listed: {
        customers: listed.customers.length,
        vendors: listed.vendors.length
      },
      ...result
    };
  }
);

/**
 * Enqueue one batch of remote ids as `pull-from-accounting` operations and
 * drain them, using the import's shared client / integration / provider / db
 * (see the function body for why they are shared). A drain failure lands
 * Failed ledger rows (visible and retryable in Sync Activity) rather than
 * throwing, so one unmappable Rillet record cannot abandon the rest of the
 * import — except a RatelimitError, which propagates so Inngest retries the
 * step and the idempotency keys absorb the re-enqueue.
 */
async function importBatch(args: {
  client: ReturnType<typeof getCarbonServiceRole>;
  integration: Awaited<ReturnType<typeof getAccountingIntegration>>;
  provider: AccountingProvider;
  database: SyncContext["database"];
  companyId: string;
  entityType: AccountingEntityType;
  remoteIds: string[];
  scope: string;
}): Promise<ImportedCounts> {
  const {
    client,
    integration,
    provider,
    database,
    companyId,
    entityType,
    remoteIds,
    scope
  } = args;
  const counts = emptyCounts();
  if (remoteIds.length === 0) return counts;

  // enqueueSyncOperations derives the idempotency key from
  // (entityType, entityId, direction, scope) itself.
  const requests: SyncOperationRequest[] = remoteIds.map((remoteId) => ({
    entityType,
    entityId: remoteId,
    direction: "pull-from-accounting"
  }));

  const outcomes = await enqueueSyncOperations(client, {
    companyId,
    integration: ProviderID.RILLET,
    trigger: "backfill",
    createdBy: getSyncOperationActor(integration),
    scope,
    requests
  });

  for (const outcome of outcomes) {
    if (outcome.outcome === "error") {
      counts.failed++;
      log.error("Failed to enqueue a contact import operation", {
        companyId,
        entityType: outcome.entityType,
        entityId: outcome.entityId,
        error: outcome.error
      });
    }
  }

  const drained = await drainSyncOperations({
    client,
    database,
    companyId,
    integration: ProviderID.RILLET,
    provider,
    integrationMetadata: integration.metadata
  });

  // A drain processes every claimable op for the company, not just this
  // batch's. Attributing its result to THIS batch is correct only because
  // `concurrency: { limit: 1 }` + the sequential batch loop mean earlier
  // batches are already Completed (never re-claimed) and later ones are not
  // enqueued yet — so the only pull-from-accounting/`entityType` ops in flight
  // are the ones this batch just enqueued. The filters guard against unrelated
  // push ops the drain also picks up. Revisit if either invariant changes.
  for (const group of drained.groups) {
    if (group.direction !== "pull-from-accounting") continue;
    if (group.entityType !== entityType) continue;
    counts.imported += group.result.successCount;
    counts.skipped += group.result.skippedCount;
    counts.failed += group.result.errorCount;
  }

  return counts;
}
