import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { round } from "@carbon/utils";
import { getAccountMappings } from "../../core/account-mapping";
import { resolveMemoJournalPartyFromDatabase } from "../../core/memo-party";
import {
  getPostingSyncSourceTypeSkipReason,
  JournalEntrySyncError,
  type PostingSyncSettings,
  parseJournalEntrySyncEntityId,
  resolvePostingSyncSettings,
  roundCurrency,
  runJournalEntryPreflight,
  toDebitSignedAmount,
  toPostingDateString
} from "../../core/posting";
import type { Accounting, ShouldSyncContext } from "../../core/types";
import { BaseEntitySyncer } from "../../core/types";
import type {
  NetSuiteJournalEntry,
  NetSuiteJournalWrite,
  NetSuiteProvider
} from "./provider";

export function netsuiteJournalExternalId(
  journal: Pick<Accounting.JournalEntry, "id" | "reversal">
): string {
  return journal.reversal ? `${journal.id}:reversal` : journal.id;
}

export function mapJournalEntryToNetSuiteJournalEntry(args: {
  journal: Accounting.JournalEntry;
  accountIdsById: ReadonlyMap<string, string>;
  currencyId: string;
  subsidiaryId: string | null;
  pushDate: string;
  redatedFromDate?: string;
}): NetSuiteJournalWrite {
  const { journal } = args;
  const sign = journal.reversal ? -1 : 1;
  const items: NetSuiteJournalWrite["line"]["items"] = [];

  for (const line of journal.lines) {
    const accountId = line.accountId
      ? args.accountIdsById.get(line.accountId)
      : undefined;
    if (!accountId) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `No NetSuite account mapped for account ${
          line.accountId ?? "(none)"
        } on journal ${journal.journalEntryId}`,
        warning: true,
        metadata: {
          unmappedAccountIds: line.accountId ? [line.accountId] : []
        }
      });
    }

    const signed = sign * line.amount;
    const amount = roundCurrency(Math.abs(signed));
    if (amount === 0) continue;

    const memo = line.description ?? journal.description ?? undefined;
    items.push({
      account: { id: accountId },
      ...(signed > 0 ? { debit: amount } : { credit: amount }),
      ...(memo ? { memo } : {})
    });
  }

  const baseName =
    journal.description?.trim() || `Carbon ${journal.journalEntryId}`;
  let memo = journal.reversal ? `Reversal of ${baseName}` : baseName;
  if (args.redatedFromDate) {
    memo += ` | original date ${args.redatedFromDate}`;
  }

  return {
    externalId: netsuiteJournalExternalId(journal),
    tranDate: args.pushDate,
    memo,
    currency: { id: args.currencyId },
    ...(args.subsidiaryId ? { subsidiary: { id: args.subsidiaryId } } : {}),
    line: { items }
  };
}

export function sumNetSuiteJournalDebitTotals(
  entry: Pick<NetSuiteJournalEntry, "line">
): Map<string, number> {
  const cents = new Map<string, number>();
  for (const line of entry.line?.items ?? []) {
    const accountId = line.account?.id;
    if (!accountId) continue;
    const debit = round((Number(line.debit) || 0) * 100, 0);
    const credit = round((Number(line.credit) || 0) * 100, 0);
    cents.set(accountId, (cents.get(accountId) ?? 0) + debit - credit);
  }
  const totals = new Map<string, number>();
  for (const [accountId, amount] of cents) {
    totals.set(accountId, amount / 100);
  }
  return totals;
}

async function loadNetSuiteAccountIdsById(
  db: Kysely<KyselyDatabase>,
  args: { companyId: string; integration: string }
): Promise<Map<string, string>> {
  const mappings = await getAccountMappings(db, args);
  if (mappings.error) {
    throw new Error(`Failed to load account mappings: ${mappings.error}`);
  }
  const ids = new Map<string, string>();
  for (const mapping of mappings.data ?? []) {
    if (mapping.externalId) ids.set(mapping.accountId, mapping.externalId);
  }
  return ids;
}

