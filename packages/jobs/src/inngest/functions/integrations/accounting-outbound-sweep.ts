/**
 * Outbound accounting reconciliation sweep — the correctness guarantee
 * behind OUTBOUND push sync (v4 Pillar B, transport unified under the v5
 * reconciler). DB events make push sync fast; this sweep makes it correct:
 * any lost event (missing subscription, queue loss, phantom Completed)
 * becomes bounded staleness (≤ the cron interval) instead of permanent
 * loss.
 *
 * v5 (.ai/specs/2026-08-12-accounting-sync-reconciler-unification.md): the
 * sweep no longer carries its own diff rules. It converges subscriptions,
 * PAGES the candidate refs for its window (posted journals, posted
 * documents, posted payments, plus parked UNMAPPED_ACCOUNTS bills outside
 * the window), and hands every ref to the SAME `reconcileEntities` executor
 * the event path uses — one brain deciding, two callers waking it. Then it
 * drains (Xero's only periodic drain) and alerts on failures.
 *
 * The window is deliberately short (SWEEP_LOOKBACK_DAYS) — history beyond
 * it is the explicit backfill's job, never a silent mass-push.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import {
  ensureProviderSubscriptions,
  getAccountingIntegration,
  getProviderIntegration,
  PAYMENT_PUSH_PROVIDERS,
  ProviderID,
  resolvePostingSyncSettings,
  type SyncContext
} from "@carbon/ee/accounting";
import { trigger } from "@carbon/lib/trigger";
import { NotificationEvent } from "@carbon/notifications";
import { today } from "@internationalized/date";
import { PostgresDriver } from "kysely";
import { inngest } from "../../client";
import {
  drainSyncOperations,
  getSweepFloorDate,
  getSyncOperationActor,
  isJournalEntryPostingEnabled,
  MAX_REDRIVE_ATTEMPTS,
  SWEPT_BILL_STATUSES,
  SWEPT_INVOICE_STATUSES,
  SWEPT_PAYMENT_STATUSES
} from "./accounting-sync-operations";
import type { ReconcileRef } from "./reconcile";
import { type ReconcileSummary, reconcileEntities } from "./reconcile-executor";

const PAGE_SIZE = 200;
const MAX_PAGES = 25;
/** Refs per reconcileEntities call — bounds the executor's .in() lists. */
const RECONCILE_BATCH_SIZE = 200;

type SweepSummary = {
  subscriptions: { ensured: number; removed: string[] };
  scanned: {
    journals: number;
    bills: number;
    invoices: number;
    payments: number;
    parkedBills: number;
  };
  skippedReasons: string[];
  reconcile: ReconcileSummary;
  drain: {
    claimed: number;
    completed: number;
    failed: number;
    skipped: number;
  } | null;
};

type SweepContext = {
  client: ReturnType<typeof getCarbonServiceRole>;
  companyId: string;
  providerId: ProviderID;
  todayIso: string;
};

async function pageIds(args: {
  ctx: SweepContext;
  table: "journal" | "purchaseInvoice" | "salesInvoice" | "payment";
  statuses: readonly string[];
  dateColumn: string;
  floor: string;
  extraFilter?: (query: any) => any;
}): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let query = args.ctx.client
      .from(args.table)
      .select("id")
      .eq("companyId", args.ctx.companyId)
      .in("status", args.statuses as unknown as ("Posted" | "Reversed")[])
      .gte(args.dateColumn, args.floor);
    if (args.extraFilter) query = args.extraFilter(query);

    const result = await query
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (result.error) {
      throw new Error(
        `Failed to page ${args.table} for sweep: ${result.error.message}`
      );
    }
    const rows = result.data ?? [];
    ids.push(...rows.map((row: { id: string }) => row.id));
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return ids;
}

/**
 * Bills parked Warning UNMAPPED_ACCOUNTS are re-drive candidates even when
 * their postingDate has aged out of the sweep window — the ops ledger, not
 * the document date, is the source for these.
 */
async function parkedBillIds(ctx: SweepContext): Promise<string[]> {
  const parked = await ctx.client
    .from("accountingSyncOperation")
    .select("entityId")
    .eq("companyId", ctx.companyId)
    .eq("integration", ctx.providerId)
    .eq("entityType", "bill")
    .eq("status", "Warning")
    .eq("errorCode", "UNMAPPED_ACCOUNTS")
    .lt("attemptCount", MAX_REDRIVE_ATTEMPTS)
    .limit(PAGE_SIZE);

  if (parked.error) {
    throw new Error(
      `Failed to load parked bill operations: ${parked.error.message}`
    );
  }
  return (parked.data ?? []).map((row) => row.entityId);
}

