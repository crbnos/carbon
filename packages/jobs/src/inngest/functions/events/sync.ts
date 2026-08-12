import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import { EventSchema } from "@carbon/database/event";
import {
  type BatchSyncResult,
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
  enqueueSyncOperations,
  getPaymentPushDecision,
  getSyncOperationActor,
  insertTerminalSyncOperations,
  isJournalEntryPostingEnabled,
  isStatusTransitionEvent,
  planJournalPostingOperation,
  type SyncOperationRequest,
  type TerminalSyncOperationRequest
} from "../integrations/accounting-sync-operations";
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
    const enqueueScope = event.id ?? runId;

    const results = {
      enqueued: 0,
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

      // Step 1: enqueue one ledger operation per INSERT/UPDATE record
      // (checkpointed so a retry replays the enqueue result)
      type EnqueueStepSummary = {
        enqueued: number;
        aborted: boolean;
        failed: { recordId: string; error: string }[];
        skipped: { recordId: string; reason: string }[];
      };

      const enqueueSummary = (await step.run(
        `enqueue-${companyId}-${provider}`,
        async () => {
          const stepSummary: EnqueueStepSummary = {
            enqueued: 0,
            aborted: false,
            failed: [],
            skipped: []
          };

          try {
            const integration = await getAccountingIntegration(
              client,
              companyId,
              provider as ProviderID
            );

            // Posting sync is opt-in per company: journal events enqueue
            // only when the resolved sync config enables journalEntry
            const journalEntryPostingEnabled = isJournalEntryPostingEnabled(
              integration.metadata
            );

            const requests: SyncOperationRequest[] = [];
            // Trigger "posting" bypasses the 60s completed-row cooldown
            // (the ledger trigger is per enqueue call, not per request).
            // It carries journal posting transitions AND generic-table
            // status transitions — a state change must never be dropped
            // by a cooldown that exists to absorb same-state edit bursts.
            const postingRequests: SyncOperationRequest[] = [];
            // Decision-time dispositions (Excluded/Warning) — recorded so
            // every posted journal is accounted for (spec I1)
            const terminalRequests: TerminalSyncOperationRequest[] = [];

            for (const r of records) {
              const entityType = getEntityTypeFromTable(r.event.table);

              if (!entityType) {
                stepSummary.skipped.push({
                  recordId: r.event.recordId,
                  reason: `Table '${r.event.table}' has no entity mapping`
                });
                continue;
              }

              // Journal rows enqueue when INSERTed born Posted (the post-*
              // edge functions never UPDATE from Draft; reversal inserts
              // skip via reversalOfId) or when an UPDATE transitions status
              // to Posted/Reversed — non-transition UPDATEs and DELETEs skip.
              // Posting events then route through the v3 policy decision:
              // push, or a recorded terminal disposition.
              if (entityType === "journalEntry") {
                if (!journalEntryPostingEnabled) {
                  stepSummary.skipped.push({
                    recordId: r.event.recordId,
                    reason:
                      "Posting sync (journalEntry) is disabled in the integration's sync config"
                  });
                  continue;
                }

                const plan = await planJournalPostingOperation({
                  client,
                  companyId,
                  event: r.event,
                  integrationMetadata: integration.metadata
                });

                if (plan.action === "skip") {
                  stepSummary.skipped.push({
                    recordId: r.event.recordId,
                    reason: plan.reason
                  });
                  continue;
                }

                if (plan.action === "push") {
                  postingRequests.push(plan.request);
                } else {
                  terminalRequests.push(plan.request);
                }
                continue;
              }

              // Payment rows push OUTBOUND (Phase G) only on a transition to
              // Posted/Voided — never on the generic INSERT/UPDATE path, which
              // would re-push on every Draft edit. The push syncer decides
              // per-record whether the payment is Carbon-born (push) or
              // provider-known (skip) via the payment mapping.
              if (entityType === "payment") {
                const decision = getPaymentPushDecision(r.event);
                if (decision.action === "skip") {
                  stepSummary.skipped.push({
                    recordId: r.event.recordId,
                    reason: decision.reason
                  });
                  continue;
                }
                requests.push({
                  entityType: "payment",
                  entityId: decision.entityId,
                  direction: "push-to-accounting"
                });
                continue;
              }

              // Handle DELETEs (log for now, not yet implemented in syncers)
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

              // INSERTs and UPDATEs push to accounting. Status
              // transitions ride the non-cooldown "posting" trigger so a
              // document posted within 60s of its previous sync (e.g.
              // created-then-posted) is never swallowed by the cooldown.
              const target = isStatusTransitionEvent(r.event)
                ? postingRequests
                : requests;
              target.push({
                entityType,
                entityId: r.event.recordId,
                direction: "push-to-accounting"
              });
            }

            const outcomes = [
              ...(await enqueueSyncOperations(client, {
                companyId,
                integration: provider,
                trigger: "event",
                createdBy: getSyncOperationActor(integration),
                scope: enqueueScope,
                requests
              })),
              ...(await enqueueSyncOperations(client, {
                companyId,
                integration: provider,
                trigger: "posting",
                createdBy: getSyncOperationActor(integration),
                scope: enqueueScope,
                requests: postingRequests
              })),
              ...(await insertTerminalSyncOperations(client, {
                companyId,
                integration: provider,
                trigger: "posting",
                createdBy: getSyncOperationActor(integration),
                scope: enqueueScope,
                requests: terminalRequests
              }))
            ];

            for (const outcome of outcomes) {
              if (outcome.outcome === "enqueued") {
                stepSummary.enqueued++;
              } else if (outcome.outcome === "cooldown") {
                stepSummary.skipped.push({
                  recordId: outcome.entityId,
                  reason: "Synced within the cooldown window"
                });
              } else {
                stepSummary.failed.push({
                  recordId: outcome.entityId,
                  error: outcome.error ?? "Failed to enqueue sync operation"
                });
              }
            }
          } catch (error) {
            logger.error(`Failed to enqueue sync operations for ${key}`, {
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
      )) as EnqueueStepSummary;

      results.enqueued += enqueueSummary.enqueued;
      results.failed.push(...enqueueSummary.failed);
      results.skipped.push(...enqueueSummary.skipped);

      // The integration could not be resolved — there is nothing to drain
      // for this group (matches the pre-ledger behavior of recording the
      // failure without failing the run)
      if (enqueueSummary.aborted) continue;

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

      results.success.push(...drainSummary.groups.map((g) => g.result));
    }

    logger.info("Sync function completed", {
      successCount: results.success.reduce((acc, r) => acc + r.successCount, 0),
      failedCount: results.failed.length,
      skippedCount: results.skipped.length
    });

    return results;
  }
);
