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
  CHARGE_CREDIT_PROVIDERS,
  CHARGE_NATIVE_VOID_PROVIDERS,
  type ChargePolicyInput,
  type GlobalSyncConfig,
  MEMO_NATIVE_VOID_PROVIDERS,
  PAYMENT_PUSH_PROVIDERS,
  type ProviderID,
  REIMBURSEMENT_NATIVE_VOID_PROVIDERS,
  type resolveSyncConfig,
  SpendProviderID,
  type SyncContext,
  type SyncEntityType,
  type SyncProvider,
  transitionOperation
} from "@carbon/ee/accounting";
import {
  applyLedgerDelegation,
  type IntegrationTopology
} from "@carbon/ee/sync";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sql } from "kysely";
import {
  applyEffectivePostingState,
  enqueueSyncOperations,
  insertTerminalSyncOperations,
  isJournalEntryPostingEnabled,
  loadChargePolicyInputs,
  resolveMemoJournalParty,
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
  charge: { table: "charge", columns: "id, status, type, updatedAt" },
  // No `type` column to read: unlike a charge, every reimbursement is
  // document-shaped, so there is nothing to discriminate per row.
  reimbursement: { table: "reimbursement", columns: "id, status, updatedAt" },
  payment: { table: "payment", columns: "id, status, updatedAt" },
  customer: { table: "customer", columns: "id, updatedAt" },
  vendor: { table: "supplier", columns: "id, updatedAt" },
  item: { table: "item", columns: "id, updatedAt" },
  purchaseOrder: { table: "purchaseOrder", columns: "id, updatedAt" },
  salesOrder: { table: "salesOrder", columns: "id, updatedAt" },
  // Both memo entity types read the SAME table; the party is carried so the
  // policy can resolve the family without a second read.
  creditMemo: {
    table: "memo",
    columns: "id, status, direction, customerId, supplierId, updatedAt"
  },
  supplierCredit: {
    table: "memo",
    columns: "id, status, direction, customerId, supplierId, updatedAt"
  }
};

/**
 * Which providers can natively void each document type — one lookup, so a new
 * document type cannot inherit another's capability by falling through a chain.
 * Absent from the map means the invoice/bill default.
 */
const NATIVE_VOID_PROVIDERS_BY_ENTITY: Partial<
  Record<ReconcileEntityType, ReadonlySet<string>>
> = {
  charge: CHARGE_NATIVE_VOID_PROVIDERS,
  reimbursement: REIMBURSEMENT_NATIVE_VOID_PROVIDERS,
  creditMemo: MEMO_NATIVE_VOID_PROVIDERS,
  supplierCredit: MEMO_NATIVE_VOID_PROVIDERS
};

/** Invoices and bills: Rillet is the only native document void today. */
const DEFAULT_NATIVE_VOID_PROVIDERS: ReadonlySet<string> = new Set(["rillet"]);

