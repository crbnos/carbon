/**
 * Task to sync entities between accounting providers and Carbon.
 *
 * Handles three sync directions:
 * - "push-to-accounting": Push Carbon entities to the accounting provider
 * - "pull-from-accounting": Pull entities from the accounting provider to Carbon
 * - "two-way": Intelligently sync based on entity state and config
 *
 * For "two-way" sync:
 * - If entity has local ID but no remote mapping -> Push to accounting
 * - If entity has remote ID but no local mapping -> Pull from accounting
 * - If entity has both -> Use the entity config's "owner" to determine direction
 *
 * Includes cooldown protection to prevent redundant syncs of the same entity.
 */
import { getCarbonServiceRole } from "@carbon/auth";
import {
  getPostgresClient,
  getPostgresConnectionPool,
} from "@carbon/database/client";
import {
  AccountingEntity,
  BatchSyncResult,
  createMappingService,
  getAccountingIntegration,
  getProviderIntegration,
  SyncFactory,
  type AccountingEntityType,
  type SyncResult,
} from "@carbon/ee/accounting";

import { groupBy } from "@carbon/utils";
import { logger, task } from "@trigger.dev/sdk";
import { PostgresDriver } from "kysely";
import z from "zod";
import { AccountingSyncSchema } from "../../ee/src/accounting/core/models.ts";

// Cooldown period in milliseconds to prevent redundant syncs
// If an entity was synced within this period, skip syncing it again
const SYNC_COOLDOWN_MS = 60000; // 1 minute

const PayloadSchema = AccountingSyncSchema.extend({
  syncDirection: AccountingSyncSchema.shape.syncDirection,
});

type Payload = z.infer<typeof PayloadSchema>;