type NetSuiteJournalRecord = NetSuiteJournalWrite & { id: string };

export class NetSuiteJournalEntrySyncer extends BaseEntitySyncer<
  Accounting.JournalEntry,
  NetSuiteJournalRecord,
  "id"
> {
  private accountIdsByIdPromise?: Promise<Map<string, string>>;
  private controlAccountIdsPromise?: Promise<Set<string>>;
  private baseCurrencyPromise?: Promise<string>;
  private postingSyncSettingsPromise?: Promise<PostingSyncSettings>;

  private get netsuite(): NetSuiteProvider {
    return this.provider as NetSuiteProvider;
  }

  private getAccountIdsById(): Promise<Map<string, string>> {
    if (!this.accountIdsByIdPromise) {
      this.accountIdsByIdPromise = loadNetSuiteAccountIdsById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountIdsByIdPromise;
  }

  private getControlAccountIds(): Promise<Set<string>> {
    if (!this.controlAccountIdsPromise) {
      this.controlAccountIdsPromise = (async () => {
        const defaults = await this.database
          .selectFrom("accountDefault")
          .select(["receivablesAccount", "payablesAccount"])
          .where("companyId", "=", this.companyId)
          .executeTakeFirst();
        return new Set(
          [defaults?.receivablesAccount, defaults?.payablesAccount].filter(
            (id): id is string => typeof id === "string" && id.length > 0
          )
        );
      })();
    }
    return this.controlAccountIdsPromise;
  }

  private getBaseCurrency(): Promise<string> {
    if (!this.baseCurrencyPromise) {
      this.baseCurrencyPromise = (async () => {
        const company = await this.database
          .selectFrom("company")
          .select("baseCurrencyCode")
          .where("id", "=", this.companyId)
          .executeTakeFirst();
        return company?.baseCurrencyCode ?? "USD";
      })();
    }
    return this.baseCurrencyPromise;
  }

  private getPostingSyncSettings(): Promise<PostingSyncSettings> {
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

  protected async fetchLocal(
    entityId: string
  ): Promise<Accounting.JournalEntry | null> {
    const { journalId, reversal } = parseJournalEntrySyncEntityId(entityId);
    const journal = await this.database
      .selectFrom("journal")
      .select([
        "id",
        "companyId",
        "journalEntryId",
        "description",
        "postingDate",
        "status",
        "sourceType",
        "reversalOfId",
        "reversedById",
        "postedAt",
        "createdAt",
        "updatedAt"
      ])
      .where("id", "=", journalId)
      .where("companyId", "=", this.companyId)
      .executeTakeFirst();

    if (!journal) return null;

    const lines = await this.database
      .selectFrom("journalLine")
      .leftJoin("account", "account.id", "journalLine.accountId")
      .select([
        "journalLine.id",
        "journalLine.accountId",
        "journalLine.amount",
        "journalLine.description",
        "account.class as accountClass"
      ])
      .where("journalId", "=", journalId)
      .where("companyId", "=", this.companyId)
      .orderBy("journalLineReference", "asc")
      .execute();

    return {
      id: journal.id,
      companyId: journal.companyId,
      journalEntryId: journal.journalEntryId,
      description: journal.description ?? null,
      postingDate: toPostingDateString(journal.postingDate),
      status: journal.status,
      sourceType: journal.sourceType ?? null,
      reversalOfId: journal.reversalOfId ?? null,
      reversedById: journal.reversedById ?? null,
      reversal,
      lines: lines.map((line) => ({
        id: line.id,
        accountId: line.accountId ?? null,
        amount: toDebitSignedAmount(
          line.accountClass,
          Number(line.amount) || 0
        ),
        description: line.description ?? null
      })),
      updatedAt: journal.updatedAt ?? journal.postedAt ?? journal.createdAt
    };
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, Accounting.JournalEntry>> {
    const result = new Map<string, Accounting.JournalEntry>();
    for (const id of ids) {
      const journal = await this.fetchLocal(id);
      if (journal) result.set(id, journal);
    }
    return result;
  }

  protected async fetchRemote(
    id: string
  ): Promise<NetSuiteJournalRecord | null> {
    const entry = await this.netsuite.getJournalEntry(id);
    if (!entry?.id) return null;
    return entry as NetSuiteJournalRecord;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, NetSuiteJournalRecord>> {
    const result = new Map<string, NetSuiteJournalRecord>();
    for (const id of ids) {
      const entry = await this.fetchRemote(id);
      if (entry) result.set(entry.id, entry);
    }
    return result;
  }

  protected getRemoteUpdatedAt(): Date | null {
    return null;
  }

  protected async shouldSync(
    context: ShouldSyncContext<Accounting.JournalEntry, NetSuiteJournalRecord>
  ): Promise<boolean | string> {
    if (context.direction === "pull") {
      return "Journal entries are push-only";
    }

    const local = context.localEntity;
    if (!local) return "Journal could not be loaded";
    if (!context.isFirstSync) {
      return "Journal already pushed to NetSuite";
    }

    if (local.reversal) {
      if (local.status !== "Reversed") {
        return `Reversal push requires a Reversed journal (current status: ${local.status})`;
      }
      const originalRemoteId = await this.getRemoteId(local.id);
      if (!originalRemoteId) {
        return `Original journal ${local.journalEntryId} was never pushed to NetSuite`;
      }
    } else if (local.status !== "Posted") {
      return `Journal must be Posted before syncing (current status: ${local.status})`;
    }

    const settings = await this.getPostingSyncSettings();
    const sourceTypeSkipReason = getPostingSyncSourceTypeSkipReason(
      local.sourceType,
      settings,
      {
        inventoryAdjustmentEntitySyncEnabled:
          this.provider.getSyncConfig("inventoryAdjustment")?.enabled ?? false,
        memoParty: await this.resolveMemoJournalParty(local)
      }
    );
    if (sourceTypeSkipReason) return sourceTypeSkipReason;
    return true;
  }

  private async resolveMemoJournalParty(
    journal: Accounting.JournalEntry
  ): Promise<"customer" | "supplier" | null> {
    if (
      journal.sourceType !== "Credit Memo" &&
      journal.sourceType !== "Debit Memo"
    ) {
      return null;
    }
    return resolveMemoJournalPartyFromDatabase(this.database, {
      companyId: this.companyId,
      journalId: journal.id
    });
  }

  protected async mapToRemote(
    local: Accounting.JournalEntry
  ): Promise<NetSuiteJournalWrite> {
    const settings = await this.getPostingSyncSettings();
    const accountIdsById = await this.getAccountIdsById();
    const controlAccountIds = await this.getControlAccountIds();
    const preflight = runJournalEntryPreflight({
      journal: local,
      accountCodesById: accountIdsById,
      controlAccountIds,
      lockDate: settings.lockDate ? settings.lockDate.slice(0, 10) : null,
      settings
    });
    if (preflight.failure) {
      throw new JournalEntrySyncError(preflight.failure);
    }

    const currencyId = await this.netsuite.getCurrencyId(
      await this.getBaseCurrency()
    );
    return mapJournalEntryToNetSuiteJournalEntry({
      journal: local,
      accountIdsById,
      currencyId,
      subsidiaryId: this.netsuite.subsidiaryId,
      pushDate: preflight.pushDate,
      redatedFromDate: preflight.redatedFromDate
    });
  }

  protected async mapToLocal(): Promise<Partial<Accounting.JournalEntry>> {
    throw new Error("Journal entries are push-only");
  }

  protected async upsertLocal(): Promise<string> {
    throw new Error("Journal entries are push-only");
  }

  protected async upsertRemote(data: NetSuiteJournalWrite): Promise<string> {
    return this.netsuite.upsertJournalEntry(data);
  }

  protected async upsertRemoteBatch(
    data: Array<{ localId: string; payload: NetSuiteJournalWrite }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload));
    }
    return result;
  }
}
