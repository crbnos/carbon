/**
 * Company-serialized Ramp sync coordinator.
 *
 * Each family remains its own durable `step.run`; the family modules own their
 * business workflows while this entry point preserves the deployed function id,
 * trigger, step ids, result shape, and failure-notification contract.
 */

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  createMappingService,
  ensureProviderSubscriptions,
  SpendProviderID
} from "@carbon/ee/accounting";
import {
  getRampIntegration,
  pushChartOfAccounts,
  pushCostCenters,
  pushProjects
} from "@carbon/ee/ramp.server";
import { trigger } from "@carbon/lib/trigger";
import { NotificationEvent } from "@carbon/notifications";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import { drainSyncOperations } from "./accounting-sync-operations";
import { syncRampBillPayments, syncRampBills } from "./ramp-sync-bill";
import {
  syncRampCashbacks,
  syncRampCharges,
  syncRampTransfers
} from "./ramp-sync-card";
import { countRampSyncFailures } from "./ramp-sync-observability";
import {
  loadRampOutboundCandidates,
  OUTBOUND_RECONCILE_BATCH_SIZE
} from "./ramp-sync-outbound";
import { syncRampReimbursements } from "./ramp-sync-reimbursement-family";
import { syncRampRepayments } from "./ramp-sync-repayment";
import type { RampSyncContext } from "./ramp-sync-shared";
import { reconcileEntities } from "./reconcile-executor";
import { resolveSyncProvider } from "./sync-provider";
import { loadIntegrationTopology } from "./topology";

