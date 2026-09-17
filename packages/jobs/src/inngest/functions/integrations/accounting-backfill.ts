/**
 * Backfill function for syncing entities between Carbon and accounting providers.
 *
 * This function respects the per-entity sync direction configuration:
 * - "pull-from-accounting": Only pull entities from the provider
 * - "push-to-accounting": Only push Carbon entities to the provider
 * - "two-way": Pull from provider AND push unsynced Carbon entities
 *
 * This prevents unnecessary syncing (e.g., items configured as push-only
 * won't be pulled from Xero, and POs configured as push-only won't try to pull).
 *
 * Each page/batch routes through the "accountingSyncOperation" ledger with
 * trigger "backfill": operations are enqueued with keys scoped to this run
 * (retried steps are absorbed; completed rows from earlier runs never block
 * a new backfill) and drained in the same step.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import {
  createMappingService,
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  RatelimitError,
  resolvePostingSyncSettings,
  type SyncDirection,
  type XeroProvider
} from "@carbon/ee/accounting";
import { getLogger } from "@carbon/logger";
import { PostgresDriver } from "kysely";
import z from "zod";
import { inngest } from "../../client";
import {
  drainSyncOperations,
  enqueueSyncOperations,
  getSyncOperationActor,
  insertTerminalSyncOperations,
  isJournalEntryPostingEnabled,
  planJournalPostingOperation,
  type SyncOperationRequest,
  type TerminalSyncOperationRequest
} from "./accounting-sync-operations";

const log = getLogger("jobs", "accounting-backfill");

// ============================================================
// HELPERS
// ============================================================

/**
 * Execute an async operation with rate limit handling.
 * If a RatelimitError is thrown, wait for the specified retry period and retry once.
 */
async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  step: {
    sleep: (id: string, duration: string | number) => Promise<void>;
  }
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RatelimitError) {
      const { retryAfterSeconds, limitType, details } = error.rateLimitInfo;
      log.warning(`[RATE LIMIT] ${operationName} hit rate limit`, {
        limitType,
        retryAfterSeconds,
        ...details
      });
      await step.sleep(
        `rate-limit-wait-${operationName}`,
        `${retryAfterSeconds}s`
      );
      log.info(
        `[RATE LIMIT] Retrying ${operationName} after ${retryAfterSeconds}s wait`
      );
      return await operation();
    }
    throw error;
  }
}

// ============================================================
// SCHEMAS
// ============================================================

const BackfillPayloadSchema = z.object({
  companyId: z.string(),
  provider: z.nativeEnum(ProviderID),
  batchSize: z.number().default(25), // Smaller batches to avoid rate limits
  entityTypes: z
    .object({
      customers: z.boolean().default(true),
      vendors: z.boolean().default(true),
      items: z.boolean().default(true)
    })
    .prefault({})
});

/**
 * Helper to determine if we should pull for a given direction config
 */
function shouldPull(direction: SyncDirection): boolean {
  return direction === "pull-from-accounting" || direction === "two-way";
}

/**
 * Helper to determine if we should push for a given direction config
 */
function shouldPush(direction: SyncDirection): boolean {
  return direction === "push-to-accounting" || direction === "two-way";
}

export type BackfillPayload = z.input<typeof BackfillPayloadSchema>;
type ParsedBackfillPayload = z.output<typeof BackfillPayloadSchema>;

