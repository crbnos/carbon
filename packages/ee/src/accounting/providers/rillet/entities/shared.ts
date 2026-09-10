import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  assertExchangeRate,
  moneyFormatOptions,
  toDocumentAmount
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { getAccountMappings } from "../../../core/account-mapping";
import {
  buildDimensionFieldLookup,
  buildDimensionValueMappingEntityId,
  buildDimensionValueMappingLookup,
  getDimensionMappings,
  getDimensionValueMappings,
  loadDimensionNames,
  resolveDimensionValueLabels,
  upsertDimensionMapping,
  upsertDimensionValueMapping
} from "../../../core/dimension-mapping";
import { createMappingService } from "../../../core/external-mapping";
import {
  JournalEntrySyncError,
  type JournalLineDimensionRef,
  type PostingSyncSettings,
  resolvePostingSyncSettings
} from "../../../core/posting";
import {
  type Accounting,
  BaseEntitySyncer,
  type BatchSyncResult,
  type SyncResult
} from "../../../core/types";
import { withTriggersDisabled } from "../../../core/utils";
import { parseRilletDate, type Rillet } from "../models";
import {
  buildRilletIdempotencyKey,
  isRilletUnknownExternalReferenceTypeError,
  type RilletProvider
} from "../provider";

/**
 * Shared plumbing for the Rillet entity syncers:
 *
 * - `RilletEntitySyncer` — a thin BaseEntitySyncer specialization for the
 *   push-only master-data syncers (customer, vendor, item): preserves
 *   structured JournalEntrySyncFailure envelopes on `SyncResult.error`
 *   (the same pushToAccounting-override pattern the Xero/QBO syncers
 *   established) and centralizes the push-only pull rejections.
 * - `RilletTransactionSyncer` — immutable posting amounts for documents.
 *   Existing mappings skip re-creation; mapped invoice/bill voids delete their
 *   native document and retain a durable voided mapping for safe retries.
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

/**
 * Rillet's built-in "custom source" external-reference type. When a Rillet org
 * has Revenue Recognition enabled, rev-rec validation rejects an AR invoice
 * unless the invoice + items carry a reference from a KNOWN integration —
 * billing/rev-rec partners (TABS, Maxio, …) or the generic CUSTOMER_HISTORICAL /
 * CUSTOMER_CUSTOM. Carbon's `"carbon"` type is not on that list. Carbon IS a
 * custom source, so it tags AR invoices with CUSTOMER_CUSTOM (alongside the
 * `"carbon"` audit refs) so they land whether or not the org runs rev-rec —
 * without depending on Rillet-side configuration.
 */
export const RILLET_CUSTOMER_CUSTOM_REFERENCE_TYPE = "CUSTOMER_CUSTOM";

export function customerCustomExternalReference(
  id: string,
  url: string
): Rillet.ExternalReference {
  // Rillet REQUIRES a url on CUSTOMER_CUSTOM references ("The URL is
  // required for external reference for Customer_Custom", verified on the
  // sandbox 2026-08-12) — it is the link back into the source system.
  return { type: RILLET_CUSTOMER_CUSTOM_REFERENCE_TYPE, id, url };
}

/**
 * Run a Rillet write, and when the org hasn't registered Carbon's
 * external-reference type slugs (dashboard-only setup: Rillet Settings →
 * External References), retry once WITHOUT the optional
 * external_references so the push still lands — the reference is audit
 * metadata, not required data. Only for payloads where references are
 * optional; AR_ONLY invoices (references required) surface a structured
 * Warning instead.
 */
export async function writeDroppingUnregisteredReferences<
  TPayload extends { external_references?: unknown },
  TResult
>(
  payload: TPayload,
  write: (payload: TPayload) => Promise<TResult>
): Promise<TResult> {
  try {
    return await write(payload);
  } catch (error) {
    if (
      !isRilletUnknownExternalReferenceTypeError(error) ||
      payload.external_references === undefined
    ) {
      throw error;
    }
    console.warn(
      `[Rillet] external-reference type slugs are not registered for this organization (Rillet Settings → External References: add "${RILLET_CARBON_REFERENCE_TYPE}" and "${RILLET_CARBON_COMPANY_REFERENCE_TYPE}"); retrying without references`
    );
    const { external_references: _dropped, ...stripped } = payload;
    return await write(stripped as TPayload);
  }
}

