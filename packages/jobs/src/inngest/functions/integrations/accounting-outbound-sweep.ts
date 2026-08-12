/**
 * Outbound accounting reconciliation sweep — the correctness guarantee
 * behind OUTBOUND push sync (v4 spec, Pillar B). DB events make push sync
 * fast; this sweep makes it correct: any lost event (missing subscription,
 * queue loss, cooldown swallow, phantom Completed) becomes bounded
 * staleness (≤ the cron interval) instead of permanent loss.
 *
 * Every 30 minutes (offset from the inbound pull sweep), per company with
 * an ACTIVE accounting integration:
 *
 * 1. Converge event subscriptions onto REQUIRED_SYNC_SUBSCRIPTIONS
 *    (`ensureProviderSubscriptions`) — the self-healing invariant check
 *    that fixes installs made before a table (e.g. `journal`) was added.
 * 2. Journal completeness diff: every Posted/Reversed journal inside the
 *    sweep window must have a recorded disposition (spec I1). Missing ones
 *    route through the same posting-policy decision the event path uses —
 *    push ops enqueue, policy exclusions record terminally.
 * 3. Document completeness diff (bills, invoices): posted documents with
 *    no external mapping, no live operation, and no parked disposition
 *    enqueue a push. "Latest op Completed but no mapping" is included on
 *    purpose — that is the phantom-success signature the truthful-ledger
 *    fix prevents going forward, and the sweep repairs retroactively.
 * 4. Payment completeness diff (providers with outbound payment push):
 *    Posted/Voided payments with no operation row at all enqueue.
 * 5. Re-drive: bill operations parked Warning UNMAPPED_ACCOUNTS whose
 *    backing "Purchase Invoice" journal NOW exists flip back to Pending
 *    (heals the post-invoice race where the bill drained before its
 *    journal posted), capped by attempt count.
 * 6. Drain — which also gives providers without an incremental pull
 *    (Xero) their only periodic drain of Pending/retried operations.
 *
 * The diff is state-based and convergent: everything it enqueues either
 * reaches Completed-with-mapping (drops out of the diff), or parks in a
 * terminal non-Completed status (excluded from the diff; re-driven only
 * under the capped rules above). The window is deliberately short
 * (SWEEP_LOOKBACK_DAYS) — history beyond it is the explicit backfill's
 * job, never a silent mass-push.
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
  ProviderID,
  resolvePostingSyncSettings,
  type SyncContext,
  transitionOperation
} from "@carbon/ee/accounting";
import { trigger } from "@carbon/lib/trigger";
import { NotificationEvent } from "@carbon/notifications";
import { today } from "@internationalized/date";
import { PostgresDriver } from "kysely";
import { inngest } from "../../client";
import {
  drainSyncOperations,
  enqueueSyncOperations,
  getSweepFloorDate,
  getSyncOperationActor,
  insertTerminalSyncOperations,
  isJournalEntryPostingEnabled,
  MAX_REDRIVE_ATTEMPTS,
  planJournalPostingOperation,
  SWEPT_BILL_STATUSES,
  SWEPT_INVOICE_STATUSES,
  SWEPT_PAYMENT_STATUSES,
  type SyncOperationRequest,
  shouldEnqueueMissingDocument,
  type TerminalSyncOperationRequest
} from "./accounting-sync-operations";

const PAGE_SIZE = 200;
const MAX_PAGES = 25;

type DiffSummary = {
  scanned: number;
  enqueued: number;
  recordedTerminal: number;
  skippedReason: string | null;
};

const emptyDiff = (): DiffSummary => ({
  scanned: 0,
  enqueued: 0,
  recordedTerminal: 0,
  skippedReason: null
});

type SweepSummary = {
  subscriptions: { ensured: number; removed: string[] };
  journals: DiffSummary;
  bills: DiffSummary;
  invoices: DiffSummary;
  payments: DiffSummary;
  redriven: number;
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
  createdBy: string;
  scope: string;
  todayIso: string;
};

/**
 * Journal completeness (spec I1): every Posted/Reversed journal in the
 * window gets exactly one recorded disposition. Same policy routing as the
 * event path and the explicit backfill (planJournalPostingOperation).
 */
