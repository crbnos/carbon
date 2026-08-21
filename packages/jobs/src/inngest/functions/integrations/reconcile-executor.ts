/**
 * v5 reconciler executor (spec D2): load state for a batch of refs — one
 * query per concern, never per entity — run the pure decision core over
 * each, and apply the actions through the existing ledger primitives.
 *
 * Callers (the event handler's hint batches, the outbound sweep's window
 * pages) stay batch-shaped end to end: snapshots, ledger state, mappings and
 * the bill backing-journal check are each ONE query per entity type per
 * call. Enqueues carry trigger "reconcile" — state-derived decisions are
 * never cooldown-gated (idempotence replaces the cooldown).
 */
import type { Database } from "@carbon/database";
import {
  PAYMENT_PUSH_PROVIDERS,
  type PostingSyncSettings,
  type ProviderID,
  resolvePostingSyncSettings,
  resolveSyncConfig,
  type SyncContext,
  transitionOperation
} from "@carbon/ee/accounting";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueSyncOperations,
  insertTerminalSyncOperations,
  isJournalEntryPostingEnabled,
  resolvePaymentJournalFamily,
  type SyncOperationRequest,
  type TerminalSyncOperationRequest
} from "./accounting-sync-operations";
import {
  computeReconcileDecision,
  type ReconcileEntityInput,
  type ReconcileEntityType,
  type ReconcileLatestOperation,
  type ReconcileRef
} from "./reconcile";

const SNAPSHOT_TABLES: Record<
  ReconcileEntityType,
  { table: string; columns: string }
> = {
  journalEntry: {
    table: "journal",
    columns: "id, status, sourceType, reversalOfId"
  },
  bill: { table: "purchaseInvoice", columns: "id, status, updatedAt" },
  invoice: { table: "salesInvoice", columns: "id, status, updatedAt" },
  payment: { table: "payment", columns: "id, status, updatedAt" },
  customer: { table: "customer", columns: "id, updatedAt" },
  vendor: { table: "supplier", columns: "id, updatedAt" },
  item: { table: "item", columns: "id, updatedAt" },
  purchaseOrder: { table: "purchaseOrder", columns: "id, updatedAt" },
  salesOrder: { table: "salesOrder", columns: "id, updatedAt" }
};

/** Entity types whose decision consults the push mapping. */
const MAPPED_TYPES: ReadonlySet<ReconcileEntityType> = new Set([
  "bill",
  "invoice",
  "customer",
  "vendor",
  "item",
  "purchaseOrder",
  "salesOrder"
]);

export type ReconcileSummary = {
  considered: number;
  enqueued: number;
  recordedTerminal: number;
  redriven: number;
  nothing: number;
  errors: number;
};

const emptySummary = (): ReconcileSummary => ({
  considered: 0,
  enqueued: 0,
  recordedTerminal: 0,
  redriven: 0,
  nothing: 0,
  errors: 0
});

type SnapshotRow = {
  id: string;
  status?: string | null;
  sourceType?: string | null;
  reversalOfId?: string | null;
  updatedAt?: string | null;
};

