import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { getAccountMappings } from "../../../core/account-mapping";
import { JournalEntrySyncError, roundCurrency } from "../../../core/posting";
import {
  type Accounting,
  BaseEntitySyncer,
  type BatchSyncResult,
  type SyncResult
} from "../../../core/types";
import { withTriggersDisabled } from "../../../core/utils";
import { parseRilletDate, type Rillet } from "../models";
import type { RilletProvider } from "../provider";

/**
 * Shared plumbing for the Rillet entity syncers:
 *
 * - `RilletEntitySyncer` — a thin BaseEntitySyncer specialization for the
 *   push-only master-data syncers (customer, vendor, item): preserves
 *   structured JournalEntrySyncFailure envelopes on `SyncResult.error`
 *   (the same pushToAccounting-override pattern the Xero/QBO syncers
 *   established) and centralizes the push-only pull rejections.
 * - `RilletTransactionSyncer` — the create-only variant for documents
 *   (invoice, bill, journal entry): pushed documents are immutable in v1,
 *   so an existing mapping is a hard skip (the QBO journal-syncer
 *   contract), replacing the master-data lastSyncedAt fast bailout.
 * - Pure mapping helpers (money formatting, the all-or-nothing address
 *   group, payment-terms parsing, the carbon external reference) exported
 *   for tests.
 */

/** external_references entries Carbon writes always use this type. */
export const RILLET_CARBON_REFERENCE_TYPE = "carbon";

/**
 * Origin tag for multi-instance deployments: several self-hosted Carbon
 * instances can write to one Rillet organization (one subsidiary each),
 * and Carbon entity ids are only unique within one database. The company
 * reference makes every pushed document's origin auditable from Rillet.
 */
export const RILLET_CARBON_COMPANY_REFERENCE_TYPE = "carbon-company";

export function carbonExternalReference(id: string): Rillet.ExternalReference {
  return { type: RILLET_CARBON_REFERENCE_TYPE, id };
}

export function carbonCompanyExternalReference(
  companyId: string
): Rillet.ExternalReference {
  return { type: RILLET_CARBON_COMPANY_REFERENCE_TYPE, id: companyId };
}

/** Format a number as Rillet money — a 2-dp decimal STRING plus currency. */
export function toRilletMoney(
  amount: number,
  currency: string
): Rillet.MonetaryAmount {
  return { amount: roundCurrency(amount).toFixed(2), currency };
}

/**
 * Rillet addresses are an all-or-nothing group (line1/city/state/zip_code/
 * country must all be present) — the first Carbon address maps only when
 * complete; a partial address is omitted entirely.
 */
export function mapContactAddressToRilletAddress(
  local: Accounting.Contact
): Rillet.Address | undefined {
  const address = local.addresses[0];
  if (!address) return undefined;

  const { line1, line2, city, region, postalCode, country } = address;
  if (!line1 || !city || !region || !postalCode || !country) return undefined;

  return {
    line1,
    ...(line2 ? { line2 } : {}),
    city,
    state: region,
    zip_code: postalCode,
    country
  };
}

/**
 * Carbon contact paymentTerms is free text; Rillet wants integer days.
 * Only a bare non-negative integer maps (optionally capped — vendors are
 * limited to 0-180 days); anything else is omitted rather than guessed.
 */
export function mapPaymentTermsToRilletDays(
  paymentTerms: string | null | undefined,
  options?: { max?: number }
): number | undefined {
  if (!paymentTerms) return undefined;
  const trimmed = paymentTerms.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const days = Number(trimmed);
  if (options?.max !== undefined && days > options.max) return undefined;
  return days;
}

/**
 * Carbon account.id → Rillet account code, from the account-mapping rows
 * (entityType "account"). Rillet journal/bill items address accounts by
 * CODE, so the mapping's stored externalCode is the resolution target —
 * the same contract as the Xero journal syncer's getAccountCodesById;
 * mappings without a stored code count as unmapped.
 */
export async function loadRilletAccountCodesById(
  database: Kysely<KyselyDatabase>,
  args: { companyId: string; integration: string }
): Promise<Map<string, string>> {
  const mappings = await getAccountMappings(database, {
    companyId: args.companyId,
    integration: args.integration
  });

  if (mappings.error) {
    throw new Error(`Failed to load account mappings: ${mappings.error}`);
  }

  const codesById = new Map<string, string>();
  for (const mapping of mappings.data ?? []) {
    if (mapping.externalCode) {
      codesById.set(mapping.accountId, mapping.externalCode);
    }
  }
  return codesById;
}

