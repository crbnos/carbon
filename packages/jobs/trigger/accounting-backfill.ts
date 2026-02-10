/**
 * Backfill task for syncing entities between Carbon and accounting providers.
 *
 * This task respects the per-entity sync direction configuration:
 * - "pull-from-accounting": Only pull entities from the provider
 * - "push-to-accounting": Only push Carbon entities to the provider
 * - "two-way": Pull from provider AND push unsynced Carbon entities
 *
 * This prevents unnecessary syncing (e.g., items configured as push-only
 * won't be pulled from Xero, and POs configured as push-only won't try to pull).
 */
import { getCarbonServiceRole } from "@carbon/auth";
import {
  getPostgresClient,
  getPostgresConnectionPool,
} from "@carbon/database/client";
import {
  createMappingService,
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  RatelimitError,
  SyncFactory,
  type AccountingEntityType,
  type SyncDirection,
  type XeroProvider,
} from "@carbon/ee/accounting";
import { logger, task, wait } from "@trigger.dev/sdk/v3";
import { PostgresDriver } from "kysely";
import z from "zod";

// ============================================================
// HELPERS
// ============================================================

/**
 * Execute an async operation with rate limit handling.
 * If a RatelimitError is thrown, wait for the specified retry period and retry once.
 */
async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RatelimitError) {
      const { retryAfterSeconds, limitType, details } = error.rateLimitInfo;
      logger.warn(`[RATE LIMIT] ${operationName} hit rate limit`, {
        limitType,
        retryAfterSeconds,
        ...details,
      });
      await wait.for({ seconds: retryAfterSeconds });
      logger.info(
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
      items: z.boolean().default(true),
    })
    .default({}),
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

const PullPagePayloadSchema = z.object({
  companyId: z.string(),
  provider: z.nativeEnum(ProviderID),
  entityType: z.enum(["contact", "item"]),
  page: z.number(),
  includeCustomers: z.boolean().default(true),
  includeVendors: z.boolean().default(true),
});

const PushBatchPayloadSchema = z.object({
  companyId: z.string(),
  provider: z.nativeEnum(ProviderID),
  entityType: z.enum(["customer", "supplier", "item"]),
  entityIds: z.array(z.string()),
});

export type BackfillPayload = z.input<typeof BackfillPayloadSchema>;
type ParsedBackfillPayload = z.output<typeof BackfillPayloadSchema>;

// ============================================================
// PULL PAGE TASK - Pulls a single page from external system
// ============================================================

