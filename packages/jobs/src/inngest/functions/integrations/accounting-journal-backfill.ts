/**
 * Journal posting-disposition backfill (spec I1 missed-event repair).
 *
 * Every posted journal since `postingSync.syncFromDate` must carry an operation
 * row: a pushable journal whose event was missed is enqueued, and a
 * policy-excluded one has its terminal disposition recorded. The outbound sweep
 * repairs the same thing continuously, but only inside its 7-day window — this
 * is what covers the history behind it, which is why it needs an explicit
 * `syncFromDate` and refuses to run without one (no silent mass-push of a
 * company's entire ledger).
 *
 * Extracted from `accounting-backfill`, where it ran as "phase 0" of a job
 * named for, triggered by, and otherwise entirely about master data — so the
 * only way to repair journal dispositions was to click a button labelled
 * "backfill contacts", and only on Xero, the one provider whose route fired
 * that job. It is provider-agnostic here and reachable on its own.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getAccountingIntegration,
  ProviderID,
  resolvePostingSyncSettings
} from "@carbon/ee/accounting";
import { getLogger } from "@carbon/logger";
import z from "zod";
import { inngest } from "../../client";
import {
  applyEffectivePostingState,
  enqueueSyncOperations,
  getSyncOperationActor,
  insertTerminalSyncOperations,
  isJournalEntryPostingEnabled,
  planJournalPostingOperation,
  type SyncOperationRequest,
  type TerminalSyncOperationRequest
} from "./accounting-sync-operations";
import { loadIntegrationTopology } from "./topology";

const log = getLogger("jobs", "accounting-journal-backfill");

const JournalBackfillPayloadSchema = z.object({
  companyId: z.string(),
  provider: z.nativeEnum(ProviderID)
});

export type AccountingJournalBackfillPayload = z.input<
  typeof JournalBackfillPayloadSchema
>;

export const accountingJournalBackfillFunction = inngest.createFunction(
  {
    id: "accounting-journal-backfill",
    retries: 3,
    // One at a time per company: two runs would page the same journals and
    // race on the same idempotency keys.
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/accounting-journal-backfill" },
  async ({ event, step, runId }) => {
    const payload = JournalBackfillPayloadSchema.parse(event.data);

    // Scopes the ledger idempotency keys to this run: a retried step
    // re-enqueues onto its own rows, while a fresh run is never blocked by the
    // Completed rows of the last one.
    const runScope = event.id ?? runId;

    return await step.run("backfill-journal-dispositions", async () => {
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

        // Once per phase, not per row: resolving ledger delegation reads the
        // company's integration rows.
        const effective = applyEffectivePostingState(
          phaseIntegration.metadata,
          await loadIntegrationTopology(phaseClient, payload.companyId)
        );

        for (const row of rows) {
          if (covered.has(row.id)) {
            summary.alreadyCovered++;
          } else {
            const plan = await planJournalPostingOperation({
              client: phaseClient,
              effective,
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
              integrationMetadata: phaseIntegration.metadata,
              providerId: phaseIntegration.id
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
              effective,
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
              integrationMetadata: phaseIntegration.metadata,
              providerId: phaseIntegration.id
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
          scope: runScope,
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
            scope: runScope,
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

      log.info("Journal disposition backfill complete", summary);
      return summary;
    });
  }
);
