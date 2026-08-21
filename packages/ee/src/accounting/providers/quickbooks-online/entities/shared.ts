import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { getAccountMappings } from "../../../core/account-mapping";
import { createMappingService } from "../../../core/external-mapping";
import { JournalEntrySyncError, roundCurrency } from "../../../core/posting";
import {
  type Accounting,
  BaseEntitySyncer,
  type BatchSyncResult,
  type SyncResult
} from "../../../core/types";
import { withTriggersDisabled } from "../../../core/utils";
import {
  parseQboDate,
  type Qbo,
  type QboCreatePayload,
  type QboEntityFields
} from "../models";
import {
  isQboDuplicateNameError,
  isQboStaleObjectError,
  QBO_FAULT_CODES,
  type QboProvider
} from "../provider";

/**
 * Shared plumbing for the QuickBooks Online entity syncers:
 *
 * - `QboEntitySyncer` — a thin BaseEntitySyncer specialization that (a)
 *   preserves structured JournalEntrySyncFailure envelopes on
 *   `SyncResult.error` for the master-data name failures (NAME_EXISTS,
 *   NAME_TOO_LONG) via the same pushToAccounting-override pattern the Xero
 *   JournalEntrySyncer established, and (b) records QBO's SyncToken +
 *   MetaData.LastUpdatedTime on the mapping row (metadata / remoteUpdatedAt,
 *   the Xero pattern).
 * - Pure mapping helpers (contact payloads, DocNumber 21-char rule, name
 *   guards, the stale-SyncToken retry) exported for tests — client mocking
 *   is impractical here, so behavior lives in pure functions per the
 *   established pattern.
 */

/** Server-owned fields every QBO write payload omits (create) or echoes (update). */
export type QboWriteOmit = "Id" | "SyncToken" | "MetaData";

/** QBO caps entity names (Customer/Vendor DisplayName, Item Name) at 100 chars. */
export const QBO_NAME_MAX_LENGTH = 100;

/** QBO caps transaction DocNumber at 21 characters. */
export const QBO_DOC_NUMBER_MAX_LENGTH = 21;

/** Which field carries the Carbon readable id on a pushed QBO transaction. */
export type QboDocNumberSource = "docNumber" | "privateNote";

/** Escape a string literal for a QBO query WHERE clause (single quotes). */
export function escapeQboQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

/**
 * Apply QBO's 21-char DocNumber cap: a readable id that fits becomes the
 * DocNumber; a longer one moves to PrivateNote ("Carbon <id>") and QBO
 * auto-numbers the transaction. The `source` is recorded in the mapping
 * metadata so reconciliation knows where to find the Carbon id.
 */
export function buildQboDocNumberFields(
  readableId: string,
  extraNote?: string | null
): { DocNumber?: string; PrivateNote?: string; source: QboDocNumberSource } {
  if (readableId.length <= QBO_DOC_NUMBER_MAX_LENGTH) {
    return {
      DocNumber: readableId,
      PrivateNote: extraNote ?? undefined,
      source: "docNumber"
    };
  }

  const carrier = `Carbon ${readableId}`;
  return {
    PrivateNote: extraNote ? `${carrier} | ${extraNote}` : carrier,
    source: "privateNote"
  };
}

/**
 * Structured NAME_TOO_LONG failure (Warning — user-fixable by shortening
 * the name in Carbon; no silent truncation).
 */
export function qboNameTooLongError(args: {
  entityLabel: string;
  name: string;
}): JournalEntrySyncError {
  return new JournalEntrySyncError({
    errorCode: "NAME_TOO_LONG",
    message: `The ${args.entityLabel} name is ${args.name.length} characters; QuickBooks Online caps names at ${QBO_NAME_MAX_LENGTH}. Shorten the name in Carbon, then retry.`,
    warning: true,
    metadata: {
      entityLabel: args.entityLabel,
      name: args.name,
      maxLength: QBO_NAME_MAX_LENGTH
    }
  });
}

/**
 * Convert QBO's Duplicate Name Exists fault (Intuit code 6240 — QBO
 * customers, vendors and employees share one name namespace) into the
 * structured NAME_EXISTS Warning. Returns null for any other error.
 */
export function toQboNameExistsError(
  error: unknown,
  args: { entityLabel: string; name: string }
): JournalEntrySyncError | null {
  if (!isQboDuplicateNameError(error)) return null;

  return new JournalEntrySyncError({
    errorCode: "NAME_EXISTS",
    message: `QuickBooks Online already has an entity named "${args.name}" — QBO customers, vendors and employees share one name namespace. Rename the ${args.entityLabel} in Carbon or the conflicting entity in QuickBooks Online, then retry.`,
    warning: true,
    metadata: {
      entityLabel: args.entityLabel,
      name: args.name,
      qboFaultCode: QBO_FAULT_CODES.DUPLICATE_NAME_EXISTS
    }
  });
}