/**
 * Rillet requires an ungrouped decimal string at the document currency scale.
 *
 * `decimalPlaces` has NO default: the settlement scale is the currency's own
 * `currency.decimalPlaces` (data, never a literal — see
 * `.claude/rules/numeric-precision.md`). A `= 2` default silently serialised a
 * JPY payment as "1000.00" (JPY settles at 0) and truncated a BHD/KWD third
 * decimal, so every caller must supply the authoritative value.
 */
export function toRilletMoney(
  amount: number,
  currency: string,
  decimalPlaces: number
): Rillet.MonetaryAmount {
  if (decimalPlaces > 5) throw new Error("Unsupported document decimal scale");
  return {
    amount: new Intl.NumberFormat("en-US", {
      ...moneyFormatOptions(decimalPlaces),
      useGrouping: false
    }).format(toDocumentAmount(amount, 1, decimalPlaces)),
    currency
  };
}

/** Rillet converts document units into subsidiary units; Carbon stores the inverse. */
export function toRilletExchangeRate(args: {
  baseCurrencyCode: string;
  documentCurrencyCode: string;
  foreignPerBaseRate: number;
  date: string;
}): Rillet.ExchangeRate | undefined {
  const {
    baseCurrencyCode: base,
    documentCurrencyCode: target,
    foreignPerBaseRate: rate,
    date
  } = args;
  if (!base.trim() || !target.trim())
    throw new Error("Rillet exchange-rate currencies are required");
  // Validation only — the result is discarded. `toDocumentAmount` refuses a
  // non-finite/invalid rate, and the internal SCALE is the named constant the
  // precision standard exposes (a bare scale literal is a violation).
  assertExchangeRate(rate);
  parseDate(date);
  if (base === target) {
    if (rate !== 1)
      throw new Error("Identical currencies require identity exchange rate");
    return undefined;
  }
  const inverseRate = 1 / rate;
  assertExchangeRate(inverseRate);
  return { base: target, target: base, rate: String(inverseRate), date };
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

/**
 * `currency.decimalPlaces` for one currency code — the authoritative
 * settlement scale, group-scoped exactly like `loadBillCostingLines`'s read
 * (the source the bill syncer already threads into `toRilletMoney`). Throws
 * rather than defaulting: a guessed scale is how a JPY amount acquires cents.
 */
export async function loadCurrencyDecimalPlaces(
  database: Kysely<KyselyDatabase>,
  args: { companyId: string; currencyCode: string }
): Promise<number> {
  const company = await database
    .selectFrom("company")
    .select("companyGroupId")
    .where("id", "=", args.companyId)
    .executeTakeFirst();

  if (!company?.companyGroupId)
    throw new Error(
      "Company group is required to resolve currency decimal places"
    );

  const currency = await database
    .selectFrom("currency")
    .select("decimalPlaces")
    .where("code", "=", args.currencyCode)
    .where("companyGroupId", "=", company.companyGroupId)
    .executeTakeFirst();

  if (!currency || currency.decimalPlaces == null)
    throw new Error(
      `Currency precision for ${args.currencyCode} is required to serialize Rillet amounts`
    );

  return currency.decimalPlaces;
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
        localId: entityId,
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
 * Base class for immutable Rillet posting amounts (invoice, bill, journal).
 * Invoice/bill adapters opt into native deletion on local void. Journal
 * reversals retain their separate posting identity.
 */
export abstract class RilletTransactionSyncer<
  TLocal,
  TRemote extends RilletTimestamped,
  TOmit extends string | symbol | number
> extends RilletEntitySyncer<TLocal, TRemote, TOmit> {
  protected isVoided(_local: TLocal): boolean {
    return false;
  }

  /**
   * Delete the remote document on a local void. `metadata` is the push
   * mapping's metadata — a syncer that writes one Carbon entity to more than
   * one Rillet object kind (bills vs reimbursements) reads the kind from it.
   */
  protected async deleteRemote(
    _remoteId: string,
    _metadata?: Record<string, unknown>
  ): Promise<void> {
    throw new Error("This Rillet transaction does not support native voids");
  }

  // Per-instance caches — a drain reuses one syncer across its claimed
  // operations, so the posting-sync settings and the dimension-value
  // lookup are each fetched at most once per drain
  private postingSyncSettingsPromise?: Promise<PostingSyncSettings>;
  private dimensionValueMappingsPromise?: Promise<Map<string, string>>;
  private dimensionFieldMappingsPromise?: Promise<Map<string, string>>;

  /**
   * Per-company posting-sync settings from
   * `companyIntegration.metadata.settings.postingSync`. Public so the
   * drain can gate on `consolidation` ("daily" journals wait for the
   * consolidation cron instead of draining individually).
   */
  public getPostingSyncSettings(): Promise<PostingSyncSettings> {
    if (!this.postingSyncSettingsPromise) {
      this.postingSyncSettingsPromise = (async () => {
        const integration = await this.database
          .selectFrom("companyIntegration")
          .select("metadata")
          .where("id", "=", this.provider.id)
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();

        return resolvePostingSyncSettings(integration?.metadata);
      })();
    }
    return this.postingSyncSettingsPromise;
  }

  /**
   * `<dimensionId>:<valueId>` → Rillet field_value uuid from the
   * dimension-value mapping rows (entityType "dimensionValue"). Mutated
   * in place by the autoCreate flow so later pushes in the same drain
   * reuse the upserted values.
   */
  public getDimensionValueMappings(): Promise<Map<string, string>> {
    if (!this.dimensionValueMappingsPromise) {
      this.dimensionValueMappingsPromise = (async () => {
        const mappings = await getDimensionValueMappings(this.database, {
          companyId: this.companyId,
          integration: this.provider.id
        });
        if (mappings.error) {
          throw new Error(
            `Failed to load dimension value mappings: ${mappings.error}`
          );
        }
        return buildDimensionValueMappingLookup(mappings.data ?? []);
      })();
    }
    return this.dimensionValueMappingsPromise;
  }

  /**
   * `dimensionId` → Rillet Field id from the dimension mapping rows
   * (entityType "dimension"). Mutated in place by resolveLineDimensions so
   * later pushes in the same drain reuse an auto-provisioned Field.
   */
  public getDimensionFieldMappings(): Promise<Map<string, string>> {
    if (!this.dimensionFieldMappingsPromise) {
      this.dimensionFieldMappingsPromise = (async () => {
        const mappings = await getDimensionMappings(this.database, {
          companyId: this.companyId,
          integration: this.provider.id
        });
        if (mappings.error) {
          throw new Error(
            `Failed to load dimension field mappings: ${mappings.error}`
          );
        }
        return buildDimensionFieldLookup(mappings.data ?? []);
      })();
    }
    return this.dimensionFieldMappingsPromise;
  }

  /**
   * Resolve EVERY dimension on the given lines to a Rillet {field, value},
   * auto-provisioning the Rillet Field (createField) and Field value
   * (upsertFieldValue) as needed and persisting both mappings. Returns the
   * two lookups the mapper needs. This is the "send all dimensions" flow that
   * replaces the slot-gated setup for Rillet — Rillet has no field cap, so no
   * dimension is dropped for lack of a slot. Field auto-create is BY NAME
   * (reuse an existing Rillet Field with the same name before creating one);
   * value auto-create is BY the value's resolved READABLE label (part
   * readable id for items, name for everything else). A dimension whose name
   * can't be resolved, or a value whose label can't (source row deleted), is
   * left unmapped and the mapper drops just that ref.
   */
  protected async resolveLineDimensions(
    lines: ReadonlyArray<{ dimensions?: JournalLineDimensionRef[] }>
  ): Promise<{
    fieldIdByDimensionId: ReadonlyMap<string, string>;
    fieldValueIdsByValue: ReadonlyMap<string, string>;
  }> {
    const fieldIdByDimensionId = await this.getDimensionFieldMappings();
    const fieldValueIdsByValue = await this.getDimensionValueMappings();

    // 1. Auto-provision a Rillet Field per distinct dimension not yet mapped.
    const dimensionIds = [
      ...new Set(
        lines.flatMap((line) =>
          (line.dimensions ?? []).map((dimension) => dimension.dimensionId)
        )
      )
    ];
    const unmappedDimensionIds = dimensionIds.filter(
      (id) => !fieldIdByDimensionId.has(id)
    );

    if (unmappedDimensionIds.length > 0) {
      const names = await loadDimensionNames(this.database, {
        dimensionIds: unmappedDimensionIds
      });
      // Reuse an existing Rillet Field with the same name before creating a
      // new one — createField is not idempotent by name server-side.
      const existingFieldIdByName = new Map(
        (await this.rilletProvider.listFields()).map((field) => [
          field.name,
          field.id
        ])
      );

      for (const dimensionId of unmappedDimensionIds) {
        const name = names.get(dimensionId);
        if (!name) continue; // dimension deleted — its values won't attach

        let fieldId = existingFieldIdByName.get(name);
        if (!fieldId) {
          // Journal entries + bills are expense-side (EXPENSES applicability).
          const created = await this.rilletProvider.createField(
            name,
            "EXPENSES",
            buildRilletIdempotencyKey({
              companyId: this.companyId,
              operation: "create-field",
              localId: dimensionId
            })
          );
          fieldId = created.id;
          existingFieldIdByName.set(name, fieldId);
        }

        const persisted = await upsertDimensionMapping(this.database, {
          companyId: this.companyId,
          integration: this.provider.id,
          dimensionId,
          externalId: fieldId,
          externalName: name
        });
        if (persisted.error) {
          throw new Error(
            `Failed to store dimension field mapping: ${persisted.error}`
          );
        }
        fieldIdByDimensionId.set(dimensionId, fieldId);
      }
    }

    // 2. Auto-provision a Rillet Field value per distinct unmapped value whose
    //    Field is now known.
    const unmappedValues: JournalLineDimensionRef[] = [];
    const seenValueKeys = new Set<string>();
    for (const line of lines) {
      for (const dimension of line.dimensions ?? []) {
        if (!fieldIdByDimensionId.has(dimension.dimensionId)) continue;
        const key = buildDimensionValueMappingEntityId(
          dimension.dimensionId,
          dimension.valueId
        );
        if (fieldValueIdsByValue.has(key) || seenValueKeys.has(key)) continue;
        seenValueKeys.add(key);
        unmappedValues.push({
          dimensionId: dimension.dimensionId,
          valueId: dimension.valueId
        });
      }
    }

    if (unmappedValues.length > 0) {
      const labels = await resolveDimensionValueLabels(this.database, {
        values: unmappedValues
      });
      for (const value of unmappedValues) {
        const key = buildDimensionValueMappingEntityId(
          value.dimensionId,
          value.valueId
        );
        const label = labels.get(key);
        if (!label) continue; // unresolvable label (source row deleted) — drop
        const fieldId = fieldIdByDimensionId.get(value.dimensionId);
        if (!fieldId) continue;

        const created = await this.rilletProvider.upsertFieldValue(
          fieldId,
          label
        );
        const persisted = await upsertDimensionValueMapping(this.database, {
          companyId: this.companyId,
          integration: this.provider.id,
          dimensionId: value.dimensionId,
          valueId: value.valueId,
          externalId: created.id,
          externalName: label
        });
        if (persisted.error) {
          throw new Error(
            `Failed to store dimension value mapping: ${persisted.error}`
          );
        }
        fieldValueIdsByValue.set(key, created.id);
      }
    }

    return { fieldIdByDimensionId, fieldValueIdsByValue };
  }

  async pushToAccounting(entityId: string): Promise<SyncResult> {
    if (!this.config.enabled) {
      return {
        status: "skipped",
        action: "none",
        localId: entityId,
        error: "Sync disabled in config"
      };
    }

    try {
      const existingMapping = await this.mappingService.getByEntity(
        this.entityType,
        entityId,
        this.provider.id
      );

      const localEntity = await this.fetchLocal(entityId);
      if (!localEntity) {
        return {
          status: "error",
          action: "none",
          localId: entityId,
          error: `Entity ${entityId} not found in Carbon`
        };
      }

      if (existingMapping?.externalId && this.isVoided(localEntity)) {
        if (existingMapping.metadata?.voided !== true) {
          await this.deleteRemote(
            existingMapping.externalId,
            existingMapping.metadata ?? undefined
          );
          await withTriggersDisabled(this.database, async (tx) => {
            await createMappingService(tx, this.companyId).link(
              this.entityType,
              entityId,
              this.provider.id,
              existingMapping.externalId,
              { metadata: { ...existingMapping.metadata, voided: true } }
            );
          });
        }
        return {
          status: "success",
          action: "deleted",
          localId: entityId,
          remoteId: existingMapping.externalId
        };
      }

      if (existingMapping?.externalId) {
        return {
          status: "skipped",
          action: "none",
          localId: entityId,
          remoteId: existingMapping.externalId,
          error: `${this.pushOnlyEntityLabel} already pushed to Rillet — skipping (idempotent)`
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