async function diffJournals(
  ctx: SweepContext,
  args: { integrationMetadata: unknown }
): Promise<DiffSummary> {
  const summary = emptyDiff();

  if (!isJournalEntryPostingEnabled(args.integrationMetadata)) {
    summary.skippedReason = "posting sync (journalEntry) disabled";
    return summary;
  }
  const settings = resolvePostingSyncSettings(args.integrationMetadata);
  if (!settings.enabled) {
    summary.skippedReason = "postingSync.enabled is false";
    return summary;
  }

  const floor = getSweepFloorDate({
    todayIso: ctx.todayIso,
    syncFromDate: settings.syncFromDate
  });

  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const journals = await ctx.client
      .from("journal")
      .select("id, sourceType, status, reversalOfId")
      .eq("companyId", ctx.companyId)
      .in("status", ["Posted", "Reversed"])
      .is("reversalOfId", null)
      .gte("postingDate", floor)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (journals.error) {
      throw new Error(
        `Failed to page journals for sweep diff: ${journals.error.message}`
      );
    }

    const rows = journals.data ?? [];
    if (rows.length === 0) break;
    summary.scanned += rows.length;

    const candidateEntityIds = rows.flatMap((row) =>
      row.status === "Reversed" ? [row.id, `${row.id}:reversal`] : [row.id]
    );

    const existing = await ctx.client
      .from("accountingSyncOperation")
      .select("entityId")
      .eq("companyId", ctx.companyId)
      .eq("integration", ctx.providerId)
      .eq("entityType", "journalEntry")
      .in("entityId", candidateEntityIds);

    if (existing.error) {
      throw new Error(
        `Failed to load existing journal operations: ${existing.error.message}`
      );
    }

    const covered = new Set((existing.data ?? []).map((row) => row.entityId));

    const pushRequests: SyncOperationRequest[] = [];
    const terminalRequests: TerminalSyncOperationRequest[] = [];

    for (const row of rows) {
      if (!covered.has(row.id)) {
        const plan = await planJournalPostingOperation({
          client: ctx.client,
          companyId: ctx.companyId,
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
          integrationMetadata: args.integrationMetadata
        });
        if (plan.action === "push") pushRequests.push(plan.request);
        else if (plan.action === "terminal")
          terminalRequests.push(plan.request);
      }

      if (row.status === "Reversed" && !covered.has(`${row.id}:reversal`)) {
        const reversalPlan = await planJournalPostingOperation({
          client: ctx.client,
          companyId: ctx.companyId,
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
          integrationMetadata: args.integrationMetadata
        });
        if (reversalPlan.action === "push") {
          pushRequests.push(reversalPlan.request);
        } else if (reversalPlan.action === "terminal") {
          terminalRequests.push(reversalPlan.request);
        }
      }
    }

    const enqueueOutcomes = await enqueueSyncOperations(ctx.client, {
      companyId: ctx.companyId,
      integration: ctx.providerId,
      trigger: "backfill",
      createdBy: ctx.createdBy,
      scope: ctx.scope,
      requests: pushRequests
    });
    summary.enqueued += enqueueOutcomes.filter(
      (outcome) => outcome.outcome === "enqueued"
    ).length;

    const terminalOutcomes = await insertTerminalSyncOperations(ctx.client, {
      companyId: ctx.companyId,
      integration: ctx.providerId,
      trigger: "backfill",
      createdBy: ctx.createdBy,
      scope: ctx.scope,
      requests: terminalRequests
    });
    summary.recordedTerminal += terminalOutcomes.filter(
      (outcome) => outcome.outcome === "enqueued"
    ).length;

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return summary;
}

/**
 * Document completeness for one table (purchaseInvoice → bill,
 * salesInvoice → invoice). Pages posted documents inside the window and
 * applies shouldEnqueueMissingDocument against the mapping table and the
 * op ledger.
 */
