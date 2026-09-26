/**
 * The base every spend-platform entity syncer extends.
 *
 * A spend platform's outbound documents are push-only by construction, and for a
 * different reason than an accounting provider's push-only entities: the
 * platform DOES send Carbon the downstream artifacts (card charges, bills,
 * reimbursements), but those arrive through its own status feed and batched
 * confirm protocol, which has no Carbon row event to hang a syncer on. So the
 * inbound families stay on their own sweep, and everything here only ever
 * pushes.
 *
 * Provider-agnostic on purpose: nothing below names a platform. A provider's
 * subclass adds only its own API-client accessor.
 */

import type { KyselyTx } from "@carbon/database/client";
import {
  BaseEntitySyncer,
  type BatchSyncResult,
  type SyncResult
} from "../accounting/core/types";

export abstract class SpendPushOnlyEntitySyncer<
  TLocal,
  TRemote,
  TOmit extends string | symbol | number
> extends BaseEntitySyncer<TLocal, TRemote, TOmit> {
  /** Plural label used in push-only rejection messages, e.g. "Purchase orders". */
  protected abstract get pushOnlyEntityLabel(): string;

  /** The platform's display name, for those same messages. */
  protected abstract get spendPlatformLabel(): string;

  private get pushOnlyReason(): string {
    return `${this.pushOnlyEntityLabel} are push-only for ${this.spendPlatformLabel}: pulling into Carbon is not supported`;
  }

  // =================================================================
  // PULL — never supported (see the file header)
  // =================================================================

  protected async fetchRemote(_id: string): Promise<TRemote | null> {
    return null;
  }

  protected async fetchRemoteBatch(
    _ids: string[]
  ): Promise<Map<string, TRemote>> {
    return new Map();
  }

  protected getRemoteUpdatedAt(_remote: TRemote): Date | null {
    return null;
  }

  protected async mapToLocal(_remote: TRemote): Promise<Partial<TLocal>> {
    throw new Error(
      `${this.pushOnlyEntityLabel} are push-only for ${this.spendPlatformLabel}. Cannot map into Carbon.`
    );
  }

  protected async upsertLocal(
    _tx: KyselyTx,
    _data: Partial<TLocal>,
    _remoteId: string
  ): Promise<string> {
    throw new Error(
      `${this.pushOnlyEntityLabel} are push-only for ${this.spendPlatformLabel}. Cannot upsert locally.`
    );
  }

  async pullFromAccounting(remoteId: string): Promise<SyncResult> {
    return {
      status: "error",
      action: "none",
      remoteId,
      error: this.pushOnlyReason
    };
  }

  async pullBatchFromAccounting(remoteIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = remoteIds.map((remoteId) => ({
      status: "error" as const,
      action: "none" as const,
      remoteId,
      error: this.pushOnlyReason
    }));

    return {
      results,
      successCount: 0,
      errorCount: results.length,
      skippedCount: 0
    };
  }

  /**
   * Spend platforms write one document per call — none of them offers a bulk
   * endpoint — so a batch is a sequential loop. Each success is recorded before
   * the next item runs, so a later failure cannot lose an earlier remote id.
   */
  protected async upsertRemoteBatch(
    data: Array<{ localId: string; payload: Omit<TRemote, TOmit> }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload, localId));
    }
    return result;
  }
}