/**
 * company.baseCurrencyCode — Rillet payloads always carry an explicit
 * ISO-4217 currency, and Carbon journals/products have none of their own.
 */
export async function loadCompanyBaseCurrency(
  database: Kysely<KyselyDatabase>,
  companyId: string
): Promise<string> {
  const company = await database
    .selectFrom("company")
    .select("baseCurrencyCode")
    .where("id", "=", companyId)
    .executeTakeFirst();

  return company?.baseCurrencyCode ?? "USD";
}

/** Every Rillet read shape carries an optional updated_at timestamp. */
export type RilletTimestamped = { updated_at?: string };

/**
 * Base class for the push-only Rillet master-data syncers (customer,
 * vendor, item).
 *
 * Reimplements the push workflow with the SAME behavior as
 * BaseEntitySyncer.pushToAccounting (mapping check, shouldSync gate,
 * lastSyncedAt fast bailout, map → upsert → link) so that a thrown
 * JournalEntrySyncError reaches the caller as the structured failure
 * object on `SyncResult.error` — the base catch flattens every throw to a
 * string, which would lose errorCode/warning/metadata. Also centralizes
 * the push-only pull rejections (v1 forces push for these entities).
 */
export abstract class RilletEntitySyncer<
  TLocal,
  TRemote extends RilletTimestamped,
  TOmit extends string | symbol | number
