// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

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
  type SyncResult,
  toSyncResultError
} from "../accounting/core/types";
import { withTriggersDisabled } from "../accounting/core/utils";

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
      result.set(localId, await this.pushAndRecord(localId, payload));
    }
    return result;
  }

  /**
   * Push ONE document and persist its mapping immediately, in its own
   * transaction. The separate transaction is the whole point: the remote id has
   * to survive the NEXT item's failure.
   */
  private async pushAndRecord(
    localId: string,
    payload: Omit<TRemote, TOmit>
  ): Promise<string> {
    const remoteId = await this.upsertRemote(payload, localId);
    await withTriggersDisabled(this.database, async (tx) => {
      await this.linkEntities(tx, localId, remoteId);
    });
    return remoteId;
  }

  private summarize(results: SyncResult[]): BatchSyncResult {
    return {
      results,
      successCount: results.filter((r) => r.status === "success").length,
      errorCount: results.filter((r) => r.status === "error").length,
      skippedCount: results.filter((r) => r.status === "skipped").length
    };
  }

  /**
   * Batch push, one item at a time, each SETTLED before the next starts.
   *
   * The base implementation collects every remote id first and writes all the
   * mappings afterwards in one `linkBatch`. For a push-only spend platform that
   * is a data-integrity bug rather than an optimisation. The drain groups every
   * claimed operation of one `(entityType, direction)` into a single call
   * (`drainSyncOperations`), so a second document failing threw out of the loop
   * before the first one's remote id had been persisted: the base `catch` then
   * marked the WHOLE batch Failed, and the document that really did reach the
   * platform was left with no mapping at all.
   *
   * For a Ramp draft bill that is not recoverable. The create is create-once —
   * a second create with the same `remote_id` is refused
   * `409 DEVELOPER_7153` — and with the mapping missing, `shouldSync` has
   * nothing to short-circuit on, so the retry creates again, 409s, and the
   * invoice is permanently unsyncable with nothing pointing at its draft. The
   * idempotency key does not save it either: a provider's replay window is not
   * a durable dedupe (Ramp documents no window at all), which is the same
   * reasoning behind the per-application `qboMemoApplication` row.
   *
   * `fetchLocalBatch` is still called ONCE for the whole page, so a syncer that
   * prefetches per page — Ramp's purchase orders do one mapping read plus at
   * most one vendor scan for the page — keeps that. Only the settling is
   * per item. `RilletEntitySyncer.pushBatchToAccounting` loops for the
   * neighbouring reason (its structured failures must survive the batch path).
   */
  async pushBatchToAccounting(entityIds: string[]): Promise<BatchSyncResult> {
    if (!this.config.enabled) {
      return this.summarize(
        entityIds.map((localId) => ({
          status: "skipped" as const,
          action: "none" as const,
          localId,
          error: "Sync disabled in config"
        }))
      );
    }

    let localEntities: Map<string, TLocal>;
    try {
      localEntities = await this.fetchLocalBatch(entityIds);
    } catch (err) {
      // A load failure really is the whole batch: nothing was pushed.
      return this.summarize(
        entityIds.map((localId) => ({
          status: "error" as const,
          action: "none" as const,
          localId,
          error: toSyncResultError(err)
        }))
      );
    }

    const results: SyncResult[] = [];

    for (const localId of entityIds) {
      const localEntity = localEntities.get(localId);
      if (!localEntity) {
        results.push({
          status: "error",
          action: "none",
          localId,
          error: `Entity ${localId} not found in Carbon`
        });
        continue;
      }

      try {
        if (this.shouldSync) {
          // `isFirstSync: true` as in the base batch path — a mapping check per
          // item would cost a read the syncers that need one already do
          // themselves (Ramp's bill syncer refuses a mapped invoice here).
          const shouldSync = await this.shouldSync({
            direction: "push",
            localEntity,
            isFirstSync: true,
            entityId: localId
          });

          if (shouldSync !== true) {
            results.push({
              status: "skipped",
              action: "none",
              localId,
              error:
                typeof shouldSync === "string"
                  ? shouldSync
                  : "Entity not eligible for sync"
            });
            continue;
          }
        }

        const remoteId = await this.pushAndRecord(
          localId,
          await this.mapToRemote(localEntity)
        );

        results.push({
          status: "success",
          action: "updated",
          localId,
          remoteId
        });
      } catch (err) {
        results.push({
          status: "error",
          action: "none",
          localId,
          error: toSyncResultError(err)
        });
      }
    }

    return this.summarize(results);
  }
}