export const rampSyncFunction = inngest.createFunction(
  {
    id: "ramp-sync",
    retries: 2,
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/ramp-sync" },
  async ({ event, step, runId }) => {
    const { companyId } = event.data;
    const client = getCarbonServiceRole();

    const integration = await getRampIntegration(client, companyId);
    if (!integration) {
      return { companyId, skipped: "ramp not installed/active" };
    }
    const { client: ramp, metadata } = integration;

    const company = await client
      .from("company")
      .select("companyGroupId, baseCurrencyCode")
      .eq("id", companyId)
      .single();
    if (
      company.error ||
      !company.data?.companyGroupId ||
      !company.data.baseCurrencyCode
    ) {
      throw new Error(
        `Ramp sync cannot resolve company accounting scope: ${
          company.error?.message ?? "company group or base currency is missing"
        }`
      );
    }
    const integrationRow = await client
      .from("companyIntegration")
      .select("updatedBy, updatedAt")
      .eq("id", "ramp")
      .eq("companyId", companyId)
      .maybeSingle();

    const jobDb = getJobDatabaseClient(5);
    const ctx: RampSyncContext = {
      client,
      db: jobDb,
      mapping: createMappingService(jobDb, companyId),
      companyId,
      metadata,
      baseCurrency: company.data.baseCurrencyCode,
      companyGroupId: company.data.companyGroupId,
      decimalsCache: new Map(),
      exchangeRateCache: new Map(),
      createdBy: integrationRow.data?.updatedBy ?? "system",
      trigger: event.data.reason === "webhook" ? "webhook" : "event"
    };
    const cardLiabilityAccountId = metadata.cardLiabilityAccountId;
    const entityId = metadata.entityId;

    // Self-healing, mirroring the accounting outbound sweep: an install that
    // predates the event-engine move — or one whose rows were lost — gets its
    // SYNC subscriptions converged here rather than only in the install hook.
    await step.run("ramp-subscriptions", () =>
      ensureProviderSubscriptions(client, companyId, SpendProviderID.RAMP)
    );

    const coaResult = await step.run("ramp-chart-of-accounts", async () => {
      try {
        const { created, updated } = await pushChartOfAccounts(
          client,
          companyId
        );
        return { created, updated, failed: 0 };
      } catch (err) {
        console.error(
          `[RAMP SYNC] ${companyId}: chart-of-accounts push failed`,
          err
        );
        return {
          created: 0,
          updated: 0,
          failed: 1,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    });

    const costCenterResult = await step.run("ramp-cost-centers", async () => {
      try {
        const { created, renamed, hidden, shown } = await pushCostCenters(
          client,
          companyId
        );
        return { created, renamed, hidden, shown, failed: 0 };
      } catch (err) {
        console.error(`[RAMP SYNC] ${companyId}: cost-center push failed`, err);
        return {
          created: 0,
          renamed: 0,
          hidden: 0,
          shown: 0,
          failed: 1,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    });

    const projectResult = await step.run("ramp-projects", async () => {
      try {
        const { created, renamed, hidden, shown } = await pushProjects(
          client,
          companyId
        );
        return { created, renamed, hidden, shown, failed: 0 };
      } catch (err) {
        console.error(`[RAMP SYNC] ${companyId}: project push failed`, err);
        return {
          created: 0,
          renamed: 0,
          hidden: 0,
          shown: 0,
          failed: 1,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    });

    // Outbound correctness, and the other half of `ramp-subscriptions` above.
    // Converging the subscriptions only fixes the NEXT event: a purchase order
    // released or an invoice posted while the rows were missing produced no SYNC
    // event, so no ledger operation exists and nothing else would ever look for
    // it — the accounting outbound sweep walks `ProviderID` only, so it never
    // reaches Ramp. This is the same convergence-then-sweep the accounting sweep
    // performs, in the same order and over the same window
    // (`SWEEP_LOOKBACK_DAYS`); history older than that is a backfill's job, not
    // a silent mass-push.
    //
    // It runs AFTER the coding-master pushes on purpose: a bill pushed before
    // its accounts and cost centers exist in Ramp arrives uncoded.
    const outboundResult = await step.run(
      "ramp-outbound-reconcile",
      async () => {
        try {
          // Through `resolveSyncProvider` rather than `new RampProvider` so the
          // syncer registration side-effect import and the push-only coding
          // identity resolve exactly as they do on the event path.
          const resolved = await resolveSyncProvider(
            client,
            companyId,
            SpendProviderID.RAMP
          );
          if (!resolved) {
            return {
              purchaseOrders: 0,
              invoices: 0,
              enqueued: 0,
              failed: 0,
              skippedReasons: ["ramp provider could not be resolved"]
            };
          }

          const topology = await loadIntegrationTopology(client, companyId);
          const { refs, scanned, skippedReasons } =
            await loadRampOutboundCandidates({
              client,
              companyId,
              provider: resolved.provider
            });

          let enqueued = 0;
          for (
            let start = 0;
            start < refs.length;
            start += OUTBOUND_RECONCILE_BATCH_SIZE
          ) {
            const summary = await reconcileEntities({
              client,
              database: jobDb,
              companyId,
              providerId: SpendProviderID.RAMP,
              integrationMetadata: resolved.metadata,
              topology,
              provider: resolved.provider,
              createdBy: ctx.createdBy,
              scope: runId,
              refs: refs.slice(start, start + OUTBOUND_RECONCILE_BATCH_SIZE)
            });
            enqueued += summary.enqueued;
          }

          const drain = await drainSyncOperations({
            client,
            database: jobDb,
            companyId,
            integration: SpendProviderID.RAMP,
            provider: resolved.provider,
            integrationMetadata: resolved.metadata
          });

          return {
            ...scanned,
            enqueued,
            failed: drain.failed,
            skippedReasons
          };
        } catch (err) {
          console.error(
            `[RAMP SYNC] ${companyId}: outbound reconcile failed`,
            err
          );
          return {
            purchaseOrders: 0,
            invoices: 0,
            enqueued: 0,
            failed: 1,
            skippedReasons: [],
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }
    );

    const cardResult = await step.run("ramp-charges", () =>
      syncRampCharges(ctx, ramp, entityId, cardLiabilityAccountId)
    );
    const transferResult = await step.run("ramp-transfers", () =>
      syncRampTransfers(ctx, ramp, entityId, cardLiabilityAccountId)
    );
    const cashbackResult = await step.run("ramp-cashbacks", () =>
      syncRampCashbacks(ctx, ramp, entityId, cardLiabilityAccountId)
    );
    const billResult = await step.run("ramp-bills", () =>
      syncRampBills(ctx, ramp, entityId)
    );
    const billPaymentResult = await step.run("ramp-bill-payments", () =>
      syncRampBillPayments(ctx, ramp, entityId)
    );
    const reimbursementResult = await step.run("ramp-reimbursements", () =>
      syncRampReimbursements(ctx, ramp, entityId)
    );
    const repaymentResult = await step.run("ramp-repayments", () =>
      syncRampRepayments(
        ctx,
        ramp,
        entityId,
        cardLiabilityAccountId,
        integrationRow.data?.updatedAt
      )
    );

    const totalFailed = countRampSyncFailures([
      coaResult,
      costCenterResult,
      projectResult,
      outboundResult,
      cardResult,
      transferResult,
      cashbackResult,
      billResult,
      billPaymentResult,
      reimbursementResult,
      repaymentResult
    ]);

    if (totalFailed > 0) {
      await step.run("ramp-notify-failures", async () => {
        const recipientId = integrationRow.data?.updatedBy;
        if (!recipientId || recipientId === "system") {
          return { notified: false };
        }
        try {
          await trigger("notify", {
            event: NotificationEvent.IntegrationSync,
            companyId,
            documentId: "ramp",
            title: "Ramp sync needs attention",
            body: `${totalFailed} issue(s) need attention — review the Accounting tab in Ramp`,
            recipient: { type: "user", userId: recipientId }
          });
        } catch (notifyError) {
          console.error(
            `[RAMP SYNC] ${companyId}: failed to send sync-failure notification`,
            notifyError
          );
          return { notified: false };
        }
        return { notified: true };
      });
    }

    return {
      companyId,
      chartOfAccounts: coaResult,
      costCenters: costCenterResult,
      projects: projectResult,
      outbound: outboundResult,
      card: cardResult,
      transfers: transferResult,
      cashbacks: cashbackResult,
      bills: billResult,
      billPayments: billPaymentResult,
      reimbursements: reimbursementResult,
      repayments: repaymentResult
    };
  }
);