export const accountingPullPageTask = task({
  id: "accounting-pull-page",
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 120000, // Up to 2 minutes for rate limit recovery
    randomize: true,
  },
  run: async (input: z.input<typeof PullPagePayloadSchema>) => {
    const payload = PullPagePayloadSchema.parse(input);
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

    const pool = getPostgresConnectionPool(5);
    const kysely = getPostgresClient(pool, PostgresDriver);

    try {
      if (payload.entityType === "contact") {
        logger.info(`[PULL] Fetching contacts page ${payload.page}`);
        const response = await withRateLimitRetry(
          () =>
            provider.listContacts({
              page: payload.page,
              summaryOnly: true,
            }),
          `listContacts page ${payload.page}`
        );

        logger.info(`[PULL] Contacts page ${payload.page} response`, {
          count: response.contacts.length,
          hasMore: response.hasMore,
          contacts: response.contacts.map((c) => ({
            id: c.ContactID,
            name: c.Name,
            isCustomer: c.IsCustomer,
            isSupplier: c.IsSupplier,
          })),
        });

        if (response.contacts.length === 0) {
          return { hasMore: false, pulled: { customers: 0, vendors: 0 } };
        }

        let customersPulled = 0;
        let vendorsPulled = 0;

        // Pull customers
        if (payload.includeCustomers) {
          const customers = response.contacts.filter((c) => c.IsCustomer);
          if (customers.length > 0) {
            const syncer = SyncFactory.getSyncer({
              database: kysely,
              companyId: payload.companyId,
              provider,
              config: provider.getSyncConfig("customer"),
              entityType: "customer",
            });
            const ids = customers.map((c) => c.ContactID);
            const result = await withRateLimitRetry(
              () => syncer.pullBatchFromAccounting(ids),
              `pullBatchFromAccounting customers page ${payload.page}`
            );
            customersPulled = result.successCount;
            logger.info(
              `[PULL] Page ${payload.page}: pulled ${customersPulled} customers`,
              {
                results: result.results.map((r) => ({
                  status: r.status,
                  action: r.action,
                  localId: r.localId,
                  remoteId: r.remoteId,
                  error: r.error,
                })),
              }
            );
          }
        }

        // Pull vendors
        if (payload.includeVendors) {
          const vendors = response.contacts.filter((c) => c.IsSupplier);
          if (vendors.length > 0) {
            const syncer = SyncFactory.getSyncer({
              database: kysely,
              companyId: payload.companyId,
              provider,
              config: provider.getSyncConfig("vendor"),
              entityType: "vendor",
            });
            const ids = vendors.map((c) => c.ContactID);
            const result = await withRateLimitRetry(
              () => syncer.pullBatchFromAccounting(ids),
              `pullBatchFromAccounting vendors page ${payload.page}`
            );
            vendorsPulled = result.successCount;
            logger.info(
              `[PULL] Page ${payload.page}: pulled ${vendorsPulled} vendors`,
              {
                results: result.results.map((r) => ({
                  status: r.status,
                  action: r.action,
                  localId: r.localId,
                  remoteId: r.remoteId,
                  error: r.error,
                })),
              }
            );
          }
        }

        return {
          hasMore: response.hasMore,
          pulled: { customers: customersPulled, vendors: vendorsPulled },
        };
      } else {
        // Items
        logger.info(`[PULL] Fetching items page ${payload.page}`);
        const response = await withRateLimitRetry(
          () => provider.listItems({ page: payload.page }),
          `listItems page ${payload.page}`
        );

        logger.info(`[PULL] Items page ${payload.page} response`, {
          count: response.items.length,
          hasMore: response.hasMore,
          items: response.items.map((i) => ({
            id: i.ItemID,
            code: i.Code,
            name: i.Name,
          })),
        });

        if (response.items.length === 0) {
          return { hasMore: false, pulled: { items: 0 } };
        }

        const syncer = SyncFactory.getSyncer({
          database: kysely,
          companyId: payload.companyId,
          provider,
          config: provider.getSyncConfig("item"),
          entityType: "item",
        });
        const ids = response.items.map((item) => item.ItemID);
        const result = await withRateLimitRetry(
          () => syncer.pullBatchFromAccounting(ids),
          `pullBatchFromAccounting items page ${payload.page}`
        );

        logger.info(
          `[PULL] Page ${payload.page}: pulled ${result.successCount} items`,
          {
            results: result.results.map((r) => ({
              status: r.status,
              action: r.action,
              localId: r.localId,
              remoteId: r.remoteId,
              error: r.error,
            })),
          }
        );

        return {
          hasMore: response.hasMore,
          pulled: { items: result.successCount },
        };
      }
    } finally {
      await pool.end();
    }
  },
});

// ============================================================
// PUSH BATCH TASK - Pushes a batch of entities to external system
// ============================================================

export const accountingPushBatchTask = task({
  id: "accounting-push-batch",
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 120000,
    randomize: true,
  },
  run: async (input: z.input<typeof PushBatchPayloadSchema>) => {
    const payload = PushBatchPayloadSchema.parse(input);
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

    const pool = getPostgresConnectionPool(5);
    const kysely = getPostgresClient(pool, PostgresDriver);

    try {
      // Map entity type to accounting entity type
      const entityType: AccountingEntityType =
        payload.entityType === "supplier" ? "vendor" : payload.entityType;

      const syncer = SyncFactory.getSyncer({
        database: kysely,
        companyId: payload.companyId,
        provider,
        config: provider.getSyncConfig(entityType),
        entityType,
      });

      const result = await withRateLimitRetry(
        () => syncer.pushBatchToAccounting(payload.entityIds),
        `pushBatchToAccounting ${payload.entityType}`
      );

      logger.info(
        `[PUSH] Pushed ${result.successCount}/${payload.entityIds.length} ${payload.entityType} entities`,
        {
          entityIds: payload.entityIds,
          results: result.results.map((r) => ({
            status: r.status,
            action: r.action,
            localId: r.localId,
            remoteId: r.remoteId,
            error: r.error,
          })),
        }
      );

      return {
        successCount: result.successCount,
        errorCount: result.errorCount,
      };
    } finally {
      await pool.end();
    }
  },
});