export const accountingBackfillFunction = inngest.createFunction(
  { id: "accounting-backfill", retries: 3 },
  { event: "carbon/accounting-backfill" },
  async ({ event, step, runId }) => {
    const payload: ParsedBackfillPayload = BackfillPayloadSchema.parse(
      event.data
    );
    const client = getCarbonServiceRole();

    // Scopes the ledger idempotency keys to this backfill run: retried steps
    // re-enqueue with the same keys (absorbed), a fresh backfill run gets new
    // keys so previously Completed rows never block it
    const backfillRunId = event.id ?? runId;

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
    ) as XeroProvider;

    // Get sync direction config for each entity type
    const customerConfig = provider.getSyncConfig("customer");
    const vendorConfig = provider.getSyncConfig("vendor");
    const itemConfig = provider.getSyncConfig("item");

    const result = {
      customers: { pulled: 0, pushed: 0 },
      vendors: { pulled: 0, pushed: 0 },
      items: { pulled: 0, pushed: 0 },
      totalPulled: 0,
      totalPushed: 0
    };

    // Log the sync directions for visibility
    log.info("[BACKFILL] Starting with entity sync directions:", {
      customer: {
        enabled: customerConfig?.enabled,
        direction: customerConfig?.direction,
        shouldPull:
          customerConfig?.enabled && shouldPull(customerConfig.direction),
        shouldPush:
          customerConfig?.enabled && shouldPush(customerConfig.direction)
      },
      vendor: {
        enabled: vendorConfig?.enabled,
        direction: vendorConfig?.direction,
        shouldPull: vendorConfig?.enabled && shouldPull(vendorConfig.direction),
        shouldPush: vendorConfig?.enabled && shouldPush(vendorConfig.direction)
      },
      item: {
        enabled: itemConfig?.enabled,
        direction: itemConfig?.direction,
        shouldPull: itemConfig?.enabled && shouldPull(itemConfig.direction),
        shouldPush: itemConfig?.enabled && shouldPush(itemConfig.direction)
      }
    });

    // ============================================================
    // PHASE 0: Journal posting dispositions (spec I1 missed-event repair)
    //
    // Every posted journal since postingSync.syncFromDate must have an
    // operation row — pushable journals whose event was missed enqueue,
    // policy-excluded ones get their terminal disposition recorded. Runs
    // only when posting sync is enabled AND an explicit syncFromDate is
    // set (no silent mass-push of a company's whole history).
    // ============================================================

    await step.run("backfill-journal-dispositions", async () => {
      const phaseClient = getCarbonServiceRole();
      const phaseIntegration = await getAccountingIntegration(
        phaseClient,
        payload.companyId,
        payload.provider
      );

      const summary = {
        enqueued: 0,
        recorded: 0,
        alreadyCovered: 0,
        pages: 0,
        truncated: false,
        skippedReason: null as string | null
      };

      if (!isJournalEntryPostingEnabled(phaseIntegration.metadata)) {
        summary.skippedReason = "posting sync (journalEntry) disabled";
        return summary;
      }

      const settings = resolvePostingSyncSettings(phaseIntegration.metadata);
      const syncFromDate = settings.syncFromDate?.slice(0, 10);
      if (!syncFromDate) {
        summary.skippedReason =
          "postingSync.syncFromDate is not set — journal backfill requires an explicit start date";
        return summary;
      }

      const createdBy = getSyncOperationActor(phaseIntegration);
      const pageSize = 200;
      const maxPages = 50; // bound the step; re-run the backfill for more
      let offset = 0;

      for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
        const journals = await phaseClient
          .from("journal")
          .select("id, sourceType, status, reversalOfId")
          .eq("companyId", payload.companyId)
          .in("status", ["Posted", "Reversed"])
          .is("reversalOfId", null)
          .gte("postingDate", syncFromDate)
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);

        if (journals.error) {
          throw new Error(
            `Failed to page journals for disposition backfill: ${journals.error.message}`
          );
        }

        const rows = journals.data ?? [];
        if (rows.length === 0) break;
        summary.pages++;

        const candidateEntityIds = rows.flatMap((row) =>
          row.status === "Reversed" ? [row.id, `${row.id}:reversal`] : [row.id]
        );

        const existing = await phaseClient
          .from("accountingSyncOperation")
          .select("entityId")
          .eq("companyId", payload.companyId)
          .eq("integration", payload.provider)
          .eq("entityType", "journalEntry")
          .in("entityId", candidateEntityIds);

        if (existing.error) {
          throw new Error(
            `Failed to load existing journal operations: ${existing.error.message}`
          );
        }

        const covered = new Set(
          (existing.data ?? []).map((row) => row.entityId)
        );

        const pushRequests: SyncOperationRequest[] = [];
        const terminalRequests: TerminalSyncOperationRequest[] = [];

        for (const row of rows) {
          if (covered.has(row.id)) {
            summary.alreadyCovered++;
          } else {
            const plan = await planJournalPostingOperation({
              client: phaseClient,
              companyId: payload.companyId,
              event: {
                operation: "INSERT",
                recordId: row.id,
                new: {
                  status: "Posted",
                  reversalOfId: null,
                  sourceType: row.sourceType
                },
                old: null
              },
              integrationMetadata: phaseIntegration.metadata
            });

            if (plan.action === "push") {
              pushRequests.push(plan.request);
            } else if (plan.action === "terminal") {
              terminalRequests.push(plan.request);
            }
          }

          // A Reversed journal's reversal push rides the original's policy
          // decision (same source type); record it when missing too
          if (row.status === "Reversed" && !covered.has(`${row.id}:reversal`)) {
            const reversalPlan = await planJournalPostingOperation({
              client: phaseClient,
              companyId: payload.companyId,
              event: {
                operation: "UPDATE",
                recordId: row.id,
                new: {
                  status: "Reversed",
                  reversalOfId: null,
                  sourceType: row.sourceType
                },
                old: { status: "Posted" }
              },
              integrationMetadata: phaseIntegration.metadata
            });

            if (reversalPlan.action === "push") {
              pushRequests.push(reversalPlan.request);
            } else if (reversalPlan.action === "terminal") {
              terminalRequests.push(reversalPlan.request);
            }
          }
        }

        const enqueueOutcomes = await enqueueSyncOperations(phaseClient, {
          companyId: payload.companyId,
          integration: payload.provider,
          trigger: "backfill",
          createdBy,
          scope: backfillRunId,
          requests: pushRequests
        });
        summary.enqueued += enqueueOutcomes.filter(
          (outcome) => outcome.outcome === "enqueued"
        ).length;

        const terminalOutcomes = await insertTerminalSyncOperations(
          phaseClient,
          {
            companyId: payload.companyId,
            integration: payload.provider,
            trigger: "backfill",
            createdBy,
            scope: backfillRunId,
            requests: terminalRequests
          }
        );
        summary.recorded += terminalOutcomes.filter(
          (outcome) => outcome.outcome === "enqueued"
        ).length;

        if (rows.length < pageSize) break;
        offset += pageSize;
        if (pageIndex === maxPages - 1) summary.truncated = true;
      }

      log.info("[BACKFILL] Journal disposition phase complete", summary);
      return summary;
    });

    // ============================================================
    // PHASE 1: Pull contacts from accounting (respecting direction config)
    // ============================================================

    const pullCustomers =
      payload.entityTypes.customers &&
      customerConfig?.enabled &&
      shouldPull(customerConfig.direction);

    const pullVendors =
      payload.entityTypes.vendors &&
      vendorConfig?.enabled &&
      shouldPull(vendorConfig.direction);

    if (pullCustomers || pullVendors) {
      let page = 1;
      let hasMore = true;

      log.info("[PULL] Starting contact pull phase", {
        pullCustomers,
        pullVendors
      });

      while (hasMore) {
        const currentPage = page;
        const pullResult = await step.run(
          `pull-contacts-page-${currentPage}`,
          async () => {
            const pullClient = getCarbonServiceRole();
            const pullIntegration = await getAccountingIntegration(
              pullClient,
              payload.companyId,
              payload.provider
            );
            const pullProvider = getProviderIntegration(
              pullClient,
              payload.companyId,
              pullIntegration.id,
              pullIntegration.metadata
            ) as XeroProvider;

            const pool = getPostgresConnectionPool(5);
            const kysely = getPostgresClient(pool, PostgresDriver);

            log.info(`[PULL] Fetching contacts page ${currentPage}`);
            const response = await withRateLimitRetry(
              () =>
                pullProvider.listContacts({
                  page: currentPage,
                  summaryOnly: true
                }),
              `listContacts page ${currentPage}`,
              step
            );

            log.info(`[PULL] Contacts page ${currentPage} response`, {
              count: response.contacts.length,
              hasMore: response.hasMore,
              contacts: response.contacts.map((c) => ({
                id: c.ContactID,
                name: c.Name,
                isCustomer: c.IsCustomer,
                isSupplier: c.IsSupplier
              }))
            });

            if (response.contacts.length === 0) {
              return {
                hasMore: false,
                pulled: { customers: 0, vendors: 0 }
              };
            }

            let customersPulled = 0;
            let vendorsPulled = 0;

            const requests: SyncOperationRequest[] = [];

            if (pullCustomers) {
              for (const contact of response.contacts.filter(
                (c) => c.IsCustomer
              )) {
                requests.push({
                  entityType: "customer",
                  entityId: contact.ContactID,
                  direction: "pull-from-accounting"
                });
              }
            }

            if (pullVendors) {
              for (const contact of response.contacts.filter(
                (c) => c.IsSupplier
              )) {
                requests.push({
                  entityType: "vendor",
                  entityId: contact.ContactID,
                  direction: "pull-from-accounting"
                });
              }
            }

            if (requests.length > 0) {
              const outcomes = await enqueueSyncOperations(pullClient, {
                companyId: payload.companyId,
                integration: payload.provider,
                trigger: "backfill",
                createdBy: getSyncOperationActor(pullIntegration),
                scope: backfillRunId,
                requests
              });

              const enqueueErrors = outcomes.filter(
                (o) => o.outcome === "error"
              );
              if (enqueueErrors.length > 0) {
                log.error(
                  `[PULL] Failed to enqueue ${enqueueErrors.length} contact operations`
                );
              }

              const drained = await withRateLimitRetry(
                () =>
                  drainSyncOperations({
                    client: pullClient,
                    database: kysely,
                    companyId: payload.companyId,
                    integration: payload.provider,
                    provider: pullProvider,
                    integrationMetadata: pullIntegration.metadata
                  }),
                `drain contacts page ${currentPage}`,
                step
              );

              for (const group of drained.groups) {
                if (group.direction !== "pull-from-accounting") continue;
                if (group.entityType === "customer") {
                  customersPulled += group.result.successCount;
                }
                if (group.entityType === "vendor") {
                  vendorsPulled += group.result.successCount;
                }
              }

              log.info(
                `[PULL] Page ${currentPage}: pulled ${customersPulled} customers, ${vendorsPulled} vendors`,
                {
                  results: drained.groups.flatMap((g) =>
                    g.result.results.map((r) => ({
                      status: r.status,
                      action: r.action,
                      localId: r.localId,
                      remoteId: r.remoteId,
                      error: r.error
                    }))
                  )
                }
              );
            }

            return {
              hasMore: response.hasMore,
              pulled: {
                customers: customersPulled,
                vendors: vendorsPulled
              }
            };
          }
        );

        result.customers.pulled += pullResult.pulled.customers ?? 0;
        result.vendors.pulled += pullResult.pulled.vendors ?? 0;
        hasMore = pullResult.hasMore;

        page++;

        // Small delay between pages to avoid rate limits
        if (hasMore) {
          await step.sleep(`contacts-page-delay-${currentPage}`, "1s");
        }
      }
    } else {
      log.info(
        "[PULL] Skipping contact pull - not enabled or direction is push-only"
      );
    }

    // ============================================================
    // PHASE 2: Pull items from accounting (respecting direction config)
    // ============================================================

    const pullItems =
      payload.entityTypes.items &&
      itemConfig?.enabled &&
      shouldPull(itemConfig.direction);

    if (pullItems) {
      let page = 1;
      let hasMore = true;

      log.info("[PULL] Starting items pull phase");

      while (hasMore) {
        const currentPage = page;
        const pullResult = await step.run(
          `pull-items-page-${currentPage}`,
          async () => {
            const pullClient = getCarbonServiceRole();
            const pullIntegration = await getAccountingIntegration(
              pullClient,
              payload.companyId,
              payload.provider
            );
            const pullProvider = getProviderIntegration(
              pullClient,
              payload.companyId,
              pullIntegration.id,
              pullIntegration.metadata
            ) as XeroProvider;

            const pool = getPostgresConnectionPool(5);
            const kysely = getPostgresClient(pool, PostgresDriver);

            log.info(`[PULL] Fetching items page ${currentPage}`);
            const response = await withRateLimitRetry(
              () => pullProvider.listItems({ page: currentPage }),
              `listItems page ${currentPage}`,
              step
            );

            log.info(`[PULL] Items page ${currentPage} response`, {
              count: response.items.length,
              hasMore: response.hasMore,
              items: response.items.map((i) => ({
                id: i.ItemID,
                code: i.Code,
                name: i.Name
              }))
            });

            if (response.items.length === 0) {
              return { hasMore: false, pulled: { items: 0 } };
            }

            const requests: SyncOperationRequest[] = response.items.map(
              (item) => ({
                entityType: "item",
                entityId: item.ItemID,
                direction: "pull-from-accounting"
              })
            );

            const outcomes = await enqueueSyncOperations(pullClient, {
              companyId: payload.companyId,
              integration: payload.provider,
              trigger: "backfill",
              createdBy: getSyncOperationActor(pullIntegration),
              scope: backfillRunId,
              requests
            });

            const enqueueErrors = outcomes.filter((o) => o.outcome === "error");
            if (enqueueErrors.length > 0) {
              log.error(
                `[PULL] Failed to enqueue ${enqueueErrors.length} item operations`
              );
            }

            const drained = await withRateLimitRetry(
              () =>
                drainSyncOperations({
                  client: pullClient,
                  database: kysely,
                  companyId: payload.companyId,
                  integration: payload.provider,
                  provider: pullProvider,
                  integrationMetadata: pullIntegration.metadata
                }),
              `drain items page ${currentPage}`,
              step
            );

            const itemsPulled = drained.groups
              .filter(
                (g) =>
                  g.entityType === "item" &&
                  g.direction === "pull-from-accounting"
              )
              .reduce((acc, g) => acc + g.result.successCount, 0);

            log.info(
              `[PULL] Page ${currentPage}: pulled ${itemsPulled} items`,
              {
                results: drained.groups.flatMap((g) =>
                  g.result.results.map((r) => ({
                    status: r.status,
                    action: r.action,
                    localId: r.localId,
                    remoteId: r.remoteId,
                    error: r.error
                  }))
                )
              }
            );

            return {
              hasMore: response.hasMore,
              pulled: { items: itemsPulled }
            };
          }
        );

        result.items.pulled += pullResult.pulled.items ?? 0;
        hasMore = pullResult.hasMore;

        page++;

        if (hasMore) {
          await step.sleep(`items-page-delay-${currentPage}`, "1s");
        }
      }
    } else {
      log.info(
        "[PULL] Skipping items pull - not enabled or direction is push-only"
      );
    }

    // ============================================================
    // PHASE 3: Push to accounting (respecting direction config)
    // ============================================================

    // Push customers if their config allows pushing
    const pushCustomers =
      payload.entityTypes.customers &&
      customerConfig?.enabled &&
      shouldPush(customerConfig.direction);

    if (pushCustomers) {
      let hasMore = true;
      let batchIndex = 0;

      log.info("[PUSH] Starting customers push phase");

      while (hasMore) {
        const currentBatchIndex = batchIndex;
        const pushResult = await step.run(
          `push-customers-batch-${currentBatchIndex}`,
          async () => {
            const pushClient = getCarbonServiceRole();
            const pushIntegration = await getAccountingIntegration(
              pushClient,
              payload.companyId,
              payload.provider
            );
            const pushProvider = getProviderIntegration(
              pushClient,
              payload.companyId,
              pushIntegration.id,
              pushIntegration.metadata
            ) as XeroProvider;

            const pool = getPostgresConnectionPool(5);
            const kysely = getPostgresClient(pool, PostgresDriver);

            const mappingService = createMappingService(
              kysely,
              payload.companyId
            );

            const unsyncedIds = await mappingService.getUnsyncedEntityIds(
              "customer",
              "customer",
              pushProvider.id,
              payload.batchSize
            );

            if (unsyncedIds.length === 0) {
              return {
                successCount: 0,
                hasMore: false
              };
            }

            const outcomes = await enqueueSyncOperations(pushClient, {
              companyId: payload.companyId,
              integration: payload.provider,
              trigger: "backfill",
              createdBy: getSyncOperationActor(pushIntegration),
              scope: backfillRunId,
              requests: unsyncedIds.map((id) => ({
                entityType: "customer",
                entityId: id,
                direction: "push-to-accounting"
              }))
            });

            const enqueueErrors = outcomes.filter((o) => o.outcome === "error");
            if (enqueueErrors.length > 0) {
              log.error(
                `[PUSH] Failed to enqueue ${enqueueErrors.length} customer operations`
              );
            }

            const drained = await withRateLimitRetry(
              () =>
                drainSyncOperations({
                  client: pushClient,
                  database: kysely,
                  companyId: payload.companyId,
                  integration: payload.provider,
                  provider: pushProvider,
                  integrationMetadata: pushIntegration.metadata
                }),
              `drain customers push batch ${currentBatchIndex}`,
              step
            );

            const successCount = drained.groups
              .filter(
                (g) =>
                  g.entityType === "customer" &&
                  g.direction === "push-to-accounting"
              )
              .reduce((acc, g) => acc + g.result.successCount, 0);

            log.info(
              `[PUSH] Pushed ${successCount}/${unsyncedIds.length} customer entities`,
              {
                entityIds: unsyncedIds,
                results: drained.groups.flatMap((g) =>
                  g.result.results.map((r) => ({
                    status: r.status,
                    action: r.action,
                    localId: r.localId,
                    remoteId: r.remoteId,
                    error: r.error
                  }))
                )
              }
            );

            return {
              successCount,
              // Failed pushes stay unmapped and come straight back from
              // getUnsyncedEntityIds, but their idempotency key (same
              // backfill run) absorbs the re-enqueue — stop when the drain
              // claimed nothing so the loop cannot spin without progress
              hasMore:
                unsyncedIds.length >= payload.batchSize && drained.claimed > 0
            };
          }
        );

        result.customers.pushed += pushResult.successCount;
        hasMore = pushResult.hasMore;
        batchIndex++;

        // Delay between batches
        if (hasMore) {
          await step.sleep(`customers-push-delay-${currentBatchIndex}`, "2s");
        }
      }
    } else {
      log.info(
        "[PUSH] Skipping customers push - not enabled or direction is pull-only"
      );
    }

    // Push vendors if their config allows pushing
    const pushVendors =
      payload.entityTypes.vendors &&
      vendorConfig?.enabled &&
      shouldPush(vendorConfig.direction);

    if (pushVendors) {
      let hasMore = true;
      let batchIndex = 0;

      log.info("[PUSH] Starting vendors push phase");

      while (hasMore) {
        const currentBatchIndex = batchIndex;
        const pushResult = await step.run(
          `push-vendors-batch-${currentBatchIndex}`,
          async () => {
            const pushClient = getCarbonServiceRole();
            const pushIntegration = await getAccountingIntegration(
              pushClient,
              payload.companyId,
              payload.provider
            );
            const pushProvider = getProviderIntegration(
              pushClient,
              payload.companyId,
              pushIntegration.id,
              pushIntegration.metadata
            ) as XeroProvider;

            const pool = getPostgresConnectionPool(5);
            const kysely = getPostgresClient(pool, PostgresDriver);

            const mappingService = createMappingService(
              kysely,
              payload.companyId
            );

            const unsyncedIds = await mappingService.getUnsyncedEntityIds(
              "vendor",
              "supplier",
              pushProvider.id,
              payload.batchSize
            );

            if (unsyncedIds.length === 0) {
              return {
                successCount: 0,
                hasMore: false
              };
            }

            const outcomes = await enqueueSyncOperations(pushClient, {
              companyId: payload.companyId,
              integration: payload.provider,
              trigger: "backfill",
              createdBy: getSyncOperationActor(pushIntegration),
              scope: backfillRunId,
              requests: unsyncedIds.map((id) => ({
                entityType: "vendor",
                entityId: id,
                direction: "push-to-accounting"
              }))
            });

            const enqueueErrors = outcomes.filter((o) => o.outcome === "error");
            if (enqueueErrors.length > 0) {
              log.error(
                `[PUSH] Failed to enqueue ${enqueueErrors.length} vendor operations`
              );
            }

            const drained = await withRateLimitRetry(
              () =>
                drainSyncOperations({
                  client: pushClient,
                  database: kysely,
                  companyId: payload.companyId,
                  integration: payload.provider,
                  provider: pushProvider,
                  integrationMetadata: pushIntegration.metadata
                }),
              `drain vendors push batch ${currentBatchIndex}`,
              step
            );

            const successCount = drained.groups
              .filter(
                (g) =>
                  g.entityType === "vendor" &&
                  g.direction === "push-to-accounting"
              )
              .reduce((acc, g) => acc + g.result.successCount, 0);

            log.info(
              `[PUSH] Pushed ${successCount}/${unsyncedIds.length} vendor entities`,
              {
                entityIds: unsyncedIds,
                results: drained.groups.flatMap((g) =>
                  g.result.results.map((r) => ({
                    status: r.status,
                    action: r.action,
                    localId: r.localId,
                    remoteId: r.remoteId,
                    error: r.error
                  }))
                )
              }
            );

            return {
              successCount,
              // Same progress guard as the customer push loop
              hasMore:
                unsyncedIds.length >= payload.batchSize && drained.claimed > 0
            };
          }
        );

        result.vendors.pushed += pushResult.successCount;
        hasMore = pushResult.hasMore;
        batchIndex++;

        if (hasMore) {
          await step.sleep(`vendors-push-delay-${currentBatchIndex}`, "2s");
        }
      }
    } else {
      log.info(
        "[PUSH] Skipping vendors push - not enabled or direction is pull-only"
      );
    }

    // Push items if their config allows pushing
    const pushItems =
      payload.entityTypes.items &&
      itemConfig?.enabled &&
      shouldPush(itemConfig.direction);

    if (pushItems) {
      let hasMore = true;
      let batchIndex = 0;

      log.info("[PUSH] Starting items push phase");

      while (hasMore) {
        const currentBatchIndex = batchIndex;
        const pushResult = await step.run(
          `push-items-batch-${currentBatchIndex}`,
          async () => {
            const pushClient = getCarbonServiceRole();
            const pushIntegration = await getAccountingIntegration(
              pushClient,
              payload.companyId,
              payload.provider
            );
            const pushProvider = getProviderIntegration(
              pushClient,
              payload.companyId,
              pushIntegration.id,
              pushIntegration.metadata
            ) as XeroProvider;

            const pool = getPostgresConnectionPool(5);
            const kysely = getPostgresClient(pool, PostgresDriver);

            const mappingService = createMappingService(
              kysely,
              payload.companyId
            );

            const unsyncedIds = await mappingService.getUnsyncedEntityIds(
              "item",
              "item",
              pushProvider.id,
              payload.batchSize
            );

            if (unsyncedIds.length === 0) {
              return {
                successCount: 0,
                hasMore: false
              };
            }

            const outcomes = await enqueueSyncOperations(pushClient, {
              companyId: payload.companyId,
              integration: payload.provider,
              trigger: "backfill",
              createdBy: getSyncOperationActor(pushIntegration),
              scope: backfillRunId,
              requests: unsyncedIds.map((id) => ({
                entityType: "item",
                entityId: id,
                direction: "push-to-accounting"
              }))
            });

            const enqueueErrors = outcomes.filter((o) => o.outcome === "error");
            if (enqueueErrors.length > 0) {
              log.error(
                `[PUSH] Failed to enqueue ${enqueueErrors.length} item operations`
              );
            }

            const drained = await withRateLimitRetry(
              () =>
                drainSyncOperations({
                  client: pushClient,
                  database: kysely,
                  companyId: payload.companyId,
                  integration: payload.provider,
                  provider: pushProvider,
                  integrationMetadata: pushIntegration.metadata
                }),
              `drain items push batch ${currentBatchIndex}`,
              step
            );

            const successCount = drained.groups
              .filter(
                (g) =>
                  g.entityType === "item" &&
                  g.direction === "push-to-accounting"
              )
              .reduce((acc, g) => acc + g.result.successCount, 0);

            log.info(
              `[PUSH] Pushed ${successCount}/${unsyncedIds.length} item entities`,
              {
                entityIds: unsyncedIds,
                results: drained.groups.flatMap((g) =>
                  g.result.results.map((r) => ({
                    status: r.status,
                    action: r.action,
                    localId: r.localId,
                    remoteId: r.remoteId,
                    error: r.error
                  }))
                )
              }
            );

            return {
              successCount,
              // Same progress guard as the customer push loop
              hasMore:
                unsyncedIds.length >= payload.batchSize && drained.claimed > 0
            };
          }
        );

        result.items.pushed += pushResult.successCount;
        hasMore = pushResult.hasMore;
        batchIndex++;

        if (hasMore) {
          await step.sleep(`items-push-delay-${currentBatchIndex}`, "2s");
        }
      }
    } else {
      log.info(
        "[PUSH] Skipping items push - not enabled or direction is pull-only"
      );
    }

    // Calculate totals
    result.totalPulled =
      result.customers.pulled + result.vendors.pulled + result.items.pulled;
    result.totalPushed =
      result.customers.pushed + result.vendors.pushed + result.items.pushed;

    log.info(
      `[COMPLETE] Backfill finished. Pulled: ${result.totalPulled}, Pushed: ${result.totalPushed}`
    );

    return result;
  }
);