async function sweepCompanyProvider(args: {
  companyId: string;
  providerId: ProviderID;
  database: SyncContext["database"];
  scope: string;
}): Promise<SweepSummary> {
  const { companyId, providerId, database, scope } = args;
  const client = getCarbonServiceRole();

  const integration = await getAccountingIntegration(
    client,
    companyId,
    providerId
  );
  const provider = getProviderIntegration(
    client,
    companyId,
    integration.id,
    integration.metadata
  );

  // 1. Subscription convergence — the invariant self-heal. Runs before the
  // window walk so a repaired install's next events flow normally.
  const converged = await ensureProviderSubscriptions(
    client,
    companyId,
    providerId
  );
  if (converged.removed.length > 0) {
    console.info(
      `[OUTBOUND SWEEP] ${companyId}/${providerId}: removed stale subscription(s): ${converged.removed.join(", ")}`
    );
  }

  const ctx: SweepContext = {
    client,
    companyId,
    providerId,
    todayIso: today("UTC").toString()
  };

  const settings = resolvePostingSyncSettings(integration.metadata);
  const skippedReasons: string[] = [];
  const refs: ReconcileRef[] = [];
  const scanned = {
    journals: 0,
    bills: 0,
    invoices: 0,
    payments: 0,
    parkedBills: 0
  };

  // 2. Candidate refs. Paging filters are SCOPE (which rows are worth
  // asking about); every decision belongs to the reconciler. Journal posting
  // is always-on; the entity flag is a legacy escape hatch forced on by the
  // provider configs.
  if (isJournalEntryPostingEnabled(integration.metadata)) {
    const floor = getSweepFloorDate({
      todayIso: ctx.todayIso,
      syncFromDate: settings.syncFromDate
    });
    const journalIds = await pageIds({
      ctx,
      table: "journal",
      statuses: ["Posted", "Reversed"],
      dateColumn: "postingDate",
      floor,
      extraFilter: (query) => query.is("reversalOfId", null)
    });
    scanned.journals = journalIds.length;
    refs.push(
      ...journalIds.map(
        (id): ReconcileRef => ({ entityType: "journalEntry", entityId: id })
      )
    );
  } else {
    skippedReasons.push("journals: posting sync disabled");
  }

  const billConfig = provider.getSyncConfig("bill");
  if (billConfig?.enabled && billConfig.direction !== "pull-from-accounting") {
    const floor = getSweepFloorDate({
      todayIso: ctx.todayIso,
      syncFromDate: billConfig.syncFromDate
    });
    const billIds = await pageIds({
      ctx,
      table: "purchaseInvoice",
      statuses: SWEPT_BILL_STATUSES,
      dateColumn: "postingDate",
      floor
    });
    scanned.bills = billIds.length;
    const parked = await parkedBillIds(ctx);
    scanned.parkedBills = parked.length;
    const billRefIds = new Set([...billIds, ...parked]);
    refs.push(
      ...[...billRefIds].map(
        (id): ReconcileRef => ({ entityType: "bill", entityId: id })
      )
    );
  } else {
    skippedReasons.push("bills: push disabled");
  }

  const invoiceConfig = provider.getSyncConfig("invoice");
  if (
    invoiceConfig?.enabled &&
    invoiceConfig.direction !== "pull-from-accounting"
  ) {
    const floor = getSweepFloorDate({
      todayIso: ctx.todayIso,
      syncFromDate: invoiceConfig.syncFromDate
    });
    const invoiceIds = await pageIds({
      ctx,
      table: "salesInvoice",
      statuses: SWEPT_INVOICE_STATUSES,
      dateColumn: "postingDate",
      floor
    });
    scanned.invoices = invoiceIds.length;
    refs.push(
      ...invoiceIds.map(
        (id): ReconcileRef => ({ entityType: "invoice", entityId: id })
      )
    );
  } else {
    skippedReasons.push("invoices: push disabled");
  }

  if (PAYMENT_PUSH_PROVIDERS.has(providerId)) {
    const floor = getSweepFloorDate({ todayIso: ctx.todayIso });
    const paymentIds = await pageIds({
      ctx,
      table: "payment",
      statuses: SWEPT_PAYMENT_STATUSES,
      dateColumn: "createdAt",
      floor
    });
    scanned.payments = paymentIds.length;
    refs.push(
      ...paymentIds.map(
        (id): ReconcileRef => ({ entityType: "payment", entityId: id })
      )
    );
  } else {
    skippedReasons.push("payments: provider has no outbound payment push");
  }

  // 3. Reconcile — the same executor the event path calls.
  const createdBy = getSyncOperationActor(integration);
  const reconcile: ReconcileSummary = {
    considered: 0,
    enqueued: 0,
    recordedTerminal: 0,
    redriven: 0,
    nothing: 0,
    errors: 0
  };
  for (let start = 0; start < refs.length; start += RECONCILE_BATCH_SIZE) {
    const batch = refs.slice(start, start + RECONCILE_BATCH_SIZE);
    const result = await reconcileEntities({
      client,
      database,
      companyId,
      providerId,
      integrationMetadata: integration.metadata,
      createdBy,
      scope,
      refs: batch
    });
    reconcile.considered += result.considered;
    reconcile.enqueued += result.enqueued;
    reconcile.recordedTerminal += result.recordedTerminal;
    reconcile.redriven += result.redriven;
    reconcile.nothing += result.nothing;
    reconcile.errors += result.errors;
  }

  // 4. Drain everything Pending (including what this run enqueued or
  // re-drove). For providers with no incremental pull (Xero) this is the
  // only periodic drain — UI retries stop rotting as Pending.
  const drain = await drainSyncOperations({
    client,
    database,
    companyId,
    integration: providerId,
    provider,
    integrationMetadata: integration.metadata
  });

  // 5. Alert on failures left behind by the drain (v4 Pillar F). Recipient:
  // whoever configured the integration. Never fail the sweep over a
  // notification.
  if (drain.failed > 0) {
    const recipientId = integration.updatedBy;
    if (recipientId && recipientId !== "system") {
      try {
        await trigger("notify", {
          event: NotificationEvent.IntegrationSync,
          companyId,
          documentId: providerId,
          title: "Accounting sync needs attention",
          body: `${drain.failed} sync operation(s) failed for ${providerId} — review Sync Activity`,
          recipient: { type: "user", userId: recipientId }
        });
      } catch (notifyError) {
        console.error(
          `[OUTBOUND SWEEP] ${companyId}/${providerId}: failed to send sync-failure notification`,
          notifyError
        );
      }
    }
  }

  return {
    subscriptions: {
      ensured: converged.ensured.length,
      removed: converged.removed
    },
    scanned,
    skippedReasons,
    reconcile,
    drain: {
      claimed: drain.claimed,
      completed: drain.completed,
      failed: drain.failed,
      skipped: drain.skipped
    }
  };
}

