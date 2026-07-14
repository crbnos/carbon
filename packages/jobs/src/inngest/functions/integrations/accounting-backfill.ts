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
  type SyncDirection,
  SyncFactory,
  type XeroProvider
} from "@carbon/ee/accounting";
import { getLogger } from "@carbon/logger";
import { PostgresDriver } from "kysely";
import z from "zod";
import { inngest } from "../../client";

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
      log.warning(`${operationName} hit rate limit`, {
        limitType,
        retryAfterSeconds,
        ...details
      });
      await step.sleep(
        `rate-limit-wait-${operationName}`,
        `${retryAfterSeconds}s`
      );
      log.info(`Retrying ${operationName} after ${retryAfterSeconds}s wait`);
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
    .default({})
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
  async ({ event, step, logger }) => {
    const payload: ParsedBackfillPayload = BackfillPayloadSchema.parse(
      event.data
    );
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
    logger.info("Starting with entity sync directions", {
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

      logger.info("Starting contact pull phase", {
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

            logger.info(`Fetching contacts page ${currentPage}`);
            const response = await withRateLimitRetry(
              () =>
                pullProvider.listContacts({
                  page: currentPage,
                  summaryOnly: true
                }),
              `listContacts page ${currentPage}`,
              step
            );

            logger.info(`Contacts page ${currentPage} response`, {
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

            // Pull customers
            if (pullCustomers) {
              const customers = response.contacts.filter((c) => c.IsCustomer);
              if (customers.length > 0) {
                const syncer = SyncFactory.getSyncer({
                  database: kysely,
                  companyId: payload.companyId,
                  provider: pullProvider,
                  config: pullProvider.getSyncConfig("customer"),
                  entityType: "customer"
                });
                const ids = customers.map((c) => c.ContactID);
                const syncResult = await withRateLimitRetry(
                  () => syncer.pullBatchFromAccounting(ids),
                  `pullBatchFromAccounting customers page ${currentPage}`,
                  step
                );
                customersPulled = syncResult.successCount;
                logger.info(
                  `Page ${currentPage}: pulled ${customersPulled} customers`,
                  {
                    results: syncResult.results.map((r) => ({
                      status: r.status,
                      action: r.action,
                      localId: r.localId,
                      remoteId: r.remoteId,
                      error: r.error
                    }))
                  }
                );
              }
            }

            // Pull vendors
            if (pullVendors) {
              const vendors = response.contacts.filter((c) => c.IsSupplier);
              if (vendors.length > 0) {
                const syncer = SyncFactory.getSyncer({
                  database: kysely,
                  companyId: payload.companyId,
                  provider: pullProvider,
                  config: pullProvider.getSyncConfig("vendor"),
                  entityType: "vendor"
                });
                const ids = vendors.map((c) => c.ContactID);
                const syncResult = await withRateLimitRetry(
                  () => syncer.pullBatchFromAccounting(ids),
                  `pullBatchFromAccounting vendors page ${currentPage}`,
                  step
                );
                vendorsPulled = syncResult.successCount;
                logger.info(
                  `Page ${currentPage}: pulled ${vendorsPulled} vendors`,
                  {
                    results: syncResult.results.map((r) => ({
                      status: r.status,
                      action: r.action,
                      localId: r.localId,
                      remoteId: r.remoteId,
                      error: r.error
                    }))
                  }
                );
              }
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
      logger.info(
        "Skipping contact pull - not enabled or direction is push-only"
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

      logger.info("Starting items pull phase");

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

            logger.info(`Fetching items page ${currentPage}`);
            const response = await withRateLimitRetry(
              () => pullProvider.listItems({ page: currentPage }),
              `listItems page ${currentPage}`,
              step
            );

            logger.info(`Items page ${currentPage} response`, {
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

            const syncer = SyncFactory.getSyncer({
              database: kysely,
              companyId: payload.companyId,
              provider: pullProvider,
              config: pullProvider.getSyncConfig("item"),
              entityType: "item"
            });
            const ids = response.items.map((item) => item.ItemID);
            const syncResult = await withRateLimitRetry(
              () => syncer.pullBatchFromAccounting(ids),
              `pullBatchFromAccounting items page ${currentPage}`,
              step
            );

            logger.info(
              `Page ${currentPage}: pulled ${syncResult.successCount} items`,
              {
                results: syncResult.results.map((r) => ({
                  status: r.status,
                  action: r.action,
                  localId: r.localId,
                  remoteId: r.remoteId,
                  error: r.error
                }))
              }
            );

            return {
              hasMore: response.hasMore,
              pulled: { items: syncResult.successCount }
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
      logger.info(
        "Skipping items pull - not enabled or direction is push-only"
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

      logger.info("Starting customers push phase");

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

            const syncer = SyncFactory.getSyncer({
              database: kysely,
              companyId: payload.companyId,
              provider: pushProvider,
              config: pushProvider.getSyncConfig("customer"),
              entityType: "customer"
            });

            const syncResult = await withRateLimitRetry(
              () => syncer.pushBatchToAccounting(unsyncedIds),
              `pushBatchToAccounting customers`,
              step
            );

            logger.info(
              `Pushed ${syncResult.successCount}/${unsyncedIds.length} customer entities`,
              {
                entityIds: unsyncedIds,
                results: syncResult.results.map((r) => ({
                  status: r.status,
                  action: r.action,
                  localId: r.localId,
                  remoteId: r.remoteId,
                  error: r.error
                }))
              }
            );

            return {
              successCount: syncResult.successCount,
              hasMore: unsyncedIds.length >= payload.batchSize
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
      logger.info(
        "Skipping customers push - not enabled or direction is pull-only"
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

      logger.info("Starting vendors push phase");

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

            const syncer = SyncFactory.getSyncer({
              database: kysely,
              companyId: payload.companyId,
              provider: pushProvider,
              config: pushProvider.getSyncConfig("vendor"),
              entityType: "vendor"
            });

            const syncResult = await withRateLimitRetry(
              () => syncer.pushBatchToAccounting(unsyncedIds),
              `pushBatchToAccounting vendors`,
              step
            );

            logger.info(
              `Pushed ${syncResult.successCount}/${unsyncedIds.length} vendor entities`,
              {
                entityIds: unsyncedIds,
                results: syncResult.results.map((r) => ({
                  status: r.status,
                  action: r.action,
                  localId: r.localId,
                  remoteId: r.remoteId,
                  error: r.error
                }))
              }
            );

            return {
              successCount: syncResult.successCount,
              hasMore: unsyncedIds.length >= payload.batchSize
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
      logger.info(
        "Skipping vendors push - not enabled or direction is pull-only"
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

      logger.info("Starting items push phase");

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

            const syncer = SyncFactory.getSyncer({
              database: kysely,
              companyId: payload.companyId,
              provider: pushProvider,
              config: pushProvider.getSyncConfig("item"),
              entityType: "item"
            });

            const syncResult = await withRateLimitRetry(
              () => syncer.pushBatchToAccounting(unsyncedIds),
              `pushBatchToAccounting items`,
              step
            );

            logger.info(
              `Pushed ${syncResult.successCount}/${unsyncedIds.length} item entities`,
              {
                entityIds: unsyncedIds,
                results: syncResult.results.map((r) => ({
                  status: r.status,
                  action: r.action,
                  localId: r.localId,
                  remoteId: r.remoteId,
                  error: r.error
                }))
              }
            );

            return {
              successCount: syncResult.successCount,
              hasMore: unsyncedIds.length >= payload.batchSize
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
      logger.info(
        "Skipping items push - not enabled or direction is pull-only"
      );
    }

    // Calculate totals
    result.totalPulled =
      result.customers.pulled + result.vendors.pulled + result.items.pulled;
    result.totalPushed =
      result.customers.pushed + result.vendors.pushed + result.items.pushed;

    logger.info(
      `Backfill finished. Pulled: ${result.totalPulled}, Pushed: ${result.totalPushed}`
    );

    return result;
  }
);