// ============================================================
// ORCHESTRATOR TASK - Coordinates the entire backfill process
// ============================================================

export const accountingBackfillTask = task({
  id: "accounting-backfill",
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 5000,
    maxTimeoutInMs: 60000,
    randomize: true,
  },
  run: async (input: BackfillPayload) => {
    const payload: ParsedBackfillPayload = BackfillPayloadSchema.parse(input);
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
      totalPushed: 0,
    };

    // Log the sync directions for visibility
    logger.info("[BACKFILL] Starting with entity sync directions:", {
      customer: {
        enabled: customerConfig?.enabled,
        direction: customerConfig?.direction,
        shouldPull:
          customerConfig?.enabled && shouldPull(customerConfig.direction),
        shouldPush:
          customerConfig?.enabled && shouldPush(customerConfig.direction),
      },
      vendor: {
        enabled: vendorConfig?.enabled,
        direction: vendorConfig?.direction,
        shouldPull: vendorConfig?.enabled && shouldPull(vendorConfig.direction),
        shouldPush: vendorConfig?.enabled && shouldPush(vendorConfig.direction),
      },
      item: {
        enabled: itemConfig?.enabled,
        direction: itemConfig?.direction,
        shouldPull: itemConfig?.enabled && shouldPull(itemConfig.direction),
        shouldPush: itemConfig?.enabled && shouldPush(itemConfig.direction),
      },
    });

    // ============================================================
    // PHASE 1: Pull from accounting (respecting direction config)
    // ============================================================

    // Determine which contact types to pull based on their direction config
    const pullCustomers =
      payload.entityTypes.customers &&
      customerConfig?.enabled &&
      shouldPull(customerConfig.direction);

    const pullVendors =
      payload.entityTypes.vendors &&
      vendorConfig?.enabled &&
      shouldPull(vendorConfig.direction);

    // Pull contacts (customers and vendors) if their config allows pulling
    if (pullCustomers || pullVendors) {
      let page = 1;
      let hasMore = true;

      logger.info("[PULL] Starting contact pull phase", {
        pullCustomers,
        pullVendors,
      });

      while (hasMore) {
        const pullResult = await accountingPullPageTask.triggerAndWait({
          companyId: payload.companyId,
          provider: payload.provider,
          entityType: "contact",
          page,
          includeCustomers: pullCustomers,
          includeVendors: pullVendors,
        });

        if (pullResult.ok) {
          result.customers.pulled += pullResult.output.pulled.customers ?? 0;
          result.vendors.pulled += pullResult.output.pulled.vendors ?? 0;
          hasMore = pullResult.output.hasMore;
        } else {
          logger.error(`[PULL] Failed to pull contacts page ${page}`);
          hasMore = false;
        }

        page++;

        // Small delay between pages to avoid rate limits
        if (hasMore) {
          await wait.for({ seconds: 1 });
        }
      }
    } else {
      logger.info(
        "[PULL] Skipping contact pull - not enabled or direction is push-only"
      );
    }

    // Pull items if their config allows pulling
    const pullItems =
      payload.entityTypes.items &&
      itemConfig?.enabled &&
      shouldPull(itemConfig.direction);

    if (pullItems) {
      let page = 1;
      let hasMore = true;

      logger.info("[PULL] Starting items pull phase");

      while (hasMore) {
        const pullResult = await accountingPullPageTask.triggerAndWait({
          companyId: payload.companyId,
          provider: payload.provider,
          entityType: "item",
          page,
        });

        if (pullResult.ok) {
          result.items.pulled += pullResult.output.pulled.items ?? 0;
          hasMore = pullResult.output.hasMore;
        } else {
          logger.error(`[PULL] Failed to pull items page ${page}`);
          hasMore = false;
        }

        page++;

        if (hasMore) {
          await wait.for({ seconds: 1 });
        }
      }
    } else {
      logger.info(
        "[PULL] Skipping items pull - not enabled or direction is push-only"
      );
    }

    // ============================================================
    // PHASE 2: Push to accounting (respecting direction config)
    // ============================================================

    const pool = getPostgresConnectionPool(5);
    const kysely = getPostgresClient(pool, PostgresDriver);

    try {
      const mappingService = createMappingService(kysely, payload.companyId);

      // Push customers if their config allows pushing
      const pushCustomers =
        payload.entityTypes.customers &&
        customerConfig?.enabled &&
        shouldPush(customerConfig.direction);

      if (pushCustomers) {
        let hasMore = true;

        logger.info("[PUSH] Starting customers push phase");

        while (hasMore) {
          const unsyncedIds = await mappingService.getUnsyncedEntityIds(
            "customer",
            "customer",
            provider.id,
            payload.batchSize
          );

          if (unsyncedIds.length === 0) {
            hasMore = false;
            break;
          }

          const pushResult = await accountingPushBatchTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "customer",
            entityIds: unsyncedIds,
          });

          if (pushResult.ok) {
            result.customers.pushed += pushResult.output.successCount;
          } else {
            logger.error("[PUSH] Failed to push customers batch");
          }

          if (unsyncedIds.length < payload.batchSize) {
            hasMore = false;
          }

          // Delay between batches
          if (hasMore) {
            await wait.for({ seconds: 2 });
          }
        }
      } else {
        logger.info(
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

        logger.info("[PUSH] Starting vendors push phase");

        while (hasMore) {
          const unsyncedIds = await mappingService.getUnsyncedEntityIds(
            "vendor",
            "supplier",
            provider.id,
            payload.batchSize
          );

          if (unsyncedIds.length === 0) {
            hasMore = false;
            break;
          }

          const pushResult = await accountingPushBatchTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "supplier",
            entityIds: unsyncedIds,
          });

          if (pushResult.ok) {
            result.vendors.pushed += pushResult.output.successCount;
          } else {
            logger.error("[PUSH] Failed to push vendors batch");
          }

          if (unsyncedIds.length < payload.batchSize) {
            hasMore = false;
          }

          if (hasMore) {
            await wait.for({ seconds: 2 });
          }
        }
      } else {
        logger.info(
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

        logger.info("[PUSH] Starting items push phase");

        while (hasMore) {
          const unsyncedIds = await mappingService.getUnsyncedEntityIds(
            "item",
            "item",
            provider.id,
            payload.batchSize
          );

          if (unsyncedIds.length === 0) {
            hasMore = false;
            break;
          }

          const pushResult = await accountingPushBatchTask.triggerAndWait({
            companyId: payload.companyId,
            provider: payload.provider,
            entityType: "item",
            entityIds: unsyncedIds,
          });

          if (pushResult.ok) {
            result.items.pushed += pushResult.output.successCount;
          } else {
            logger.error("[PUSH] Failed to push items batch");
          }

          if (unsyncedIds.length < payload.batchSize) {
            hasMore = false;
          }

          if (hasMore) {
            await wait.for({ seconds: 2 });
          }
        }
      } else {
        logger.info(
          "[PUSH] Skipping items push - not enabled or direction is pull-only"
        );
      }
    } finally {
      await pool.end();
    }

    // Calculate totals
    result.totalPulled =
      result.customers.pulled + result.vendors.pulled + result.items.pulled;
    result.totalPushed =
      result.customers.pushed + result.vendors.pushed + result.items.pushed;

    logger.info(
      `[COMPLETE] Backfill finished. Pulled: ${result.totalPulled}, Pushed: ${result.totalPushed}`
    );

    return result;
  },
});