/**
 * Read-modify-write with QBO's optimistic concurrency: fetch the current
 * SyncToken, send the update, and on a Stale Object fault (5010) refetch
 * the token and retry EXACTLY once — a second stale fault propagates (the
 * operation lands Failed).
 */
export async function updateWithSyncTokenRetry<T>(args: {
  entityLabel: string;
  remoteId: string;
  fetchCurrent: () => Promise<{ SyncToken: string } | null>;
  update: (syncToken: string) => Promise<T>;
  isStaleTokenError?: (error: unknown) => boolean;
}): Promise<T> {
  const isStale = args.isStaleTokenError ?? isQboStaleObjectError;

  const current = await args.fetchCurrent();
  if (!current) {
    throw new Error(
      `Cannot update ${args.entityLabel} ${args.remoteId}: entity not found in QuickBooks Online`
    );
  }

  try {
    return await args.update(current.SyncToken);
  } catch (error) {
    if (!isStale(error)) throw error;

    const refetched = await args.fetchCurrent();
    if (!refetched) throw error;

    return args.update(refetched.SyncToken);
  }
}

/**
 * Carbon account.id → QBO AccountRef from the account-mapping rows
 * (entityType "account", integration "quickbooks"). QBO refs point at the
 * account Id, so the mapping's externalId is the ref value; the stored
 * externalName is display-only. Same resolution path the journal syncer
 * uses — QBO just needs the id where Xero needs the code.
 */
export async function loadQboAccountRefsById(
  database: Kysely<KyselyDatabase>,
  args: { companyId: string; integration: string }
): Promise<Map<string, Qbo.Ref>> {
  const mappings = await getAccountMappings(database, {
    companyId: args.companyId,
    integration: args.integration
  });

  if (mappings.error) {
    throw new Error(`Failed to load account mappings: ${mappings.error}`);
  }

  const refsById = new Map<string, Qbo.Ref>();
  for (const mapping of mappings.data ?? []) {
    if (mapping.externalId) {
      refsById.set(mapping.accountId, {
        value: mapping.externalId,
        name: mapping.externalName ?? undefined
      });
    }
  }
  return refsById;
}

/** Line input shared by Bill and PurchaseOrder expense-line building. */
export type QboExpenseLineInput = {
  itemId?: string | null;
  accountId?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
};

/**
 * Build QBO expense-style lines (Bill / PurchaseOrder): item lines carry
 * ItemBasedExpenseLineDetail (ItemRef = the item's QBO id, resolved via
 * ensureDependencySynced before mapping), non-item lines carry
 * AccountBasedExpenseLineDetail with the mapped account. Pure — exported
 * for tests. Throws a plain Error (Failed, not Warning) when a non-item
 * line has no account or the account has no QBO mapping.
 */
export function buildQboExpenseLines(args: {
  lines: readonly QboExpenseLineInput[];
  itemRemoteIds: ReadonlyMap<string, string>;
  accountRefsById: ReadonlyMap<string, Qbo.Ref>;
  documentLabel: string;
}): Array<Omit<Qbo.ExpenseLine, "Id">> {
  return args.lines.map((line) => {
    const base = {
      Description: line.description ?? undefined,
      Amount: roundCurrency(line.totalAmount)
    };

    if (line.itemId) {
      const remoteItemId = args.itemRemoteIds.get(line.itemId);
      if (!remoteItemId) {
        throw new Error(
          `Cannot sync ${args.documentLabel}: item ${line.itemId} has not been synced to QuickBooks Online`
        );
      }
      return {
        ...base,
        DetailType: "ItemBasedExpenseLineDetail",
        ItemBasedExpenseLineDetail: {
          ItemRef: { value: remoteItemId },
          Qty: line.quantity,
          UnitPrice: line.unitPrice
        }
      };
    }

    if (!line.accountId) {
      throw new Error(
        `Cannot sync ${args.documentLabel}: a line has neither an item nor a G/L account`
      );
    }

    const accountRef = args.accountRefsById.get(line.accountId);
    if (!accountRef) {
      throw new Error(
        `Cannot sync ${args.documentLabel}: account ${line.accountId} has no QuickBooks Online account mapping. Map it on the integration settings page, then retry.`
      );
    }

    return {
      ...base,
      DetailType: "AccountBasedExpenseLineDetail",
      AccountBasedExpenseLineDetail: { AccountRef: accountRef }
    };
  });
}

/**
 * Map a Carbon customer/supplier to the QBO Customer/Vendor write payload
 * (identical shapes — QBO keeps them as separate objects, unlike Xero's
 * dual-flag Contact). Throws the structured NAME_TOO_LONG Warning when the
 * name exceeds QBO's 100-char DisplayName cap.
 */