/** Entity types whose decision consults the push mapping. */
const MAPPED_TYPES: ReadonlySet<ReconcileEntityType> = new Set([
  "bill",
  "invoice",
  "charge",
  "reimbursement",
  // Both memo types push as native provider documents and carry a mapping. Left
  // out, `hasMappingWithExternalId` was always false, so even once the decision
  // arm existed every pass would have re-enqueued a duplicate push.
  "creditMemo",
  "supplierCredit",
  "payment",
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
  /**
   * The company's integration topology — who owns each GL family. Injected by
   * the entry point rather than resolved here: resolving it needs the
   * `@carbon/ee` registry, whose import validates the server env.
   */
  topology: IntegrationTopology;
  /**
   * The provider the caller already resolved, for its EFFECTIVE sync config.
   *
   * A SPEND provider resolves its config from its install mode's ceiling and its
   * own stored toggles (`buildSpendSyncConfig` — `pushInvoices` /
   * `pushPurchaseOrders`), and stores none of it under `metadata.syncConfig`. So
   * `resolveSyncConfig` — which reads only that key — hands back
   * `DEFAULT_SYNC_CONFIG` verbatim, where `bill` and `purchaseOrder` are both
   * enabled. Reconciliation therefore enqueued push operations for a family the
   * platform does not sync: the drain resolved the real provider, its syncer
   * skipped on `config.enabled`, and the ledger filled with
   * "Sync disabled in config" rows — one per posted invoice, and (master data
   * has no parked-disposition guard) one per purchase-order edit, forever.
   *
   * Only consulted for spend providers. An accounting provider's config already
   * round-trips through `metadata.syncConfig`, and `getProviderIntegration`
   * additionally FORCES entities (`payment` two-way for Rillet, say) that the
   * generic default has off — so substituting it there would be a behaviour
   * change well outside this gap.
   */
  provider?: Pick<SyncProvider, "getSyncConfig">;
  createdBy: string;
  /** Idempotency scope for this reconcile occasion (event id / run id). */
  scope: string;
  refs: ReconcileRef[];
}): Promise<ReconcileSummary> {
  const summary = emptySummary();
  if (args.refs.length === 0) return summary;

  // One read per reconcile occasion, applying ledger delegation to BOTH the
  // family modes and the backing entities — the pair that is only correct
  // together. With nothing delegated this is byte-identical to the previous
  // two lines.
  const { settings, syncConfig: metadataSyncConfig } =
    applyEffectivePostingState(
      args.integrationMetadata,
      args.topology,
      args.providerId
    );
  const syncConfig = resolveEffectiveSyncConfig({
    providerId: args.providerId,
    provider: args.provider,
    metadataSyncConfig,
    settings,
    topology: args.topology
  });
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

    // "Charge" journals are DOC_BACKED per ROW (only a Charge with
    // a supplier has a provider charge object), so the policy needs the
    // backing charge — resolved through the journal lines so the
    // VOID journal resolves to the same row as the posting journal (one
    // batch of queries, keyed by journal id).
    let chargeByJournalId = new Map<string, ChargePolicyInput>();
    if (entityType === "journalEntry") {
      const cardJournalIds = ids.filter(
        (id) => snapshotById.get(id)?.sourceType === "Charge"
      );
      if (cardJournalIds.length > 0) {
        chargeByJournalId = await loadChargePolicyInputs(args.client, {
          companyId: args.companyId,
          journalIds: cardJournalIds
        });
      }
    }

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

    // Mapping state is loaded in one unbounded SQL query. Payment keys can
    // fan out as <paymentId>:<documentId>; their prefix is the source identity.
    //
    // `lastSyncedAt` is typed to admit a `Date`: this read goes through
    // Kysely, and node-postgres decodes timestamptz as a Date whatever the
    // generated types claim. `reconcileMasterData` compares it as an
    // instant for exactly that reason — do not narrow this to `string`.
    const mappingByEntity = new Map<
      string,
      { externalId: string | null; lastSyncedAt: string | Date | null }
    >();
    const unvoidedPushMappings = new Set<string>();
    if (MAPPED_TYPES.has(entityType)) {
      const mappings = await args.database
        .selectFrom("externalIntegrationMapping")
        .select(["entityId", "externalId", "lastSyncedAt", "metadata"])
        .where("companyId", "=", args.companyId)
        .where("integration", "=", args.providerId)
        .where("entityType", "=", entityType)
        .where(
          entityType === "payment"
            ? sql<string>`split_part("entityId", ':', 1)`
            : "entityId",
          "in",
          ids
        )
        .execute();
      for (const row of mappings) {
        const sourceId =
          entityType === "payment" ? row.entityId.split(":")[0]! : row.entityId;
        mappingByEntity.set(sourceId, {
          externalId: row.externalId,
          lastSyncedAt: row.lastSyncedAt
        });
        const metadata = row.metadata as Record<string, unknown> | null;
        if (
          row.externalId &&
          metadata?.voided !== true &&
          (entityType !== "payment" || metadata?.origin === "carbon")
        ) {
          unvoidedPushMappings.add(sourceId);
        }
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
      let memoParty: "customer" | "supplier" | null = null;
      if (
        entityType === "journalEntry" &&
        (snapshot?.sourceType === "Credit Memo" ||
          snapshot?.sourceType === "Debit Memo")
      ) {
        memoParty = await resolveMemoJournalParty(args.client, {
          companyId: args.companyId,
          journalId: entityId
        });
      }

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
        hasUnvoidedPushMapping: unvoidedPushMappings.has(entityId),
        lastSyncedAt: mappingByEntity.get(entityId)?.lastSyncedAt ?? null,
        hasLiveOperation: liveByEntity.has(entityId),
        latestOperation: latestByEntity.get(entityId) ?? null,
        ...(entityType === "journalEntry"
          ? {
              journalCoverage: {
                normalCovered: coveredEntityIds.has(entityId),
                reversalCovered: coveredEntityIds.has(`${entityId}:reversal`)
              },
              charge: chargeByJournalId.get(entityId) ?? null
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
          // Each document type declares its own native-void capability, as a
          // capability SET. A reimbursement is deletable on all three providers,
          // so a bare provider-id fallback would silently suppress the QBO and
          // Xero void paths their syncers actually implement — leaving the remote
          // document live with nothing failing. Memos are the opposite case: only
          // Rillet can void one, and `MEMO_NATIVE_VOID_PROVIDERS` is where that
          // hole is declared rather than hidden in a comparison here.
          providerSupportsNativeVoid:
            NATIVE_VOID_PROVIDERS_BY_ENTITY[entityType]?.has(args.providerId) ??
            DEFAULT_NATIVE_VOID_PROVIDERS.has(args.providerId),
          journalEntryPushEnabled,
          entityPushEnabled,
          providerSupportsPaymentPush: PAYMENT_PUSH_PROVIDERS.has(
            args.providerId as ProviderID
          ),
          settings,
          docSync: {
            invoiceEnabled: syncConfig.entities.invoice.enabled,
            billEnabled: syncConfig.entities.bill.enabled,
            chargeEnabled: syncConfig.entities.charge.enabled,
            chargeCreditEnabled: CHARGE_CREDIT_PROVIDERS.has(
              args.providerId as ProviderID
            ),
            creditMemoEnabled: syncConfig.entities.creditMemo.enabled,
            supplierCreditEnabled: syncConfig.entities.supplierCredit.enabled,
            reimbursementEnabled: syncConfig.entities.reimbursement.enabled
          },
          inventoryAdjustmentEnabled:
            syncConfig.entities.inventoryAdjustment.enabled,
          paymentFamily,
          memoParty
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

const SPEND_PROVIDER_IDS: ReadonlySet<string> = new Set(
  Object.values(SpendProviderID)
);

/**
 * The config the DRAIN will actually use, so the reconciler cannot enqueue what
 * the syncer is about to skip.
 *
 * Ledger delegation is re-applied over the provider's config rather than
 * skipped: the two halves (`families[x] = "none"` plus disabling the family's
 * backing entities) are only correct together, and the delegate — a spend
 * platform that OWNS a family — must keep its own entities, which is what
 * passing `integrationId` preserves. Re-running it over already-delegated
 * settings is idempotent.
 */
function resolveEffectiveSyncConfig(args: {
  providerId: string;
  provider: Pick<SyncProvider, "getSyncConfig"> | undefined;
  metadataSyncConfig: GlobalSyncConfig;
  settings: Parameters<typeof applyLedgerDelegation>[0]["settings"];
  topology: IntegrationTopology;
}): GlobalSyncConfig {
  if (!args.provider || !SPEND_PROVIDER_IDS.has(args.providerId)) {
    return args.metadataSyncConfig;
  }

  const entities = Object.fromEntries(
    Object.keys(args.metadataSyncConfig.entities).map((entityType) => [
      entityType,
      args.provider?.getSyncConfig(entityType as SyncEntityType) ??
        args.metadataSyncConfig.entities[entityType as SyncEntityType]
    ])
  ) as GlobalSyncConfig["entities"];

  return applyLedgerDelegation({
    settings: args.settings,
    syncConfig: { entities },
    topology: args.topology,
    integrationId: args.providerId
  }).syncConfig;
}

function isEntityPushEnabled(
  syncConfig: ReturnType<typeof resolveSyncConfig>,
  entityType: ReconcileEntityType
): boolean {
  const config = syncConfig.entities[entityType];
  if (!config) return false;
  return config.enabled && config.direction !== "pull-from-accounting";
}