> extends BaseEntitySyncer<TLocal, TRemote, TOmit> {
  protected get rilletProvider(): RilletProvider {
    return this.provider as RilletProvider;
  }

  /** Plural label used in push-only rejection messages, e.g. "Customers". */
  protected abstract get pushOnlyEntityLabel(): string;

  protected getRemoteUpdatedAt(remote: TRemote): Date | null {
    return parseRilletDate(remote.updated_at);
  }

  /**
   * Rillet has no bulk upsert endpoints — batch writes are sequential
   * single upserts (each with its own idempotency key).
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

  /**
   * Base push workflow, verbatim in behavior, plus: a thrown
   * JournalEntrySyncError returns its structured failure on
   * `SyncResult.error` instead of a flattened string.
   */
  async pushToAccounting(entityId: string): Promise<SyncResult> {
    if (!this.config.enabled) {
      return {
        status: "skipped",
        action: "none",
        error: "Sync disabled in config"
      };
    }

    try {
      // 1. Check if already linked
      const existingMapping = await this.mappingService.getByEntity(
        this.entityType,
        entityId,
        this.provider.id
      );

      // 2. Fetch local entity
      const localEntity = await this.fetchLocal(entityId);
      if (!localEntity) {
        return {
          status: "error",
          action: "none",
          localId: entityId,
          error: `Entity ${entityId} not found in Carbon`
        };
      }

      // 3. Optional business-logic gate
      if (this.shouldSync) {
        const shouldSyncResult = await this.shouldSync({
          direction: "push",
          localEntity,
          isFirstSync: !existingMapping,
          entityId
        });

        if (shouldSyncResult !== true) {
          return {
            status: "skipped",
            action: "none",
            localId: entityId,
            error:
              typeof shouldSyncResult === "string"
                ? shouldSyncResult
                : "Entity not eligible for sync"
          };
        }
      }

      const localUpdatedAt = new Date((localEntity as any).updatedAt);

      // 4. Fast bailout: already synced and local unchanged
      if (existingMapping?.lastSyncedAt) {
        if (localUpdatedAt <= new Date(existingMapping.lastSyncedAt)) {
          return {
            status: "skipped",
            action: "none",
            localId: entityId,
            remoteId: existingMapping.externalId,
            error: "Already synced - local unchanged"
          };
        }
      }

      // 5. Map and push
      const remotePayload = await this.mapToRemote(localEntity);
      const remoteId = await this.upsertRemote(remotePayload, entityId);

      // 6. Update mapping
      await withTriggersDisabled(this.database, async (tx) => {
        await this.linkEntities(tx, entityId, remoteId);
      });

      console.log("[SyncLog]", {
        direction: "PUSH",
        entity: this.entityType,
        localId: entityId,
        remoteId,
        status: "success"
      });

      return {
        status: "success",
        action: existingMapping ? "updated" : "created",
        localId: entityId,
        remoteId
      };
    } catch (err) {
      if (err instanceof JournalEntrySyncError) {
        console.error(`[${this.constructor.name}] structured push failure`, {
          entityId,
          ...err.failure
        });
        return {
          status: "error",
          action: "none",
          localId: entityId,
          error: err.failure
        };
      }

      console.error(`[${this.constructor.name}] push failed`, {
        entityId,
        err
      });
      return {
        status: "error",
        action: "none",
        localId: entityId,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /**
   * Batch push composes the overridden single push so the structured
   * failures survive the drain's batch path too (the base batch loop
   * flattens errors to strings). Operations arrive in claim-sized batches,
   * so a sequential loop costs nothing — and Rillet has no bulk endpoint
   * to lose.
   */
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

  // =================================================================
  // PULL WORKFLOW - Not supported (v1 forces push for these entities)
  // =================================================================

  protected async mapToLocal(_remote: TRemote): Promise<Partial<TLocal>> {
    throw new Error(
      `${this.pushOnlyEntityLabel} are push-only for Rillet. Cannot map from Rillet to Carbon.`
    );
  }

  protected async upsertLocal(
    _tx: KyselyTx,
    _data: Partial<TLocal>,
    _remoteId: string
  ): Promise<string> {
    throw new Error(
      `${this.pushOnlyEntityLabel} are push-only for Rillet. Cannot upsert locally from Rillet.`
    );
  }

  async pullFromAccounting(remoteId: string): Promise<SyncResult> {
    return {
      status: "error",
      action: "none",
      remoteId,
      error: `${this.pushOnlyEntityLabel} are push-only for Rillet: pulling from Rillet into Carbon is not supported`
    };
  }

  async pullBatchFromAccounting(remoteIds: string[]): Promise<BatchSyncResult> {
    const results: SyncResult[] = remoteIds.map((remoteId) => ({
      status: "error",
      action: "none",
      remoteId,
      error: `${this.pushOnlyEntityLabel} are push-only for Rillet: pulling from Rillet into Carbon is not supported`
    }));

    return {
      results,
      successCount: 0,
      errorCount: results.length,
      skippedCount: 0
    };
  }
}

/**
 * Base class for the create-only Rillet document syncers (invoice, bill,
 * journal entry): pushed documents are immutable in v1, so the
 * master-data lastSyncedAt fast bailout is replaced with a HARD
 * skip-when-mapped — an existing mapping means the push already happened
 * (the QBO journal-syncer contract). Everything else (structured
 * failures, sequential batches, push-only pulls) comes from
 * RilletEntitySyncer.
 */
export abstract class RilletTransactionSyncer<
  TLocal,
  TRemote extends RilletTimestamped,
  TOmit extends string | symbol | number
> extends RilletEntitySyncer<TLocal, TRemote, TOmit> {
  async pushToAccounting(entityId: string): Promise<SyncResult> {
    if (!this.config.enabled) {
      return {
        status: "skipped",
        action: "none",
        error: "Sync disabled in config"
      };
    }

    try {
      const existingMapping = await this.mappingService.getByEntity(
        this.entityType,
        entityId,
        this.provider.id
      );

      if (existingMapping?.externalId) {
        return {
          status: "skipped",
          action: "none",
          localId: entityId,
          remoteId: existingMapping.externalId,
          error: `${this.pushOnlyEntityLabel} already pushed to Rillet — skipping (idempotent)`
        };
      }

      const localEntity = await this.fetchLocal(entityId);
      if (!localEntity) {
        return {
          status: "error",
          action: "none",
          localId: entityId,
          error: `Entity ${entityId} not found in Carbon`
        };
      }

      if (this.shouldSync) {
        const shouldSyncResult = await this.shouldSync({
          direction: "push",
          localEntity,
          isFirstSync: true,
          entityId
        });

        if (shouldSyncResult !== true) {
          return {
            status: "skipped",
            action: "none",
            localId: entityId,
            error:
              typeof shouldSyncResult === "string"
                ? shouldSyncResult
                : "Entity not eligible for sync"
          };
        }
      }

      const remotePayload = await this.mapToRemote(localEntity);
      const remoteId = await this.upsertRemote(remotePayload, entityId);

      await withTriggersDisabled(this.database, async (tx) => {
        await this.linkEntities(tx, entityId, remoteId);
      });

      return {
        status: "success",
        action: "created",
        localId: entityId,
        remoteId
      };
    } catch (err) {
      if (err instanceof JournalEntrySyncError) {
        console.error(`[${this.constructor.name}] pre-flight failure`, {
          entityId,
          ...err.failure
        });
        return {
          status: "error",
          action: "none",
          localId: entityId,
          error: err.failure
        };
      }

      console.error(`[${this.constructor.name}] push failed`, {
        entityId,
        err
      });
      return {
        status: "error",
        action: "none",
        localId: entityId,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
}
