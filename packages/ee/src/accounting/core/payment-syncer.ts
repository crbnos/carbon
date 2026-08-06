import type { KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";
import {
  type NormalizedPayment,
  upsertLocalPaymentDraft
} from "./payment-application";
import { isPaymentSyncbackEnabled } from "./posting";
import {
  BaseEntitySyncer,
  type BatchSyncResult,
  type SyncResult
} from "./types";

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
  // Push workflow — not supported (pull-only)
  // =================================================================

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

  async pushToAccounting(entityId: string): Promise<SyncResult> {
    return {
      status: "error",
      action: "none",
      localId: entityId,
      error: PAYMENT_PULL_ONLY_MESSAGE
    };
  }

  async pushBatchToAccounting(entityIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = entityIds.map((entityId) => ({
      status: "error",
      action: "none",
      localId: entityId,
      error: PAYMENT_PULL_ONLY_MESSAGE
    }));

    return {
      results,
      successCount: 0,
      errorCount: results.length,
      skippedCount: 0
    };
  }
}
