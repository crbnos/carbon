import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import { EventSchema } from "@carbon/database/event";
import {
  type AccountingEntityType,
  type BatchSyncResult,
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID,
  RatelimitError,
  SyncFactory
} from "@carbon/ee/accounting";
import { groupBy, pluckUnique } from "@carbon/utils";
import { PostgresDriver } from "kysely";
import { z } from "zod";
import { inngest } from "../../client";

const SyncRecordSchema = z.object({
  event: EventSchema,
  companyId: z.string(),
  handlerConfig: z.object({
    provider: z.nativeEnum(ProviderID)
  })
});

const SyncPayloadSchema = z.object({
  records: z.array(SyncRecordSchema)
});

export type SyncPayload = z.infer<typeof SyncPayloadSchema>;

// Map database table names to accounting entity types
const TABLE_TO_ENTITY_MAP: Partial<Record<string, AccountingEntityType>> = {
  customer: "customer",
  supplier: "vendor",
  item: "item",
  purchaseOrder: "purchaseOrder",
  purchaseInvoice: "bill",
  salesInvoice: "invoice"
};

function getEntityTypeFromTable(table: string): AccountingEntityType | null {
  return TABLE_TO_ENTITY_MAP[table] ?? null;
}

export const syncFunction = inngest.createFunction(
  {
    id: "event-handler-sync",
    retries: 3
  },
  { event: "carbon/event-sync" },
  async ({ event, step, logger }) => {
    const payload = SyncPayloadSchema.parse(event.data);

    logger.info(`Processing ${payload.records.length} sync events`);

    const results = {
      success: [] as BatchSyncResult[],
      failed: [] as { recordId: string; error: string }[],
      skipped: [] as { recordId: string; reason: string }[]
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

    for (const [key, records] of Object.entries(byCompanyProvider)) {
      const [companyId, provider] = key.split(":");

      if (!companyId || companyId === "undefined" || !provider) {
        for (const r of records) {
          results.skipped.push({
            recordId: r.event.recordId,
            reason: "Missing companyId or provider"
          });
        }
        continue;
      }

      // Process each company-provider group as a step for checkpointing
      type GroupResults = {
        success: BatchSyncResult[];
        failed: { recordId: string; error: string }[];
        skipped: { recordId: string; reason: string }[];
      };

      const groupResult = (await step.run(
        `sync-${companyId}-${provider}`,
        async () => {
          const groupResults: GroupResults = {
            success: [],
            failed: [],
            skipped: []
          };

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
                  groupResults.skipped.push({
                    recordId: r.event.recordId,
                    reason: `Table '${r.event.table}' has no entity mapping`
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
                entityType: entityType as AccountingEntityType
              });

              // Process INSERTs and UPDATEs (push to accounting)
              const toSync = [...inserts, ...updates];
              if (toSync.length > 0) {
                const entityIds = pluckUnique(toSync, (r) => r.event.recordId);

                logger.info(
                  `Pushing ${entityIds.length} ${entityType} entities to accounting`
                );

                // Handle rate limiting with retry
                let result: BatchSyncResult;
                try {
                  result = await syncer.pushBatchToAccounting(entityIds);
                } catch (error) {
                  if (error instanceof RatelimitError) {
                    const { retryAfterSeconds } = error.rateLimitInfo;
                    logger.warn(
                      `Hit rate limit, will retry after ${retryAfterSeconds}s`
                    );
                    // Let inngest handle the retry by throwing
                    throw error;
                  }
                  throw error;
                }

                logger.info("Sync result", { entityType, result });
                groupResults.success.push(result);
              }

              // Handle DELETEs (log for now, not yet implemented in syncers)
              for (const del of deletes) {
                groupResults.skipped.push({
                  recordId: del.event.recordId,
                  reason: "DELETE operations not yet implemented"
                });
              }
            }
          } catch (error) {
            logger.error(`Failed to process sync for ${key}`, { error });
            for (const r of records) {
              groupResults.failed.push({
                recordId: r.event.recordId,
                error: error instanceof Error ? error.message : "Unknown error"
              });
            }
          }

          return groupResults;
        }
      )) as GroupResults;

      results.success.push(...groupResult.success);
      results.failed.push(...groupResult.failed);
      results.skipped.push(...groupResult.skipped);
    }

    logger.info("Sync function completed", {
      successCount: results.success.reduce((acc, r) => acc + r.successCount, 0),
      failedCount: results.failed.length,
      skippedCount: results.skipped.length
    });

    return results;
  }
);