export const syncExternalAccountingTask = task({
  id: "sync-external-accounting",
  maxDuration: 5 * 60 * 1000, // 5 minutes
  run: async (input: Payload) => {
    const payload = PayloadSchema.parse(input);

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
    );

    const pool = getPostgresConnectionPool(10);
    const kysely = getPostgresClient(pool, PostgresDriver);
    const mappingService = createMappingService(kysely, payload.companyId);

    const results = {
      success: [] as BatchSyncResult[],
      failed: [] as { entities: AccountingEntity[]; error: string }[],
    };

    try {
      const group = groupBy(payload.entities, (e) => e.entityType);

      for (const [entityType, entities] of Object.entries(group)) {
        const type = entityType as AccountingEntityType;
        const entityConfig = provider.getSyncConfig(type);

        if (!entityConfig?.enabled) {
          logger.info(`Sync disabled for ${entityType}, skipping`);
          continue;
        }

        try {
          logger.info(
            `Starting sync for ${entities.length} ${entityType} entities`,
            {
              direction: input.syncDirection,
              configDirection: entityConfig.direction,
            }
          );

          const syncer = SyncFactory.getSyncer({
            database: kysely,
            companyId: payload.companyId,
            provider,
            config: entityConfig,
            entityType: type,
          });

          if (entities.length === 0) {
            logger.info(`No entities to sync for type ${entityType}`);
            continue;
          }

          // Determine the effective sync direction
          const effectiveDirection =
            input.syncDirection === "two-way"
              ? entityConfig.direction // Use the entity's configured direction
              : input.syncDirection;

          if (effectiveDirection === "push-to-accounting") {
            // Filter out entities that were synced recently (cooldown)
            const entitiesToSync = await filterByCooldown(
              mappingService,
              type,
              entities,
              provider.id
            );

            if (entitiesToSync.length === 0) {
              logger.info(
                `All ${entityType} entities were synced recently, skipping`
              );
              continue;
            }

            const result = await syncer.pushBatchToAccounting(
              entitiesToSync.map((e) => e.entityId)
            );

            logger.info("Push sync result:", { entityType, result });
            results.success.push(result);
          } else if (effectiveDirection === "pull-from-accounting") {
            // Filter out entities that were synced recently (cooldown)
            const entitiesToSync = await filterByCooldown(
              mappingService,
              type,
              entities,
              provider.id
            );

            if (entitiesToSync.length === 0) {
              logger.info(
                `All ${entityType} entities were synced recently, skipping`
              );
              continue;
            }

            const result = await syncer.pullBatchFromAccounting(
              entitiesToSync.map((e) => e.entityId)
            );

            logger.info("Pull sync result:", { entityType, result });
            results.success.push(result);
          } else if (effectiveDirection === "two-way") {
            // For two-way sync, we need to determine direction per-entity
            // based on whether it has a local ID, remote ID, or both
            const twoWayResult = await handleTwoWaySync(
              syncer,
              mappingService,
              type,
              entities,
              provider.id,
              entityConfig.owner
            );

            logger.info("Two-way sync result:", {
              entityType,
              ...twoWayResult,
            });
            results.success.push(twoWayResult.pushed);
            results.success.push(twoWayResult.pulled);
          }
        } catch (error) {
          console.error(`Failed to process ${entityType} entities:`, error);

          results.failed.push({
            entities: entities,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    } catch (error) {
      logger.error("Sync task failed:", error);
    } finally {
      await pool.end();
    }

    return results;
  },
});

/**
 * Filter entities that were synced within the cooldown period.
 * Returns only entities that are eligible for syncing.
 */
async function filterByCooldown(
  mappingService: ReturnType<typeof createMappingService>,
  entityType: AccountingEntityType,
  entities: AccountingEntity[],
  integration: string
): Promise<AccountingEntity[]> {
  const now = Date.now();
  const eligibleEntities: AccountingEntity[] = [];

  for (const entity of entities) {
    const mapping = await mappingService.getByEntity(
      entityType,
      entity.entityId,
      integration
    );

    // If no mapping exists or lastSyncedAt is old enough, include it
    if (!mapping?.lastSyncedAt) {
      eligibleEntities.push(entity);
      continue;
    }

    const lastSyncedAt = new Date(mapping.lastSyncedAt).getTime();
    if (now - lastSyncedAt > SYNC_COOLDOWN_MS) {
      eligibleEntities.push(entity);
    } else {
      logger.debug(
        `Skipping ${entityType} ${entity.entityId} - synced ${
          now - lastSyncedAt
        }ms ago`
      );
    }
  }

  return eligibleEntities;
}

/**
 * Handle two-way sync by determining the appropriate direction for each entity.
 *
 * Logic:
 * - If entity has entityId (Carbon ID) but no remote mapping -> Push to accounting
 * - If entity has entityId that is actually a remote ID (no local entity) -> Pull from accounting
 * - If entity has both local and remote -> Use "owner" config to determine winner
 */
async function handleTwoWaySync(
  syncer: ReturnType<typeof SyncFactory.getSyncer>,
  mappingService: ReturnType<typeof createMappingService>,
  entityType: AccountingEntityType,
  entities: AccountingEntity[],
  integration: string,
  owner: "carbon" | "accounting"
): Promise<{ pushed: BatchSyncResult; pulled: BatchSyncResult }> {
  const toPush: string[] = [];
  const toPull: string[] = [];
  const now = Date.now();

  for (const entity of entities) {
    // Check if this entity was synced recently
    const mapping = await mappingService.getByEntity(
      entityType,
      entity.entityId,
      integration
    );

    if (mapping?.lastSyncedAt) {
      const lastSyncedAt = new Date(mapping.lastSyncedAt).getTime();
      if (now - lastSyncedAt <= SYNC_COOLDOWN_MS) {
        logger.debug(
          `Skipping two-way sync for ${entityType} ${entity.entityId} - synced recently`
        );
        continue;
      }
    }

    if (mapping) {
      // Entity exists in both systems - use owner to determine direction
      if (owner === "carbon") {
        toPush.push(entity.entityId);
      } else {
        // owner === "accounting"
        toPull.push(mapping.externalId);
      }
    } else {
      // No mapping exists - this is likely a Carbon-only entity that needs pushing
      // Or it could be a remote ID that needs pulling
      // For now, assume entityId is a Carbon ID and push it
      toPush.push(entity.entityId);
    }
  }

  // Execute push and pull operations
  const pushResult =
    toPush.length > 0
      ? await syncer.pushBatchToAccounting(toPush)
      : { results: [], successCount: 0, errorCount: 0, skippedCount: 0 };

  const pullResult =
    toPull.length > 0
      ? await syncer.pullBatchFromAccounting(toPull)
      : { results: [], successCount: 0, errorCount: 0, skippedCount: 0 };

  return { pushed: pushResult, pulled: pullResult };
}
