import { getCarbonServiceRole } from "@carbon/auth";
import {
  getPostgresClient,
  getPostgresConnectionPool,
} from "@carbon/database/client";
import { EventSchema } from "@carbon/database/event";
import {
  AccountingEntityType,
  BatchSyncResult,
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  RatelimitError,
  SyncFactory,
} from "@carbon/ee/accounting";
import { groupBy } from "@carbon/utils";
import { logger, task, wait } from "@trigger.dev/sdk";
import { PostgresDriver } from "kysely";
import { z } from "zod";

const SyncRecordSchema = z.object({
  event: EventSchema,
  companyId: z.string(),
  handlerConfig: z.object({
    provider: z.nativeEnum(ProviderID),
  }),
});

const SyncPayloadSchema = z.object({
  records: z.array(SyncRecordSchema),
});

export type SyncPayload = z.infer<typeof SyncPayloadSchema>;

// Map database table names to accounting entity types
const TABLE_TO_ENTITY_MAP: Partial<Record<string, AccountingEntityType>> = {
  customer: "customer",
  supplier: "vendor",
  item: "item",
  purchaseOrder: "purchaseOrder",
  purchaseInvoice: "bill",
  salesInvoice: "invoice",
};

function getEntityTypeFromTable(table: string): AccountingEntityType | null {
  return TABLE_TO_ENTITY_MAP[table] ?? null;
}

function getDeduplicatedIds<T>(
  records: T[],
  getId: (r: T) => string
): string[] {
  return [...new Set(records.map(getId))];
}

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

export const syncTask = task({
  id: "event-handler-sync",
  maxDuration: 5 * 60 * 1000, // 5 minutes
  run: async (input: unknown) => {
    const payload = SyncPayloadSchema.parse(input);

    logger.info(`Processing ${payload.records.length} sync events`);

    const results = {
      success: [] as BatchSyncResult[],
      failed: [] as { recordId: string; error: string }[],
      skipped: [] as { recordId: string; reason: string }[],
    };

    // Group records by (companyId, provider) for efficient batch processing
    const byCompanyProvider = groupBy(payload.records, (r) => {
      const companyId = r.companyId;
      const provider = r.handlerConfig.provider;
      return `${companyId}:${provider}`;
    });

    const pool = getPostgresConnectionPool(10);
    const kysely = getPostgresClient(pool, PostgresDriver);
    const client = getCarbonServiceRole();

    try {
      for (const [key, records] of Object.entries(byCompanyProvider)) {
        const [companyId, provider] = key.split(":");

        if (!companyId || companyId === "undefined" || !provider) {
          for (const r of records) {
            results.skipped.push({
              recordId: r.event.recordId,
              reason: "Missing companyId or provider",
            });
          }
          continue;
        }

        try {
          // Get integration and provider instance
          const integration = await getAccountingIntegration(
            client,
            companyId,
            provider as ProviderID
          );

          const providerInstance = getProviderIntegration(
            client,
            companyId,
            provider as ProviderID,
            integration.metadata
          );

          // Group by entity type
          const byEntityType = groupBy(records, (r) => {
            const entityType = getEntityTypeFromTable(r.event.table);
            return entityType ?? "unknown";
          });

          for (const [entityType, entityRecords] of Object.entries(
            byEntityType
          )) {
            if (entityType === "unknown") {
              for (const r of entityRecords) {
                results.skipped.push({
                  recordId: r.event.recordId,
                  reason: `Table '${r.event.table}' has no entity mapping`,
                });
              }
              continue;
            }

            // Separate by operation
            const inserts = entityRecords.filter(
              (r) => r.event.operation === "INSERT"
            );
            const updates = entityRecords.filter(
              (r) => r.event.operation === "UPDATE"
            );
            const deletes = entityRecords.filter(
              (r) => r.event.operation === "DELETE"
            );

            const syncer = SyncFactory.getSyncer({
              database: kysely,
              companyId,
              provider: providerInstance,
              config: providerInstance.getSyncConfig(
                entityType as AccountingEntityType
              ),
              entityType: entityType as AccountingEntityType,
            });

            // Process INSERTs and UPDATEs (push to accounting)
            const toSync = [...inserts, ...updates];
            if (toSync.length > 0) {
              const entityIds = getDeduplicatedIds(
                toSync,
                (r) => r.event.recordId
              );

              logger.info(
                `Pushing ${entityIds.length} ${entityType} entities to accounting`
              );

              const result = await withRateLimitRetry(
                () => syncer.pushBatchToAccounting(entityIds),
                `pushBatchToAccounting ${entityType}`
              );

              logger.info("Sync result:", { entityType, result });

              results.success.push(result);
            }

            // Handle DELETEs (log for now, not yet implemented in syncers)
            for (const del of deletes) {
              results.skipped.push({
                recordId: del.event.recordId,
                reason: "DELETE operations not yet implemented",
              });
            }
          }
        } catch (error) {
          logger.error(`Failed to process sync for ${key}:`, error);
          for (const r of records) {
            results.failed.push({
              recordId: r.event.recordId,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }
      }
    } catch (error) {
      logger.error("Sync task failed:", error);
    } finally {
      await pool.end();
    }

    logger.info("Sync task completed", {
      successCount: results.success.reduce((acc, r) => acc + r.successCount, 0),
      failedCount: results.failed.length,
      skippedCount: results.skipped.length,
    });

    return results;
  },
});
