/**
 * Company-serialized Ramp sync coordinator.
 *
 * Each family remains its own durable `step.run`; the family modules own their
 * business workflows while this entry point preserves the deployed function id,
 * trigger, step ids, result shape, and failure-notification contract.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { createMappingService } from "@carbon/ee/accounting";
import {
  getRampIntegration,
  pushChartOfAccounts,
  pushCostCenters
} from "@carbon/ee/ramp.server";
import { trigger } from "@carbon/lib/trigger";
import { NotificationEvent } from "@carbon/notifications";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";
import { syncRampBillPayments, syncRampBills } from "./ramp-sync-bill";
import {
  syncRampCardTransactions,
  syncRampCashbacks,
  syncRampTransfers
} from "./ramp-sync-card";
import { syncRampOutbound } from "./ramp-sync-outbound";
import { syncRampReimbursements } from "./ramp-sync-reimbursement-family";
import { syncRampRepayments } from "./ramp-sync-repayment";
import type { RampSyncContext } from "./ramp-sync-shared";

export const rampSyncFunction = inngest.createFunction(
  {
    id: "ramp-sync",
    retries: 2,
    concurrency: { key: "event.data.companyId", limit: 1 }
  },
  { event: "carbon/ramp-sync" },
  async ({ event, step }) => {
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
      exchangeRateCache: new Map()
    };
    const cardLiabilityAccountId = metadata.cardLiabilityAccountId;
    const entityId = metadata.entityId;

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

    const cardResult = await step.run("ramp-card-transactions", () =>
      syncRampCardTransactions(ctx, ramp, entityId, cardLiabilityAccountId)
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
    const outboundResult = await step.run("ramp-outbound", () =>
      syncRampOutbound(ctx, ramp, integrationRow.data?.updatedAt)
    );

    const totalFailed =
      coaResult.failed +
      costCenterResult.failed +
      cardResult.failed +
      transferResult.failed +
      cashbackResult.failed +
      billResult.failed +
      billPaymentResult.failed +
      reimbursementResult.failed +
      repaymentResult.failed +
      outboundResult.purchaseOrders.failed +
      outboundResult.invoices.failed;

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
            body: `${totalFailed} item(s) failed to sync — review the Accounting tab in Ramp`,
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
      card: cardResult,
      transfers: transferResult,
      cashbacks: cashbackResult,
      bills: billResult,
      billPayments: billPaymentResult,
      reimbursements: reimbursementResult,
      repayments: repaymentResult,
      outbound: outboundResult
    };
  }
);