export function mapContactToQboContact(
  local: Accounting.Contact,
  entityLabel: "customer" | "vendor"
): QboCreatePayload<Qbo.Customer> {
  if (local.name.length > QBO_NAME_MAX_LENGTH) {
    throw qboNameTooLongError({ entityLabel, name: local.name });
  }

  const phone = local.workPhone ?? local.mobilePhone ?? local.homePhone;
  const address = local.addresses[0];

  return {
    DisplayName: local.name,
    PrimaryEmailAddr: local.email ? { Address: local.email } : undefined,
    PrimaryPhone: phone ? { FreeFormNumber: phone } : undefined,
    BillAddr: address
      ? {
          Line1: address.line1 ?? undefined,
          Line2: address.line2 ?? undefined,
          City: address.city ?? undefined,
          CountrySubDivisionCode: address.region ?? undefined,
          Country: address.country ?? undefined,
          PostalCode: address.postalCode ?? undefined
        }
      : undefined,
    Active: true
  };
}

/**
 * Map a QBO Customer/Vendor back onto the Carbon contact shape (two-way
 * pull, owner accounting): name, email, phone and billing address per the
 * models. The caller sets the isCustomer/isVendor flags for its entity.
 */
export function mapQboContactToLocal(
  remote: Qbo.Customer | Qbo.Vendor,
  flags: { isCustomer: boolean; isVendor: boolean }
): Partial<Accounting.Contact> {
  const addresses: Accounting.Contact["addresses"] = remote.BillAddr
    ? [
        {
          label: null,
          type: "BILLING",
          line1: remote.BillAddr.Line1 ?? null,
          line2: remote.BillAddr.Line2 ?? null,
          city: remote.BillAddr.City ?? null,
          region: remote.BillAddr.CountrySubDivisionCode ?? null,
          country: remote.BillAddr.Country ?? null,
          postalCode: remote.BillAddr.PostalCode ?? null
        }
      ]
    : [];

  return {
    name: remote.DisplayName,
    email: remote.PrimaryEmailAddr?.Address ?? undefined,
    workPhone: remote.PrimaryPhone?.FreeFormNumber ?? null,
    isCustomer: flags.isCustomer,
    isVendor: flags.isVendor,
    addresses
  };
}

/**
 * Base class for the QBO master-data syncers (customer, vendor, item).
 *
 * Reimplements the push workflow with the SAME behavior as
 * BaseEntitySyncer.pushToAccounting (mapping check, shouldSync gate,
 * lastSyncedAt fast bailout, map → upsert → link) so that a thrown
 * JournalEntrySyncError reaches the caller as the structured failure object
 * on `SyncResult.error` — the base catch flattens every throw to a string,
 * which would lose errorCode/warning/metadata. The jobs drain detects the
 * envelope generically (isJournalEntrySyncFailure) and records Warning
 * operations for NAME_EXISTS / NAME_TOO_LONG. Everything that is not a
 * structured failure behaves exactly like the base workflow.
 *
 * Also centralizes the Xero-pattern mapping bookkeeping: `Id` is the
 * externalId, `SyncToken` goes into mapping metadata, and
 * `MetaData.LastUpdatedTime` fills `remoteUpdatedAt`.
 */
export abstract class QboEntitySyncer<
  TLocal,
  TRemote extends QboEntityFields
> extends BaseEntitySyncer<TLocal, TRemote, QboWriteOmit> {
  /**
   * SyncToken/LastUpdatedTime observed per remote id (from reads and write
   * responses), flushed into the mapping row by linkEntities. Bounded by
   * the drain's claim size — a syncer instance is short-lived.
   */
  private seenRemoteMeta = new Map<
    string,
    { syncToken?: string; lastUpdatedTime?: string }
  >();

  protected get qboProvider(): QboProvider {
    return this.provider as QboProvider;
  }

  /** Record a remote entity's concurrency metadata for the next linkEntities. */
  protected rememberRemoteEntity(
    remote: QboEntityFields | null | undefined
  ): void {
    if (!remote?.Id) return;
    this.seenRemoteMeta.set(remote.Id, {
      syncToken: remote.SyncToken,
      lastUpdatedTime: remote.MetaData?.LastUpdatedTime
    });
  }

  protected getRemoteUpdatedAt(remote: TRemote): Date | null {
    return parseQboDate(remote.MetaData?.LastUpdatedTime);
  }

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    const seen = this.seenRemoteMeta.get(remoteId);
    const effectiveUpdatedAt =
      remoteUpdatedAt ?? parseQboDate(seen?.lastUpdatedTime) ?? undefined;

    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link(
      this.entityType,
      localId,
      this.provider.id,
      remoteId,
      {
        remoteUpdatedAt: effectiveUpdatedAt,
        ...(seen?.syncToken !== undefined
          ? { metadata: { syncToken: seen.syncToken } }
          : {})
      }
    );
  }

  /**
   * QBO has no bulk upsert endpoint for these entities — batch writes are
   * sequential single upserts (same per-entity SyncToken handling).
   */
  protected async upsertRemoteBatch(
    data: Array<{ localId: string; payload: Omit<TRemote, QboWriteOmit> }>
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
   * flattens errors to strings). Master-data operations arrive in
   * claim-sized batches, so a sequential loop costs nothing — and QBO has
   * no bulk endpoint to lose.
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
}
