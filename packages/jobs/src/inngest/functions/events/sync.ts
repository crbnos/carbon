/**
 * SYNC event handler — v5 reconciler shape
 * (.ai/specs/2026-08-12-accounting-sync-reconciler-unification.md, D3).
 *
 * Events are HINTS, not decisions: a DB write on a subscribed table means
 * "reconcile this entity now". The handler maps table → entity type,
 * dedupes the batch into refs, and hands them to the SAME
 * `reconcileEntities` executor the outbound sweep uses — the decision of
 * whether anything should happen lives in ONE place
 * (computeReconcileDecision), derived from current state, never from the
 * event's old/new delta.
 *
 * Deleted with v5 (their failure classes are unrepresentable now):
 * - the completed-row cooldown on this path (an unchanged entity reconciles
 *   to nothing by state; a changed one enqueues immediately);
 * - `isStatusTransitionEvent` routing (no cooldown to bypass);
 * - the per-table journal/payment decision branches (state-shaped in D1).
 *
 * DELETEs remain logged-and-skipped (DELETE sync is unimplemented; a
 * deleted row also reconciles to nothing by construction).
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import { EventSchema } from "@carbon/database/event";
import {
  getAccountingIntegration,
  getProviderIntegration,
  ProviderID
} from "@carbon/ee/accounting";
import { groupBy } from "@carbon/utils";
import { PostgresDriver } from "kysely";
import { z } from "zod";
import { inngest } from "../../client";
import {
  type DrainSummary,
  drainSyncOperations,
  getSyncOperationActor
} from "../integrations/accounting-sync-operations";
import type { ReconcileRef } from "../integrations/reconcile";
import {
  type ReconcileSummary,
  reconcileEntities
} from "../integrations/reconcile-executor";
import { getEntityTypeFromTable } from "./sync-tables";

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

export const syncFunction = inngest.createFunction(
  {
    id: "event-handler-sync",
    retries: 3
  },
  { event: "carbon/event-sync" },
  async ({ event, step, runId, logger }) => {
    const payload = SyncPayloadSchema.parse(event.data);

    logger.info(`Processing ${payload.records.length} sync events`);

    // Scopes the ledger idempotency keys to this delivery: Inngest retries
    // reuse the same event id (absorbed), later deliveries get fresh keys
    const reconcileScope = event.id ?? runId;

    const results = {
      reconciled: [] as Array<
        { companyId: string; provider: string } & ReconcileSummary
      >,
      drains: [] as Array<{
        companyId: string;
        provider: string;
        drain: DrainSummary["groups"];
      }>,
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

    // NOTE: the pool from getPostgresConnectionPool is a process-lifetime
    // singleton (see lib/postgres) — do NOT end it per invocation.
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

      // Step 1: reconcile the hinted entities (checkpointed so a retry
      // replays the outcome; enqueue/terminal writes are idempotent by
      // ledger key, so re-runs cannot duplicate work)
      type ReconcileStepSummary = {
        aborted: boolean;
        summary: ReconcileSummary | null;
        failed: { recordId: string; error: string }[];
        skipped: { recordId: string; reason: string }[];
      };

      const reconcileSummary = (await step.run(
        `reconcile-${companyId}-${provider}`,
        async () => {
          const stepSummary: ReconcileStepSummary = {
            aborted: false,
            summary: null,
            failed: [],
            skipped: []
          };

          try {
            const integration = await getAccountingIntegration(
              client,
              companyId,
              provider as ProviderID
            );

            const seen = new Set<string>();
            const refs: ReconcileRef[] = [];
            for (const r of records) {
              const entityType = getEntityTypeFromTable(r.event.table);
              if (!entityType) {
                stepSummary.skipped.push({
                  recordId: r.event.recordId,
                  reason: `Table '${r.event.table}' has no entity mapping`
                });
                continue;
              }
              if (r.event.operation === "DELETE") {
                stepSummary.skipped.push({
                  recordId: r.event.recordId,
                  reason: "DELETE operations not yet implemented"
                });
                continue;
              }
              if (
                r.event.operation !== "INSERT" &&
                r.event.operation !== "UPDATE"
              ) {
                continue;
              }
              const refKey = `${entityType}:${r.event.recordId}`;
              if (seen.has(refKey)) continue;
              seen.add(refKey);
              refs.push({
                entityType: entityType as ReconcileRef["entityType"],
                entityId: r.event.recordId
              });
            }

            stepSummary.summary = await reconcileEntities({
              client,
              database: kysely,
              companyId,
              providerId: provider,
              integrationMetadata: integration.metadata,
              createdBy: getSyncOperationActor(integration),
              scope: reconcileScope,
              refs
            });
          } catch (error) {
            logger.error(`Failed to reconcile sync events for ${key}`, {
              error
            });
            stepSummary.aborted = true;
            for (const r of records) {
              stepSummary.failed.push({
                recordId: r.event.recordId,
                error: error instanceof Error ? error.message : "Unknown error"
              });
            }
          }

          return stepSummary;
        }
      )) as ReconcileStepSummary;

      results.failed.push(...reconcileSummary.failed);
      results.skipped.push(...reconcileSummary.skipped);
      if (reconcileSummary.summary) {
        results.reconciled.push({
          companyId,
          provider,
          ...reconcileSummary.summary
        });
      }

      // The integration could not be resolved — there is nothing to drain
      // for this group (matches the pre-ledger behavior of recording the
      // failure without failing the run)
      if (reconcileSummary.aborted) continue;

      // Step 2: drain — claim Pending operations (including UI retries and
      // stale In Flight rows) and run the entity syncers. A throw re-runs
      // the step; claim/complete are idempotent so retries cannot
      // duplicate work.
      const drainSummary = (await step.run(
        `drain-${companyId}-${provider}`,
        async () => {
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

          return drainSyncOperations({
            client,
            database: kysely,
            companyId,
            integration: provider,
            provider: providerInstance,
            integrationMetadata: integration.metadata
          });
        }
      )) as DrainSummary;

      for (const group of drainSummary.groups) {
        logger.info("Sync result", {
          entityType: group.entityType,
          direction: group.direction,
          result: group.result
        });
      }

      results.drains.push({
        companyId,
        provider,
        drain: drainSummary.groups
      });
    }

    logger.info("Sync function completed", {
      reconciled: results.reconciled.length,
      failedCount: results.failed.length,
      skippedCount: results.skipped.length
    });

    return results;
  }
);
