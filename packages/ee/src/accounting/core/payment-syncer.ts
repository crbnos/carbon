import type { KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";
import { createMappingService } from "./external-mapping";
import { ProviderID } from "./models";
import {
  type NormalizedPayment,
  SETTLEMENT_KEY_SEPARATOR,
  upsertLocalPaymentDraft
} from "./payment-application";
import {
  isPaymentSyncbackEnabled,
  JournalEntrySyncError,
  toPostingDateString
} from "./posting";
import {
  BaseEntitySyncer,
  type BatchSyncResult,
  type SyncResult
} from "./types";
import { withTriggersDisabled } from "./utils";

/**
 * PaymentSyncerBase — the family-agnostic, PULL-ONLY base for every payment
 * syncer. Providers implement `mapToNormalized` (native payment object →
 * NormalizedPayment) plus the remote-fetch/timestamp/shouldSync methods; the
 * base owns the write half:
 *
 *  1. In the base pull transaction, `upsertLocal` writes an idempotent **Draft**
 *     `payment` + `invoiceSettlement` via `upsertLocalPaymentDraft`.
 *  2. AFTER the transaction commits, the pull override invokes the native
 *     `post-payment` edge function (`{ type: "post" }` for a settled payment,
 *     `{ type: "void" }` for a failed/void one), which builds the GL journal,
 *     sets `payment.journalId`, flips the status to Posted/Voided, and lets the
 *     invoice/bill status derive from the settlement.
 *
 * Posting is a separate invocation (not the base `withTriggersDisabled` tx) — it
 * runs with triggers ENABLED, exactly like a user posting a payment. Its journal
 * is a DOC_BACKED disposition and is never re-pushed to the provider, so the
 * provider's GL is not double-posted. This is intentional; do not add extra
 * trigger suppression around the post-payment call.
 */

export const PAYMENT_PULL_ONLY_MESSAGE =
  "Payments are pull-only: pushing Carbon payments to the accounting provider is not supported";

/**
 * Providers whose payment syncer overrides `supportsPaymentPush = true` — i.e.
 * they can write a Carbon-born payment back out as a provider payment document
 * (Phase G outbound write-back). The reconciler and the outbound sweep read
 * this to decide whether to page posted payments as candidate push refs.
 *
 * MUST stay in sync with each provider syncer's `supportsPaymentPush` override
 * (RilletPaymentSyncer, XeroPaymentSyncer, QboPaymentSyncer) — a provider in
 * this set whose syncer still rejects push would enqueue ops that only ever
 * Skip, and a provider absent from it whose syncer supports push would never be
 * swept.
 */
export const PAYMENT_PUSH_PROVIDERS: ReadonlySet<ProviderID> = new Set([
  ProviderID.RILLET,
  ProviderID.XERO,
  ProviderID.QUICKBOOKS
]);

type PendingPost = {
  paymentRowId: string;
  postAction: "post" | "void" | "none";
  actorId: string;
};

export abstract class PaymentSyncerBase<TRemote> extends BaseEntitySyncer<
  TRemote,
  TRemote,
  never
> {
  /**
   * Keyed by the composite remote id, populated during `upsertLocal` (inside the
   * base pull tx) and drained after commit to invoke `post-payment`.
   */
  private pendingPosts = new Map<string, PendingPost>();

  /**
   * Per-instance cache of the resolved integration metadata read from
   * `companyIntegration.metadata`. A drain reuses one syncer across its claimed
   * operations, so the read happens at most once per drain (mirrors the
   * journal-entry syncers' `getPostingSyncSettings` cache).
   */
  private integrationMetadataPromise?: Promise<unknown>;

  // =================================================================
  // Provider contract
  // =================================================================

  /** Map the native payment object + composite entity id → NormalizedPayment. */
  protected abstract mapToNormalized(
    remote: TRemote,
    entityId: string
  ): NormalizedPayment;

  // fetchRemote / fetchRemoteBatch / getRemoteUpdatedAt / shouldSync are
  // implemented by concrete providers.

  // =================================================================
  // Write half (shared)
  // =================================================================

  /**
   * Identity passthrough: the real normalization needs the composite entity id,
   * which is only available in `upsertLocal`. The base pull flow calls
   * `mapToLocal(remote)` (no id) then `upsertLocal(tx, data, remoteId)`, so we
   * carry the raw remote through `data` and normalize in `upsertLocal`.
   */
  protected async mapToLocal(remote: TRemote): Promise<Partial<TRemote>> {
    return remote;
  }

  protected async upsertLocal(
    tx: KyselyTx,
    data: Partial<TRemote>,
    remoteId: string
  ): Promise<string> {
    const normalized = this.mapToNormalized(data as TRemote, remoteId);
    const actorId = await this.getDefaultUser(tx);
    const bankAccount = await this.getBankCashAccount(tx);

    const result = await upsertLocalPaymentDraft(tx, {
      providerId: this.provider.id,
      companyId: this.companyId,
      actorId,
      bankAccount,
      paymentMappingId: remoteId,
      getNextReadableId: () => this.getNextPaymentReadableId(tx, normalized),
      normalized
    });

    this.pendingPosts.set(remoteId, {
      paymentRowId: result.paymentRowId,
      postAction: result.postAction,
      actorId
    });

    return result.paymentRowId;
  }

  // =================================================================
  // Pull overrides: base upsert (Draft) + post-payment after commit
  // =================================================================

  /**
   * Payment mappings are identity-critical, so the base link is unsafe here:
   * a payment Carbon pushed already carries this remote id — under a
   * settlement-scoped key (`<paymentId>:<docId>`) for a multi-settlement
   * fan-out — with `metadata.origin = "carbon"` (the void-echo routing flag).
   * The base `link` would insert a second row for the same externalId (fatal:
   * the mapping table's unique-externalId constraint) or, on the bare-id
   * upsert path, `doUpdateSet` the metadata to null and wipe the origin.
   * When ANY payment mapping already carries this remote id, refresh its sync
   * timestamps and leave the row alone; only a genuinely new pull links.
   */
  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    const txMapping = createMappingService(tx, this.companyId);
    const existing = await txMapping.getByExternalId(
      this.provider.id,
      remoteId,
      "payment"
    );
    if (existing) {
      await txMapping.touchLastSyncedAt(
        "payment",
        existing.entityId,
        this.provider.id,
        remoteUpdatedAt
      );
      return;
    }
    await super.linkEntities(tx, localId, remoteId, remoteUpdatedAt);
  }

  async pullFromAccounting(remoteId: string): Promise<SyncResult> {
    const result = await super.pullFromAccounting(remoteId);
    return this.applyPostPayment(remoteId, result);
  }

  async pullBatchFromAccounting(remoteIds: string[]): Promise<BatchSyncResult> {
    const batch = await super.pullBatchFromAccounting(remoteIds);

    const results: SyncResult[] = [];
    for (const result of batch.results) {
      results.push(
        result.remoteId
          ? await this.applyPostPayment(result.remoteId, result)
          : result
      );
    }

    return {
      results,
      successCount: results.filter((r) => r.status === "success").length,
      errorCount: results.filter((r) => r.status === "error").length,
      skippedCount: results.filter((r) => r.status === "skipped").length
    };
  }

  /**
   * After the base upsert commits, invoke `post-payment` for the drained
   * pending write. A post-payment failure surfaces as an `error` result (its
   * message carried through) rather than being swallowed.
   */
  private async applyPostPayment(
    remoteId: string,
    result: SyncResult
  ): Promise<SyncResult> {
    const pending = this.pendingPosts.get(remoteId);
    this.pendingPosts.delete(remoteId);

    if (
      result.status !== "success" ||
      !result.localId ||
      !pending ||
      pending.postAction === "none"
    ) {
      return result;
    }

    const posted = await this.invokePostPayment(
      pending.paymentRowId,
      pending.postAction,
      pending.actorId
    );

    if (posted.error) {
      return {
        status: "error",
        action: "none",
        localId: result.localId,
        remoteId,
        error: posted.message
      };
    }

    return result;
  }

  private async invokePostPayment(
    paymentId: string,
    type: "post" | "void",
    userId: string
  ): Promise<{ error: false } | { error: true; message: string }> {
    // Dynamic import: keeps the server-only auth/env module out of the module
    // graph for consumers (and tests) that never post a payment (mirrors the
    // base's dynamic import of the SyncFactory).
    const { getCarbonServiceRole } = await import("@carbon/auth/client.server");
    const serviceRole = getCarbonServiceRole();
    const response = await serviceRole.functions.invoke("post-payment", {
      body: { type, paymentId, userId, companyId: this.companyId }
    });

    if (response.error) {
      const message =
        (response.data as { message?: string } | undefined)?.message ??
        response.error.message ??
        `Failed to ${type} payment ${paymentId}`;
      return { error: true, message };
    }
    return { error: false };
  }

  // =================================================================
  // Documents-mode sync-back gate (Phase 0.4)
  // =================================================================

  /**
   * The company's raw `companyIntegration.metadata` for this provider, read
   * once per syncer instance. The provider only carries the RESOLVED sync
   * config, not the raw `settings.postingSync` fragment, so the gate reads the
   * metadata directly (same keying + caching as the journal-entry syncers).
   */
  private getIntegrationMetadata(): Promise<unknown> {
    if (!this.integrationMetadataPromise) {
      this.integrationMetadataPromise = (async () => {
        const integration = await this.database
          .selectFrom("companyIntegration")
          .select("metadata")
          .where("id", "=", this.provider.id)
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();
        return integration?.metadata;
      })();
    }
    return this.integrationMetadataPromise;
  }

  /**
   * Whether inbound payment sync-back is allowed for the given AR/AP family:
   * true ONLY when that family is in `documents` mode. Providers call this from
   * `shouldSync` to skip the pull for `journals`/`none` families. An
   * absent/invalid config resolves to defaults (documents), so an unconfigured
   * integration keeps sync-back enabled.
   */
  protected async isPaymentSyncbackEnabled(
    family: "ar" | "ap"
  ): Promise<boolean> {
    return isPaymentSyncbackEnabled(
      await this.getIntegrationMetadata(),
      family
    );
  }

  // =================================================================
  // Shared resolution helpers (moved from RilletPaymentSyncer)
  // =================================================================

  /** Next readable payment id via get_next_sequence, with a stable fallback. */
  protected async getNextPaymentReadableId(
    tx: KyselyTx,
    normalized: NormalizedPayment
  ): Promise<string> {
    const sequence = await sql<{ get_next_sequence: string }>`
      SELECT get_next_sequence('payment', ${this.companyId}) as get_next_sequence
    `.execute(tx);
    return (
      sequence.rows[0]?.get_next_sequence ??
      `PAY-${normalized.paymentRemoteId.slice(0, 8)}`
    );
  }

  /** accountDefault.bankCashAccount — payment.bankAccount is NOT NULL. */
  protected async getBankCashAccount(tx: KyselyTx): Promise<string> {
    const defaults = await tx
      .selectFrom("accountDefault")
      .select("bankCashAccount")
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    if (!defaults?.bankCashAccount) {
      throw new Error(
        `No bank/cash account default (accountDefault.bankCashAccount) configured for company ${this.companyId} — required to record pulled payments`
      );
    }
    return defaults.bankCashAccount;
  }

  /**
   * Default user for system-generated records: company group owner, then first
   * active employee (QBO/Xero bill-syncer parity).
   */
  protected async getDefaultUser(tx: KyselyTx): Promise<string> {
    const group = await tx
      .selectFrom("company")
      .innerJoin("companyGroup", "companyGroup.id", "company.companyGroupId")
      .select("companyGroup.ownerId")
      .where("company.id", "=", this.companyId)
      .executeTakeFirst();

    if (group?.ownerId) {
      return group.ownerId;
    }

    const employee = await tx
      .selectFrom("employeeJob")
      .innerJoin("user", "user.id", "employeeJob.id")
      .select("employeeJob.id")
      .where("employeeJob.companyId", "=", this.companyId)
      .where("user.active", "=", true)
      .orderBy("user.createdAt", "asc")
      .limit(1)
      .executeTakeFirst();

    if (!employee?.id) {
      throw new Error(
        `Cannot record pulled payment: no default user found for company ${this.companyId}`
      );
    }
    return employee.id;
  }

  // =================================================================
  // Push workflow (Phase G — outbound payment write-back)
  // =================================================================

  /**
   * Whether this provider can write a Carbon-born payment back out as a
   * provider payment document. Off by default (QBO/Xero keep rejecting push);
   * RilletPaymentSyncer sets it true. When false, `pushToAccounting` returns
   * the pull-only error and `pushRemotePayment` is never reached.
   */
  protected supportsPaymentPush = false;

  /**
   * Whether this provider can echo a void of a Carbon-pushed payment back out.
   * Off in v1 for every provider (Rillet has no payment-void endpoint) — a
   * voided Carbon-originated payment lands a Skipped op telling the operator to
   * void it in the provider by hand.
   */
  protected supportsPaymentVoidPush = false;

  /**
   * Provider adapter: create ONE provider payment document for the settled
   * Carbon document and return its remote id plus the composite entity id the
   * `payment` mapping is stored under (`<invoiceRemoteId>:<paymentRemoteId>` for
   * AR, `bill:<billRemoteId>:<paymentRemoteId>` for AP). Resolves the settled
   * document's remote id and the bank account's provider code itself, throwing a
   * `JournalEntrySyncError` (warning) when either mapping is missing. Only
   * reached when `supportsPaymentPush` is true.
   */
  protected pushRemotePayment(
    _context: PaymentPushContext
  ): Promise<{ remoteId: string; compositeEntityId: string }> {
    throw new Error(PAYMENT_PULL_ONLY_MESSAGE);
  }

  async pushToAccounting(entityId: string): Promise<SyncResult> {
    if (!this.supportsPaymentPush) {
      return {
        status: "error",
        action: "none",
        localId: entityId,
        error: PAYMENT_PULL_ONLY_MESSAGE
      };
    }

    if (!this.config.enabled) {
      return {
        status: "skipped",
        action: "none",
        localId: entityId,
        error: "Sync disabled in config"
      };
    }

    try {
      const payment = await this.loadLocalPaymentForPush(entityId);
      if (!payment) {
        return {
          status: "error",
          action: "none",
          localId: entityId,
          error: `Payment ${entityId} not found in Carbon`
        };
      }

      // The event trigger only enqueues on transitions to Posted/Voided, but
      // guard anyway — a Draft payment has no settled GL to represent.
      if (payment.status !== "Posted" && payment.status !== "Voided") {
        return skipped(
          entityId,
          `Payment is ${payment.status} — only Posted or Voided payments push`
        );
      }

      const family: "ar" | "ap" =
        payment.paymentType === "Receipt" ? "ar" : "ap";

      // Same gate as inbound pull: outbound push only runs while the family is
      // in documents mode (the provider owns the settled document, so a payment
      // document is what closes it). In journals/none mode Carbon's payment is
      // represented by the v3 journal path, not a document.
      if (!(await this.isPaymentSyncbackEnabled(family))) {
        return skipped(
          entityId,
          `payment push is disabled: the ${family} family is not in documents mode`
        );
      }

      // Origin routing via the payment mapping. A pulled payment links its
      // mapping in the pull upsert BEFORE post-payment flips it to Posted, so
      // its Posted event finds a mapping here and skips — the loop guard.
      const mapping = await this.mappingService.getByEntity(
        "payment",
        entityId,
        this.provider.id
      );

      if (payment.status === "Voided") {
        return this.pushVoid(entityId, mapping);
      }

      if (mapping?.externalId) {
        // Provider-known (pulled) or already pushed — idempotent skip.
        return {
          status: "skipped",
          action: "none",
          localId: entityId,
          remoteId: mapping.externalId,
          error: `Payment ${entityId} already linked to ${this.provider.id} — skipping (idempotent)`
        };
      }

      // A Carbon-born payment: push it — ONE provider payment per settled
      // document (a multi-document payment fans out to N provider
      // payments, each for its settlement's appliedAmount). Discounted and
      // FX payments remain parked as Skipped (documented follow-ups).
      const settlements = [...payment.settlements].sort((a, b) => {
        const aTarget =
          (family === "ar"
            ? a.targetSalesInvoiceId
            : a.targetPurchaseInvoiceId) ?? "";
        const bTarget =
          (family === "ar"
            ? b.targetSalesInvoiceId
            : b.targetPurchaseInvoiceId) ?? "";
        return aTarget.localeCompare(bTarget);
      });
      if (settlements.length === 0) {
        return skipped(
          entityId,
          `Payment ${entityId} has no settlements — nothing to push`
        );
      }
      if (
        settlements.some(
          (settlement) =>
            settlement.discountAmount !== 0 || settlement.writeOffAmount !== 0
        )
      ) {
        return skipped(
          entityId,
          `Payment ${entityId} carries a discount or write-off — outbound push of adjusted payments is not supported in v1`
        );
      }
      if (payment.exchangeRate !== 1) {
        return skipped(
          entityId,
          `Payment ${entityId} is foreign-currency (rate ${payment.exchangeRate}) — outbound FX payment push is not supported in v1`
        );
      }

      // One mapping row per settlement makes the fan-out RESUMABLE: each
      // pushed provider payment is linked immediately, so a failure on
      // settlement k (e.g. its document not yet synced) leaves 1..k-1
      // durable, and the retry pushes only what is still uncovered.
      // Mapping entity keys: the bare payment id for single-settlement
      // (back-compat with every existing v1 mapping) and
      // `<paymentId>:<targetDocumentId>` per settlement otherwise.
      const settlementKey = (targetDocumentId: string): string =>
        settlements.length === 1
          ? entityId
          : `${entityId}${SETTLEMENT_KEY_SEPARATOR}${targetDocumentId}`;

      let firstRemoteId: string | null = null;
      for (const settlement of settlements) {
        const targetDocumentId =
          family === "ar"
            ? settlement.targetSalesInvoiceId
            : settlement.targetPurchaseInvoiceId;
        if (!targetDocumentId) {
          return skipped(
            entityId,
            `Payment ${entityId} settlement has no ${
              family === "ar" ? "sales" : "purchase"
            } invoice target`
          );
        }

        const covered = await this.mappingService.getByEntity(
          "payment",
          settlementKey(targetDocumentId),
          this.provider.id
        );
        if (covered?.externalId) {
          firstRemoteId ??= covered.externalId;
          continue;
        }

        const { remoteId, compositeEntityId } = await this.pushRemotePayment({
          carbonPaymentId: entityId,
          family,
          targetDocumentId,
          bankAccountId: payment.bankAccount,
          amount: settlement.appliedAmount,
          currencyCode: payment.currencyCode,
          paidDate: payment.paidDate,
          reference: payment.reference
        });
        firstRemoteId ??= remoteId;

        // Stamp origin:"carbon" so a subsequent void of THIS payment echoes
        // out (pulled payments have no origin and never echo their void
        // back), and so a later pull of the same provider payment
        // recognizes the composite and no-ops. Linked per settlement so
        // partial fan-out progress survives a failure. Trigger-suppressed
        // to break the sync loop.
        await withTriggersDisabled(this.database, async (tx) => {
          await createMappingService(tx, this.companyId).link(
            "payment",
            settlementKey(targetDocumentId),
            this.provider.id,
            compositeEntityId,
            { metadata: { origin: "carbon" } }
          );
        });
      }

      return {
        status: "success",
        action: "created",
        localId: entityId,
        remoteId: firstRemoteId ?? undefined
      };
    } catch (err) {
      if (err instanceof JournalEntrySyncError) {
        return {
          status: "error",
          action: "none",
          localId: entityId,
          error: err.failure
        };
      }
      return {
        status: "error",
        action: "none",
        localId: entityId,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * A Carbon payment reaching Voided. Echo the void to the provider ONLY for a
   * payment Carbon originated and pushed (mapping stamped origin:"carbon") — a
   * pulled payment voided in the provider already reversed there, so re-pushing
   * would loop. v1 has no provider void endpoint, so this always Skips with a
   * manual-remediation message; it is the seam a provider void hook plugs into.
   */
  private pushVoid(
    entityId: string,
    mapping: { metadata: Record<string, unknown> | null } | null
  ): SyncResult {
    const carbonOrigin =
      mapping?.metadata != null && mapping.metadata.origin === "carbon";
    if (!carbonOrigin) {
      return skipped(
        entityId,
        `Voided payment ${entityId} has no Carbon-originated provider payment to reverse`
      );
    }
    if (!this.supportsPaymentVoidPush) {
      return skipped(
        entityId,
        `Voiding a pushed payment in ${this.provider.id} is not supported in v1 — void it manually in the provider`
      );
    }
    // No provider implements void push in v1; when one does, call its void
    // adapter here.
    return skipped(
      entityId,
      `Voiding a pushed payment in ${this.provider.id} is not supported in v1`
    );
  }

  async pushBatchToAccounting(entityIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = [];
    for (const entityId of entityIds) {
      results.push(await this.pushToAccounting(entityId));
    }
    return {
      results,
      successCount: results.filter((r) => r.status === "success").length,
      errorCount: results.filter((r) => r.status === "error").length,
      skippedCount: results.filter((r) => r.status === "skipped").length
    };
  }

  /**
   * Load the Carbon payment + its settlements for an outbound push. Numeric
   * columns arrive as strings from Kysely and are coerced. `paidDate` is the
   * posting date when set (accounting on), else the payment date.
   */
  private async loadLocalPaymentForPush(
    paymentId: string
  ): Promise<LocalPaymentForPush | null> {
    const payment = await this.database
      .selectFrom("payment")
      .select([
        "id",
        "status",
        "paymentType",
        "customerId",
        "supplierId",
        "bankAccount",
        "currencyCode",
        "exchangeRate",
        "paymentDate",
        "postingDate",
        "reference"
      ])
      .where("id", "=", paymentId)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    if (!payment) return null;

    const settlements = await this.database
      .selectFrom("invoiceSettlement")
      .select([
        "targetSalesInvoiceId",
        "targetPurchaseInvoiceId",
        "appliedAmount",
        "discountAmount",
        "writeOffAmount"
      ])
      .where("paymentId", "=", paymentId)
      .where("companyId", "=", this.companyId)
      .execute();

    return {
      status: payment.status,
      paymentType: payment.paymentType,
      bankAccount: payment.bankAccount,
      currencyCode: payment.currencyCode,
      exchangeRate: Number(payment.exchangeRate ?? 1),
      // Kysely's pg driver hands DATE columns back as Date objects (local
      // midnight) — toPostingDateString recovers the stored calendar date
      // for both Date and string values; a bare .slice crashed the push.
      paidDate: toPostingDateString(payment.postingDate ?? payment.paymentDate),
      reference: payment.reference,
      settlements: settlements.map((s) => ({
        targetSalesInvoiceId: s.targetSalesInvoiceId,
        targetPurchaseInvoiceId: s.targetPurchaseInvoiceId,
        appliedAmount: Number(s.appliedAmount ?? 0),
        discountAmount: Number(s.discountAmount ?? 0),
        writeOffAmount: Number(s.writeOffAmount ?? 0)
      }))
    };
  }

  // fetchLocal / mapToRemote / upsertRemote are unused by the bespoke push
  // above (which reads the Carbon payment directly), but the abstract base
  // still declares them — keep them as hard rejections.
  async fetchLocal(_id: string): Promise<TRemote | null> {
    throw new Error(PAYMENT_PULL_ONLY_MESSAGE);
  }

  protected async fetchLocalBatch(
    _ids: string[]
  ): Promise<Map<string, TRemote>> {
    throw new Error(PAYMENT_PULL_ONLY_MESSAGE);
  }

  protected async mapToRemote(_local: TRemote): Promise<TRemote> {
    throw new Error(PAYMENT_PULL_ONLY_MESSAGE);
  }

  protected async upsertRemote(
    _data: TRemote,
    _localId: string
  ): Promise<string> {
    throw new Error(PAYMENT_PULL_ONLY_MESSAGE);
  }

  protected async upsertRemoteBatch(
    _data: Array<{ localId: string; payload: TRemote }>
  ): Promise<Map<string, string>> {
    throw new Error(PAYMENT_PULL_ONLY_MESSAGE);
  }
}

/** Context handed to a provider's `pushRemotePayment` adapter (Phase G). */
export interface PaymentPushContext {
  carbonPaymentId: string;
  family: "ar" | "ap";
  /** Carbon salesInvoice (AR) or purchaseInvoice (AP) id being settled. */
  targetDocumentId: string;
  /** Carbon account id (payment.bankAccount) the payment clears through. */
  bankAccountId: string;
  amount: number;
  currencyCode: string;
  /** YYYY-MM-DD. */
  paidDate: string;
  reference: string | null;
}

type LocalPaymentForPush = {
  status: "Draft" | "Posted" | "Voided";
  paymentType: "Receipt" | "Disbursement";
  bankAccount: string;
  currencyCode: string;
  exchangeRate: number;
  paidDate: string;
  reference: string | null;
  settlements: Array<{
    targetSalesInvoiceId: string | null;
    targetPurchaseInvoiceId: string | null;
    appliedAmount: number;
    discountAmount: number;
    writeOffAmount: number;
  }>;
};

function skipped(entityId: string, reason: string): SyncResult {
  return {
    status: "skipped",
    action: "none",
    localId: entityId,
    error: reason
  };
}