export const accountingOutboundSweepFunction = inngest.createFunction(
  { id: "accounting-outbound-sweep", retries: 2 },
  // Offset from the inbound pull sweep (*/30) so the two never contend
  // for the same company's ledger claims
  { cron: "15,45 * * * *" },
  async ({ step, runId }) => {
    const client = getCarbonServiceRole();

    const targets = await step.run("find-outbound-sweep-targets", async () => {
      const integrations = await client
        .from("companyIntegration")
        .select("id, companyId")
        .in("id", Object.values(ProviderID))
        .eq("active", true);

      if (integrations.error) {
        throw new Error(
          `Failed to list accounting integrations: ${integrations.error.message}`
        );
      }

      return (integrations.data ?? []).map((row) => ({
        companyId: row.companyId,
        providerId: row.id as ProviderID
      }));
    });

    if (targets.length === 0) {
      return { targets: 0, results: [] };
    }

    const results: Array<
      { companyId: string; providerId: ProviderID } & SweepSummary
    > = [];

    for (const target of targets) {
      const result = await step.run(
        `outbound-sweep-${target.providerId}-${target.companyId}`,
        async () => {
          const pool = getPostgresConnectionPool(5);
          const database = getPostgresClient(pool, PostgresDriver);
          try {
            return await sweepCompanyProvider({
              companyId: target.companyId,
              providerId: target.providerId,
              database,
              scope: runId
            });
          } finally {
            await pool.end();
          }
        }
      );

      results.push({ ...target, ...result });
    }

    return { targets: targets.length, results };
  }
);