async function diffDocuments(
  ctx: SweepContext,
  args: {
    table: "purchaseInvoice" | "salesInvoice";
    entityType: "bill" | "invoice";
    statuses: readonly (
      | (typeof SWEPT_BILL_STATUSES)[number]
      | (typeof SWEPT_INVOICE_STATUSES)[number]
    )[];
    dateColumn: string;
    syncFromDate?: string | null;
  }
): Promise<DiffSummary> {
  const summary = emptyDiff();
  const floor = getSweepFloorDate({
    todayIso: ctx.todayIso,
    syncFromDate: args.syncFromDate
  });

  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const documents = await ctx.client
      .from(args.table)
      .select("id")
      .eq("companyId", ctx.companyId)
      .in("status", args.statuses)
      .gte(args.dateColumn, floor)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (documents.error) {
      throw new Error(
        `Failed to page ${args.table} for sweep diff: ${documents.error.message}`
      );
    }

    const rows = documents.data ?? [];
    if (rows.length === 0) break;
    summary.scanned += rows.length;
    const ids = rows.map((row) => row.id);

    const mappings = await ctx.client
      .from("externalIntegrationMapping")
      .select("entityId")
      .eq("companyId", ctx.companyId)
      .eq("integration", ctx.providerId)
      .eq("entityType", args.entityType)
      .not("externalId", "is", null)
      .in("entityId", ids);

    if (mappings.error) {
      throw new Error(
        `Failed to load ${args.entityType} mappings: ${mappings.error.message}`
      );
    }
    const mapped = new Set((mappings.data ?? []).map((row) => row.entityId));

    const operations = await ctx.client
      .from("accountingSyncOperation")
      .select("entityId, status, createdAt")
      .eq("companyId", ctx.companyId)
      .eq("integration", ctx.providerId)
      .eq("entityType", args.entityType)
      .in("entityId", ids);

    if (operations.error) {
      throw new Error(
        `Failed to load ${args.entityType} operations: ${operations.error.message}`
      );
    }

    const liveByEntity = new Set<string>();
    const latestByEntity = new Map<
      string,
      { status: string; createdAt: string }
    >();
    for (const operation of operations.data ?? []) {
      if (operation.status === "Pending" || operation.status === "In Flight") {
        liveByEntity.add(operation.entityId);
      }
      const latest = latestByEntity.get(operation.entityId);
      if (!latest || operation.createdAt > latest.createdAt) {
        latestByEntity.set(operation.entityId, {
          status: operation.status,
          createdAt: operation.createdAt
        });
      }
    }

    const requests: SyncOperationRequest[] = [];
    for (const id of ids) {
      if (
        shouldEnqueueMissingDocument({
          hasMapping: mapped.has(id),
          hasLiveOperation: liveByEntity.has(id),
          latestOperationStatus: latestByEntity.get(id)?.status ?? null
        })
      ) {
        requests.push({
          entityType: args.entityType,
          entityId: id,
          direction: "push-to-accounting"
        });
      }
    }

    const outcomes = await enqueueSyncOperations(ctx.client, {
      companyId: ctx.companyId,
      integration: ctx.providerId,
      trigger: "backfill",
      createdBy: ctx.createdBy,
      scope: ctx.scope,
      requests
    });
    summary.enqueued += outcomes.filter(
      (outcome) => outcome.outcome === "enqueued"
    ).length;

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return summary;
}

/**
 * Payment completeness (providers with outbound payment push only —
 * currently Rillet, mirroring RilletPaymentSyncer.supportsPaymentPush).
 * Rule is stricter than documents: only payments with NO operation row at
 * all enqueue (pure lost event) — payment mapping ids are composite
 * (`<doc>:<payment>`), so a mapping-based phantom check doesn't apply.
 * Ineligible payments (families gate, multi-settlement, FX) park as
 * Skipped on first drain and leave the diff permanently.
 */
async function diffPayments(ctx: SweepContext): Promise<DiffSummary> {
  const summary = emptyDiff();

  if (ctx.providerId !== ProviderID.RILLET) {
    summary.skippedReason = "provider has no outbound payment push";
    return summary;
  }

  const floor = getSweepFloorDate({ todayIso: ctx.todayIso });

  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const payments = await ctx.client
      .from("payment")
      .select("id")
      .eq("companyId", ctx.companyId)
      .in("status", SWEPT_PAYMENT_STATUSES)
      .gte("createdAt", floor)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (payments.error) {
      throw new Error(
        `Failed to page payments for sweep diff: ${payments.error.message}`
      );
    }

    const rows = payments.data ?? [];
    if (rows.length === 0) break;
    summary.scanned += rows.length;
    const ids = rows.map((row) => row.id);

    const operations = await ctx.client
      .from("accountingSyncOperation")
      .select("entityId")
      .eq("companyId", ctx.companyId)
      .eq("integration", ctx.providerId)
      .eq("entityType", "payment")
      .in("entityId", ids);

    if (operations.error) {
      throw new Error(
        `Failed to load payment operations: ${operations.error.message}`
      );
    }
    const covered = new Set((operations.data ?? []).map((row) => row.entityId));

    const outcomes = await enqueueSyncOperations(ctx.client, {
      companyId: ctx.companyId,
      integration: ctx.providerId,
      trigger: "backfill",
      createdBy: ctx.createdBy,
      scope: ctx.scope,
      requests: ids
        .filter((id) => !covered.has(id))
        .map((id) => ({
          entityType: "payment",
          entityId: id,
          direction: "push-to-accounting" as const
        }))
    });
    summary.enqueued += outcomes.filter(
      (outcome) => outcome.outcome === "enqueued"
    ).length;

    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return summary;
}