type LedgerRow = {
  id: string;
  entityId: string;
  status: string;
  errorCode: string | null;
  attemptCount: number;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

/**
 * Reconcile a batch of refs for one company + provider. Refs may span
 * entity types; state is loaded per type in batches. Returns counts only —
 * the ledger rows ARE the record.
 */
export async function reconcileEntities(args: {
  client: SupabaseClient<Database>;
  database: SyncContext["database"];
  companyId: string;
  providerId: string;
  integrationMetadata: unknown;
  createdBy: string;
  /** Idempotency scope for this reconcile occasion (event id / run id). */
  scope: string;
  refs: ReconcileRef[];
}): Promise<ReconcileSummary> {
  const summary = emptySummary();
  if (args.refs.length === 0) return summary;

  const settings = resolvePostingSyncSettings(args.integrationMetadata);
  const syncConfig = resolveSyncConfig(args.integrationMetadata);
  // Always-on: automated postings sync whenever an accounting integration is
  // connected — the old settings.enabled master gate is gone. The entity flag
  // now defaults true and provider configs force it on.
  const journalEntryPushEnabled = isJournalEntryPostingEnabled(
    args.integrationMetadata
  );

  const byType = new Map<ReconcileEntityType, string[]>();
  for (const ref of args.refs) {
    const ids = byType.get(ref.entityType);
    if (ids) {
      if (!ids.includes(ref.entityId)) ids.push(ref.entityId);
    } else {
      byType.set(ref.entityType, [ref.entityId]);
    }
  }

  const enqueueRequests: SyncOperationRequest[] = [];
  const terminalRequests: TerminalSyncOperationRequest[] = [];
  const redriveOperationIds: string[] = [];

  for (const [entityType, ids] of byType) {
    summary.considered += ids.length;

    const snapshotSource = SNAPSHOT_TABLES[entityType];
    const snapshots = await args.client
      .from(snapshotSource.table as "journal")
      .select(snapshotSource.columns)
      .eq("companyId", args.companyId)
      .in("id", ids);
    if (snapshots.error) {
      throw new Error(
        `Failed to load ${entityType} snapshots: ${snapshots.error.message}`
      );
    }
    const snapshotById = new Map<string, SnapshotRow>(
      ((snapshots.data ?? []) as unknown as SnapshotRow[]).map((row) => [
        row.id,
        row
      ])
    );

    // Ledger state — one query covering plain ids and (for journals) the
    // `:reversal` twins.
    const ledgerEntityIds =
      entityType === "journalEntry"
        ? ids.flatMap((id) => [id, `${id}:reversal`])
        : ids;
    const operations = await args.client
      .from("accountingSyncOperation")
      .select(
        "id, entityId, status, errorCode, attemptCount, createdAt, metadata"
      )
      .eq("companyId", args.companyId)
      .eq("integration", args.providerId)
      .eq("entityType", entityType)
      .eq("direction", "push-to-accounting")
      .in("entityId", ledgerEntityIds);
    if (operations.error) {
      throw new Error(
        `Failed to load ${entityType} operations: ${operations.error.message}`
      );
    }
    const coveredEntityIds = new Set<string>();
    const liveByEntity = new Set<string>();
    const latestByEntity = new Map<string, ReconcileLatestOperation>();
    const targetDocumentByEntity = new Map<string, string>();
    for (const operation of (operations.data ?? []) as LedgerRow[]) {
      coveredEntityIds.add(operation.entityId);
      if (operation.status === "Pending" || operation.status === "In Flight") {
        liveByEntity.add(operation.entityId);
      }
      const latest = latestByEntity.get(operation.entityId);
      if (!latest || operation.createdAt > latest.createdAt) {
        latestByEntity.set(operation.entityId, {
          id: operation.id,
          status: operation.status,
          errorCode: operation.errorCode,
          attemptCount: operation.attemptCount,
          createdAt: operation.createdAt
        });
        const targetDocumentId = operation.metadata?.targetDocumentId;
        if (typeof targetDocumentId === "string") {
          targetDocumentByEntity.set(operation.entityId, targetDocumentId);
        } else {
          targetDocumentByEntity.delete(operation.entityId);
        }
      }
    }

    // Push mappings (documents + master data).
    const mappingByEntity = new Map<
      string,
      { externalId: string | null; lastSyncedAt: string | null }
    >();
    if (MAPPED_TYPES.has(entityType)) {
      const mappings = await args.client
        .from("externalIntegrationMapping")
        .select("entityId, externalId, lastSyncedAt")
        .eq("companyId", args.companyId)
        .eq("integration", args.providerId)
        .eq("entityType", entityType)
        .in("entityId", ids);
      if (mappings.error) {
        throw new Error(
          `Failed to load ${entityType} mappings: ${mappings.error.message}`
        );
      }
      for (const row of mappings.data ?? []) {
        mappingByEntity.set(row.entityId, {
          externalId: row.externalId,
          lastSyncedAt: row.lastSyncedAt
        });
      }
    }

    // Bills parked Warning UNMAPPED_ACCOUNTS: does the posted "Purchase
    // Invoice" journal now exist? One batched join for just those bills.
    const backingJournalByBill = new Set<string>();
    if (entityType === "bill") {
      const parkedBillIds = ids.filter((id) => {
        const latest = latestByEntity.get(id);
        return (
          latest?.status === "Warning" &&
          latest.errorCode === "UNMAPPED_ACCOUNTS"
        );
      });
      if (parkedBillIds.length > 0) {
        const journalLines = await args.database
          .selectFrom("journalLine")
          .innerJoin("journal", "journal.id", "journalLine.journalId")
          .select("journalLine.documentId")
          .distinct()
          .where("journalLine.companyId", "=", args.companyId)
          .where("journalLine.documentId", "in", parkedBillIds)
          .where("journal.sourceType", "=", "Purchase Invoice")
          .where("journal.status", "=", "Posted")
          .execute();
        for (const row of journalLines) {
          if (row.documentId) backingJournalByBill.add(row.documentId);
        }
      }
    }

    // Payments parked Warning UNSYNCED_DOCUMENT: has the settled document
    // (op metadata.targetDocumentId) since gained a provider mapping? One
    // batched lookup across invoice + bill mappings for just those targets.
    const mappedSettledTargets = new Set<string>();
    if (entityType === "payment") {
      const parkedTargets = [
        ...new Set(
          ids.flatMap((id) => {
            const latest = latestByEntity.get(id);
            const target = targetDocumentByEntity.get(id);
            return latest?.status === "Warning" &&
              latest.errorCode === "UNSYNCED_DOCUMENT" &&
              target
              ? [target]
              : [];
          })
        )
      ];
      if (parkedTargets.length > 0) {
        const targetMappings = await args.client
          .from("externalIntegrationMapping")
          .select("entityId")
          .eq("companyId", args.companyId)
          .eq("integration", args.providerId)
          .in("entityType", ["invoice", "bill"])
          .not("externalId", "is", null)
          .in("entityId", parkedTargets);
        if (targetMappings.error) {
          throw new Error(
            `Failed to load settled-document mappings: ${targetMappings.error.message}`
          );
        }
        for (const row of targetMappings.data ?? []) {
          mappedSettledTargets.add(row.entityId);
        }
      }
    }

    const entityPushEnabled = isEntityPushEnabled(syncConfig, entityType);

    for (const entityId of ids) {
      const snapshot = snapshotById.get(entityId) ?? null;

      // Payment-source journals resolve the AR/AP side only when the family
      // modes diverge (matches planJournalPostingOperation exactly).
      let paymentFamily: "ar" | "ap" | null = null;
      if (
        entityType === "journalEntry" &&
        snapshot?.sourceType === "Payment" &&
        settings.families.ar !== settings.families.ap
      ) {
        paymentFamily = await resolvePaymentJournalFamily(args.client, {
          companyId: args.companyId,
          journalId: entityId
        });
      }

      const input: ReconcileEntityInput = {
        entityType,
        entityId,
        snapshot,
        hasMappingWithExternalId:
          mappingByEntity.get(entityId)?.externalId != null,
        lastSyncedAt: mappingByEntity.get(entityId)?.lastSyncedAt ?? null,
        hasLiveOperation: liveByEntity.has(entityId),
        latestOperation: latestByEntity.get(entityId) ?? null,
        ...(entityType === "journalEntry"
          ? {
              journalCoverage: {
                normalCovered: coveredEntityIds.has(entityId),
                reversalCovered: coveredEntityIds.has(`${entityId}:reversal`)
              }
            }
          : {}),
        ...(entityType === "bill"
          ? { hasPostedBackingJournal: backingJournalByBill.has(entityId) }
          : {}),
        ...(entityType === "payment"
          ? {
              settledDocumentMapped: (() => {
                const target = targetDocumentByEntity.get(entityId);
                return target ? mappedSettledTargets.has(target) : false;
              })()
            }
          : {}),
        context: {
          journalEntryPushEnabled,
          entityPushEnabled,
          providerSupportsPaymentPush: PAYMENT_PUSH_PROVIDERS.has(
            args.providerId as ProviderID
          ),
          settings: settings as PostingSyncSettings,
          docSync: {
            invoiceEnabled: syncConfig.entities.invoice.enabled,
            billEnabled: syncConfig.entities.bill.enabled
          },
          inventoryAdjustmentEnabled:
            syncConfig.entities.inventoryAdjustment.enabled,
          paymentFamily
        }
      };

      const decision = computeReconcileDecision(input);
      for (const action of decision.actions) {
        if (action.kind === "enqueue") enqueueRequests.push(action.request);
        else if (action.kind === "record-terminal")
          terminalRequests.push(action.request);
        else if (action.kind === "re-drive")
          redriveOperationIds.push(action.operationId);
        else summary.nothing++;
      }
    }
  }

  const enqueueOutcomes = await enqueueSyncOperations(args.client, {
    companyId: args.companyId,
    integration: args.providerId,
    trigger: "reconcile",
    createdBy: args.createdBy,
    scope: args.scope,
    requests: enqueueRequests
  });
  for (const outcome of enqueueOutcomes) {
    if (outcome.outcome === "enqueued") summary.enqueued++;
    else if (outcome.outcome === "error") summary.errors++;
  }

  const terminalOutcomes = await insertTerminalSyncOperations(args.client, {
    companyId: args.companyId,
    integration: args.providerId,
    trigger: "reconcile",
    createdBy: args.createdBy,
    scope: args.scope,
    requests: terminalRequests
  });
  for (const outcome of terminalOutcomes) {
    if (outcome.outcome === "enqueued") summary.recordedTerminal++;
    else if (outcome.outcome === "error") summary.errors++;
  }

  for (const operationId of redriveOperationIds) {
    const transitioned = await transitionOperation(args.client, {
      id: operationId,
      companyId: args.companyId,
      to: "Pending",
      userId: args.createdBy
    });
    if (transitioned.error) {
      summary.errors++;
      console.warn(
        `[RECONCILE] ${args.companyId}/${args.providerId}: failed to re-drive op ${operationId}: ${transitioned.error}`
      );
    } else {
      summary.redriven++;
    }
  }

  return summary;
}

function isEntityPushEnabled(
  syncConfig: ReturnType<typeof resolveSyncConfig>,
  entityType: ReconcileEntityType
): boolean {
  const config = syncConfig.entities[entityType];
  if (!config) return false;
  return config.enabled && config.direction !== "pull-from-accounting";
}
