/**
 * Function to sync entities between accounting providers and Carbon.
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
 * Every requested sync routes through the "accountingSyncOperation" ledger:
 * an enqueue step records one operation per entity + direction (re-triggers
 * are absorbed into the live row, and event/webhook triggers respect the 60s
 * completed-row cooldown inside the operations service — the mapping-table
 * cooldown check that used to live here), then a drain step claims Pending
 * operations and runs the entity syncers.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import {
  type AccountingEntityType,
  AccountingSyncSchema,
  createMappingService,
  getAccountingIntegration,
  getProviderIntegration,
  type SyncOperationTrigger
} from "@carbon/ee/accounting";
import { getLogger } from "@carbon/logger";
import { groupBy } from "@carbon/utils";
import { PostgresDriver } from "kysely";
import { inngest } from "../../client";
import {
  type DrainSummary,
  drainSyncOperations,
  enqueueSyncOperations,
  getSyncOperationActor,
  type SyncOperationRequest
} from "./accounting-sync-operations";

const log = getLogger("jobs", "sync-external-accounting");

const PayloadSchema = AccountingSyncSchema.extend({
  syncDirection: AccountingSyncSchema.shape.syncDirection
});

/**
 * Map the payload's syncType onto the ledger trigger: webhooks keep their
 * own trigger; scheduled/trigger syncs are machine re-triggers and enqueue
 * as "event". Both trigger kinds respect the completed-row cooldown
 * enforced inside enqueueSyncOperation.
 */
function getLedgerTrigger(
  syncType: "webhook" | "scheduled" | "trigger"
): SyncOperationTrigger {
  return syncType === "webhook" ? "webhook" : "event";
}

export const syncExternalAccountingFunction = inngest.createFunction(
  { id: "sync-external-accounting", retries: 1 },
  { event: "carbon/sync-external-accounting" },
  async ({ event, step, runId }) => {
    const payload = PayloadSchema.parse(event.data);

    const client = getCarbonServiceRole();

    // Scopes the ledger idempotency keys to this delivery: Inngest retries
    // reuse the same event id (absorbed), later deliveries get fresh keys
    const enqueueScope = event.id ?? runId;

    // NOTE: the pool from getPostgresConnectionPool is a process-lifetime
    // singleton (see lib/postgres) — do NOT end it per invocation.
    const pool = getPostgresConnectionPool(10);
    const kysely = getPostgresClient(pool, PostgresDriver);

    // Step 1: resolve each entity's effective direction and enqueue one
    // ledger operation per entity + direction
    type EnqueueStepSummary = {
      enqueued: number;
      cooldownSkipped: number;
      disabled: string[];
      errors: { entityId: string; error: string }[];
    };

    const enqueueSummary = (await step.run(
      "enqueue-sync-operations",
      async () => {
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

        const mappingService = createMappingService(kysely, payload.companyId);

        const requests: SyncOperationRequest[] = [];
        const disabled: string[] = [];

        const group = groupBy(payload.entities, (e) => e.entityType);

        for (const [entityType, entities] of Object.entries(group)) {
          const type = entityType as AccountingEntityType;
          const entityConfig = provider.getSyncConfig(type);

          if (!entityConfig?.enabled) {
            log.info(`Sync disabled for ${entityType}, skipping`);
            disabled.push(entityType);
            continue;
          }

          // Determine the effective sync direction
          const effectiveDirection =
            payload.syncDirection === "two-way"
              ? entityConfig.direction // Use the entity's configured direction
              : payload.syncDirection;

          for (const entity of entities) {
            if (effectiveDirection === "push-to-accounting") {
              requests.push({
                entityType: type,
                entityId: entity.entityId,
                direction: "push-to-accounting"
              });
            } else if (effectiveDirection === "pull-from-accounting") {
              requests.push({
                entityType: type,
                entityId: entity.entityId,
                direction: "pull-from-accounting"
              });
            } else {
              // Two-way: determine the direction per entity based on
              // whether a mapping exists and which system owns the record
              const mapping = await mappingService.getByEntity(
                type,
                entity.entityId,
                provider.id
              );

              if (mapping && entityConfig.owner === "accounting") {
                requests.push({
                  entityType: type,
                  entityId: mapping.externalId,
                  direction: "pull-from-accounting"
                });
              } else {
                // No mapping exists (likely a Carbon-only entity that
                // needs pushing) or Carbon owns the record
                requests.push({
                  entityType: type,
                  entityId: entity.entityId,
                  direction: "push-to-accounting"
                });
              }
            }
          }
        }

        const outcomes = await enqueueSyncOperations(client, {
          companyId: payload.companyId,
          integration: payload.provider,
          trigger: getLedgerTrigger(payload.syncType),
          createdBy: getSyncOperationActor(integration),
          scope: enqueueScope,
          requests
        });

        const summary: EnqueueStepSummary = {
          enqueued: 0,
          cooldownSkipped: 0,
          disabled,
          errors: []
        };

        for (const outcome of outcomes) {
          if (outcome.outcome === "enqueued") {
            summary.enqueued++;
          } else if (outcome.outcome === "cooldown") {
            summary.cooldownSkipped++;
          } else {
            summary.errors.push({
              entityId: outcome.entityId,
              error: outcome.error ?? "Failed to enqueue sync operation"
            });
          }
        }

        return summary;
      }
    )) as EnqueueStepSummary;

    log.info("Enqueued sync operations", { enqueueSummary });

    // Step 2: drain — claim Pending operations (including UI retries and
    // stale In Flight rows) and run the entity syncers. A throw re-runs
    // the step; claim/complete are idempotent so retries cannot duplicate
    // work.
    const drainSummary = (await step.run("drain-sync-operations", async () => {
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

      return drainSyncOperations({
        client,
        database: kysely,
        companyId: payload.companyId,
        integration: payload.provider,
        provider,
        integrationMetadata: integration.metadata
      });
    })) as DrainSummary;

    for (const group of drainSummary.groups) {
      log.info("Sync result", {
        entityType: group.entityType,
        direction: group.direction,
        result: group.result
      });
    }

    return {
      success: drainSummary.groups.map((g) => g.result),
      enqueue: enqueueSummary,
      drain: {
        claimed: drainSummary.claimed,
        completed: drainSummary.completed,
        failed: drainSummary.failed,
        skipped: drainSummary.skipped
      }
    };
  }
);