/**
 * Re-drive bills parked Warning UNMAPPED_ACCOUNTS whose backing posted
 * "Purchase Invoice" journal NOW exists — the post-invoice race (the bill
 * drained seconds before the edge function posted the journal). The
 * account-costed replay needs that journal; once it exists the same op
 * flips back to Pending and the end-of-sweep drain retries it. Attempt
 * caps stop genuinely-unmapped-account Warnings from churning.
 */
async function redriveParkedBills(
  ctx: SweepContext,
  database: SyncContext["database"]
): Promise<number> {
  const parked = await ctx.client
    .from("accountingSyncOperation")
    .select("id, entityId, attemptCount")
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

  const rows = parked.data ?? [];
  if (rows.length === 0) return 0;

  const billIds = rows.map((row) => row.entityId);
  const journalLines = await database
    .selectFrom("journalLine")
    .innerJoin("journal", "journal.id", "journalLine.journalId")
    .select("journalLine.documentId")
    .distinct()
    .where("journalLine.companyId", "=", ctx.companyId)
    .where("journalLine.documentId", "in", billIds)
    .where("journal.sourceType", "=", "Purchase Invoice")
    .where("journal.status", "=", "Posted")
    .execute();

  const journaled = new Set(
    journalLines.flatMap((row) => (row.documentId ? [row.documentId] : []))
  );

  let redriven = 0;
  for (const row of rows) {
    if (!journaled.has(row.entityId)) continue;
    const transitioned = await transitionOperation(ctx.client, {
      id: row.id,
      companyId: ctx.companyId,
      to: "Pending",
      userId: ctx.createdBy
    });
    if (transitioned.error) {
      console.warn(
        `[OUTBOUND SWEEP] ${ctx.companyId}/${ctx.providerId}: failed to re-drive bill op ${row.id}: ${transitioned.error}`
      );
      continue;
    }
    redriven++;
  }

  return redriven;
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

  // 1. Subscription convergence — the invariant self-heal. Runs before
  // the diffs so a repaired install's next events flow normally.
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
    createdBy: getSyncOperationActor(integration),
    scope,
    todayIso: today("UTC").toString()
  };

  // 2-4. Completeness diffs
  const journals = await diffJournals(ctx, {
    integrationMetadata: integration.metadata
  });

  const billConfig = provider.getSyncConfig("bill");
  const bills =
    billConfig?.enabled && billConfig.direction !== "pull-from-accounting"
      ? await diffDocuments(ctx, {
          table: "purchaseInvoice",
          entityType: "bill",
          statuses: SWEPT_BILL_STATUSES,
          dateColumn: "postingDate",
          syncFromDate: billConfig.syncFromDate
        })
      : { ...emptyDiff(), skippedReason: "bill push disabled" };

  const invoiceConfig = provider.getSyncConfig("invoice");
  const invoices =
    invoiceConfig?.enabled && invoiceConfig.direction !== "pull-from-accounting"
      ? await diffDocuments(ctx, {
          table: "salesInvoice",
          entityType: "invoice",
          statuses: SWEPT_INVOICE_STATUSES,
          dateColumn: "postingDate",
          syncFromDate: invoiceConfig.syncFromDate
        })
      : { ...emptyDiff(), skippedReason: "invoice push disabled" };

  const payments = await diffPayments(ctx);

  // 5. Re-drive the race-parked bills
  const redriven = await redriveParkedBills(ctx, database);

  // 6. Drain everything Pending (including what this run enqueued or
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

  // 7. Alert (Pillar F): failed operations after the drain mean the sweep
  // could not self-heal — surface one in-app notification to the person who
  // owns the integration. Subscription repairs are informational only (logged
  // above), and a notification failure must never fail the sweep.
  if (drain.failed > 0) {
    const recipientUserId = integration.updatedBy;
    if (recipientUserId && recipientUserId !== "system") {
      try {
        await trigger("notify", {
          body: `${drain.failed} sync operation(s) failed for ${providerId} — review Sync Activity`,
          companyId,
          documentId: providerId,
          event: NotificationEvent.IntegrationSync,
          recipient: { type: "user", userId: recipientUserId },
          title: "Accounting sync needs attention"
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
    journals,
    bills,
    invoices,
    payments,
    redriven,
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
