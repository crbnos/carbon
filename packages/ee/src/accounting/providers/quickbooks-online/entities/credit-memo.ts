import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import {
  CREDIT_REASON_ITEM_ENTITY_TYPE,
  resolveCreditReasonItem
} from "../../../core/credit-reason-item";
import {
  createMappingService,
  type ExternalIntegrationMapping,
  type ExternalIntegrationMappingService
} from "../../../core/external-mapping";
import { MEMO_INCREASER_SKIP_REASON } from "../../../core/models";
import { JournalEntrySyncError } from "../../../core/posting";
import { BaseEntitySyncer, type ShouldSyncContext } from "../../../core/types";
import { parseQboDate, type Qbo, type QboCreatePayload } from "../models";
import {
  buildQboRequestId,
  type QboCreditMemoApplicationPayload,
  type QboProvider,
  toQboExchangeRate
} from "../provider";
import {
  buildQboDocNumberFields,
  loadQboAccountRefsById,
  QBO_NAME_MAX_LENGTH,
  type QboWriteOmit
} from "./shared";

/**
 * QboCreditMemoSyncer — a posted Carbon CUSTOMER `memo` → a QuickBooks Online
 * `CreditMemo` (push-only; entityType "creditMemo"), plus one zero-cash
 * `Payment` per `invoiceSettlement` that applies it.
 *
 * Why a document and not a journal: a journal to the AR control account is
 * accepted by QBO but the credit is then not an open item anyone can apply,
 * and Carbon owns the application. A CreditMemo is what the customer's
 * accountant already recognises.
 *
 * **The ItemRef trap.** A QBO `CreditMemo` accepts only `SalesItemLine` /
 * `GroupLine`, and a `SalesItemLineDetail` line WITHOUT an `ItemRef` has its
 * `Amount` SILENTLY IGNORED — no fault, just a zero-total credit memo that
 * looks synced. `ItemAccountRef` is invoice-only, so the GL account cannot be
 * put on the line at all: it comes from the item. Hence the shared
 * credit-reason-item resolver (`core/credit-reason-item.ts`), which binds one
 * provider-side `Service` Item to each reason account. That Item is a
 * PROVIDER-SIDE ARTIFACT — there is no Carbon `item` row, no `itemType`, and
 * nothing in Carbon's UI. (The vendor-credit side needs none of this: a
 * `VendorCredit` takes an account-coded line.)
 *
 * **v1 covers the REDUCER only** (customer + Credit). A customer + Debit memo
 * INCREASES the receivable and has no safe QBO representation — `TotalAmt` is
 * read-only/system-calculated — so it is skipped WITH a reason and the
 * operation closes `Skipped` (truthful ledger), never a silent drop and never
 * a malformed push.
 */

/** A settlement that applies this memo to an open document. */
export type QboMemoSettlementRow = {
  id: string;
  appliedAmount: number;
  appliedDate: string;
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
  targetMemoId: string | null;
  discountAmount: number;
  writeOffAmount: number;
  sourceExchangeRate: number;
  targetExchangeRate: number;
};

/**
 * The Carbon `memo` header as both memo syncers read it. Shared shape, owned
 * here because `vendor-credit.ts` is the only other reader — the QBO barrel
 * `export *`s both files, so the type must be declared exactly once.
 */
export type QboMemoSource = {
  id: string;
  memoId: string;
  direction: Database["public"]["Enums"]["memoDirection"];
  status: Database["public"]["Enums"]["memoStatus"];
  customerId: string | null;
  supplierId: string | null;
  memoDate: string;
  postingDate: string | null;
  currencyCode: string;
  exchangeRate: number;
  amount: number;
  reasonAccount: string | null;
  reference: string | null;
  notes: string | null;
  updatedAt: string;
  settlements: QboMemoSettlementRow[];
};

/**
 * The one reason string every provider's memo syncer uses for the deferred
 * combos, so an operator sees the same sentence on Xero, QBO and Rillet.
 */
export const QBO_MEMO_INCREASER_SKIP_REASON = MEMO_INCREASER_SKIP_REASON;

/** Posted is the only status with a settled GL to represent. */
export function qboMemoStatusSkipReason(memo: QboMemoSource): string | null {
  return memo.status === "Posted"
    ? null
    : `Memo ${memo.memoId} is ${memo.status} — only Posted memos push`;
}

/**
 * Why this memo is NOT pushable as a QBO CreditMemo, or null when it is. Pure
 * — this is what `shouldSync` returns, and what the increaser test asserts.
 */
export function qboCreditMemoSkipReason(memo: QboMemoSource): string | null {
  if (!memo.customerId) {
    return `Memo ${memo.memoId} is not a customer memo — a supplier memo pushes as a vendor credit`;
  }
  const statusReason = qboMemoStatusSkipReason(memo);
  if (statusReason) return statusReason;
  if (memo.direction !== "Credit") {
    return `${QBO_MEMO_INCREASER_SKIP_REASON}: memo ${memo.memoId} is a customer + Debit memo, which INCREASES the receivable and has no safe QuickBooks Online representation (TotalAmt is read-only)`;
  }
  return null;
}

/**
 * QBO caps an Item name at 100 characters and its name namespace is shared and
 * unique. The "(Carbon)" suffix marks the item as Carbon-managed in the
 * customer's Products & Services list; the account NUMBER keeps two
 * similarly-named reason accounts distinct.
 */
export function buildQboCreditReasonItemName(args: {
  accountNumber: string | null;
  accountName: string | null;
  accountId: string;
}): string {
  const label =
    [args.accountNumber, args.accountName].filter(Boolean).join(" ") ||
    args.accountId;
  const suffix = " (Carbon)";
  return `${label.slice(0, QBO_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
}

/**
 * Resolve — mapping first, creating at most once — the provider-side `Service`
 * Item bound to a reason account. Exported so the item-reuse contract can be
 * tested without a QBO connection.
 */
export async function resolveQboCreditReasonItemRef(args: {
  mapping: ExternalIntegrationMappingService;
  integration: string;
  accountId: string;
  accountNumber: string | null;
  accountName: string | null;
  incomeAccountRef: Qbo.Ref;
  createServiceItem: (input: {
    name: string;
    incomeAccountRef: Qbo.Ref;
    description?: string;
  }) => Promise<{ Id: string }>;
}): Promise<Qbo.Ref> {
  const externalId = await resolveCreditReasonItem({
    mapping: args.mapping,
    integration: args.integration,
    accountId: args.accountId,
    createItem: async (accountId) => {
      const created = await args.createServiceItem({
        name: buildQboCreditReasonItemName({
          accountNumber: args.accountNumber,
          accountName: args.accountName,
          accountId
        }),
        incomeAccountRef: args.incomeAccountRef,
        description: "Credit reason account — managed by Carbon"
      });
      if (!created?.Id) {
        throw new Error(
          "QuickBooks Online returned no Item Id for the credit reason item"
        );
      }
      return created.Id;
    }
  });

  return { value: externalId };
}

/**
 * Build the QBO CreditMemo create payload. Pure — exported for tests.
 *
 * ONE line, carrying the memo's whole amount against the credit-reason item.
 * `Qty: 1` + `UnitPrice: amount` keeps QBO's own `Amount = Qty × UnitPrice`
 * arithmetic exact, and `Amount` is set explicitly because `TotalAmt` is
 * system-calculated from the lines.
 */
export function buildQboCreditMemoPayload(args: {
  memo: QboMemoSource;
  customerRef: Qbo.Ref;
  reasonItemRef: Qbo.Ref;
  baseCurrencyCode: string;
}): QboCreatePayload<Qbo.CreditMemo> {
  const { memo } = args;
  const docNumber = buildQboDocNumberFields(
    memo.memoId,
    memo.reference ? `Ref ${memo.reference}` : undefined
  );
  const description = memo.notes ?? memo.reference ?? undefined;

  return {
    DocNumber: docNumber.DocNumber,
    PrivateNote: docNumber.PrivateNote,
    TxnDate: memo.postingDate ?? memo.memoDate,
    CustomerRef: args.customerRef,
    // QBO quotes company base per document currency, reciprocal to Carbon.
    ...(memo.currencyCode !== args.baseCurrencyCode
      ? {
          CurrencyRef: { value: memo.currencyCode },
          ExchangeRate: toQboExchangeRate(memo.exchangeRate)
        }
      : {}),
    Line: [
      {
        Amount: memo.amount,
        ...(description ? { Description: description } : {}),
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          // Without this ItemRef, QBO silently ignores `Amount`.
          ItemRef: args.reasonItemRef,
          Qty: 1,
          UnitPrice: memo.amount
        }
      }
    ]
  };
}

/**
 * Load Carbon memo headers + their settlements for one party side. Shared by
 * both memo syncers (`party` selects the non-null party column).
 */
export async function loadQboMemoSources(
  database: Kysely<KyselyDatabase>,
  args: { companyId: string; ids: string[]; party: "customer" | "supplier" }
): Promise<Map<string, QboMemoSource>> {
  if (args.ids.length === 0) return new Map();

  const rows = await database
    .selectFrom("memo")
    .select([
      "id",
      "memoId",
      "direction",
      "status",
      "customerId",
      "supplierId",
      "memoDate",
      "postingDate",
      "currencyCode",
      "exchangeRate",
      "amount",
      "reasonAccount",
      "reference",
      "notes",
      "postedAt",
      "createdAt",
      "updatedAt"
    ])
    .where("id", "in", args.ids)
    .where("companyId", "=", args.companyId)
    .where(
      args.party === "customer" ? "customerId" : "supplierId",
      "is not",
      null
    )
    .execute();

  if (rows.length === 0) return new Map();

  const settlementRows = await database
    .selectFrom("invoiceSettlement")
    .select([
      "id",
      "memoId",
      "appliedAmount",
      "appliedDate",
      "targetSalesInvoiceId",
      "targetPurchaseInvoiceId",
      "targetMemoId",
      "discountAmount",
      "writeOffAmount",
      "sourceExchangeRate",
      "targetExchangeRate"
    ])
    .where(
      "memoId",
      "in",
      rows.map((row) => row.id)
    )
    .where("companyId", "=", args.companyId)
    .execute();

  const settlementsByMemo = new Map<string, QboMemoSettlementRow[]>();
  for (const row of settlementRows) {
    if (!row.memoId) continue;
    const existing = settlementsByMemo.get(row.memoId) ?? [];
    existing.push({
      id: row.id,
      appliedAmount: Number(row.appliedAmount) || 0,
      appliedDate: toDateString(row.appliedDate),
      targetSalesInvoiceId: row.targetSalesInvoiceId,
      targetPurchaseInvoiceId: row.targetPurchaseInvoiceId,
      targetMemoId: row.targetMemoId,
      discountAmount: Number(row.discountAmount) || 0,
      writeOffAmount: Number(row.writeOffAmount) || 0,
      sourceExchangeRate: Number(row.sourceExchangeRate) || 1,
      targetExchangeRate: Number(row.targetExchangeRate) || 1
    });
    settlementsByMemo.set(row.memoId, existing);
  }

  const result = new Map<string, QboMemoSource>();
  for (const row of rows) {
    result.set(row.id, {
      id: row.id,
      memoId: row.memoId,
      direction: row.direction,
      status: row.status,
      customerId: row.customerId,
      supplierId: row.supplierId,
      memoDate: toDateString(row.memoDate),
      postingDate: row.postingDate ? toDateString(row.postingDate) : null,
      currencyCode: row.currencyCode,
      exchangeRate: Number(row.exchangeRate) || 1,
      amount: Number(row.amount) || 0,
      reasonAccount: row.reasonAccount,
      reference: row.reference,
      notes: row.notes,
      // A settlement never bumps memo.updatedAt, so the fallback chain must be
      // STABLE — `new Date()` here would defeat the base syncer's
      // already-synced bailout and re-push every drain.
      updatedAt: toTimestampString(
        row.updatedAt ?? row.postedAt ?? row.createdAt
      ),
      settlements: (settlementsByMemo.get(row.id) ?? []).sort((a, b) =>
        a.id.localeCompare(b.id)
      )
    });
  }

  return result;
}

/** Kysely's pg driver returns DATE columns as JS Dates; QBO wants YYYY-MM-DD. */
function toDateString(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

function toTimestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Which settlements this memo's mapping row already applied remotely. Applying
 * the same credit twice is real accounting corruption, and QBO's `requestid`
 * replay window is not a durable dedupe — so the applied ids are persisted.
 */
export function readQboAppliedSettlementIds(
  mapping: ExternalIntegrationMapping | null | undefined
): string[] {
  const value = mapping?.metadata?.appliedSettlementIds;
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
}

export class QboCreditMemoSyncer extends BaseEntitySyncer<
  QboMemoSource,
  Qbo.CreditMemo,
  QboWriteOmit
> {
  private accountRefsByIdPromise?: Promise<Map<string, Qbo.Ref>>;
  private baseCurrencyCodePromise?: Promise<string>;
  private remoteMetaById = new Map<
    string,
    { syncToken?: string; lastUpdatedTime?: string }
  >();
  /** Settlement ids applied during THIS push, flushed by linkEntities. */
  private appliedSettlementIds = new Map<string, string[]>();

  private get qboProvider(): QboProvider {
    return this.provider as QboProvider;
  }

  private rememberRemoteEntity(
    remote: Pick<Qbo.CreditMemo, "Id" | "SyncToken" | "MetaData"> | null
  ): void {
    if (!remote?.Id) return;
    this.remoteMetaById.set(remote.Id, {
      syncToken: remote.SyncToken,
      lastUpdatedTime: remote.MetaData?.LastUpdatedTime
    });
  }

  private getAccountRefsById(): Promise<Map<string, Qbo.Ref>> {
    if (!this.accountRefsByIdPromise) {
      this.accountRefsByIdPromise = loadQboAccountRefsById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountRefsByIdPromise;
  }

  private getBaseCurrencyCode(): Promise<string> {
    if (!this.baseCurrencyCodePromise) {
      this.baseCurrencyCodePromise = (async () => {
        const company = await this.database
          .selectFrom("company")
          .select("baseCurrencyCode")
          .where("id", "=", this.companyId)
          .executeTakeFirst();
        if (!company?.baseCurrencyCode) {
          throw new Error(
            `Company ${this.companyId} has no base currency — required to decide whether a credit memo is a foreign-currency document`
          );
        }
        return company.baseCurrencyCode;
      })();
    }
    return this.baseCurrencyCodePromise;
  }

  // =================================================================
  // 1. ID MAPPING — record SyncToken + the applied settlement ids
  // =================================================================

  protected async linkEntities(
    tx: KyselyTx,
    localId: string,
    remoteId: string,
    remoteUpdatedAt?: Date
  ): Promise<void> {
    const seen = this.remoteMetaById.get(remoteId);
    const applied = this.appliedSettlementIds.get(localId) ?? [];
    const txMappingService = createMappingService(tx, this.companyId);
    await txMappingService.link(
      this.entityType,
      localId,
      this.provider.id,
      remoteId,
      {
        remoteUpdatedAt:
          remoteUpdatedAt ?? parseQboDate(seen?.lastUpdatedTime) ?? undefined,
        metadata: {
          ...(seen?.syncToken !== undefined
            ? { syncToken: seen.syncToken }
            : {}),
          ...(applied.length > 0 ? { appliedSettlementIds: applied } : {})
        }
      }
    );
  }

  protected getRemoteUpdatedAt(remote: Qbo.CreditMemo): Date | null {
    return parseQboDate(remote.MetaData?.LastUpdatedTime);
  }

  // =================================================================
  // 2. LOCAL / REMOTE FETCH
  // =================================================================

  async fetchLocal(id: string): Promise<QboMemoSource | null> {
    return (await this.fetchLocalBatch([id])).get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, QboMemoSource>> {
    return loadQboMemoSources(this.database, {
      companyId: this.companyId,
      ids,
      party: "customer"
    });
  }

  async fetchRemote(id: string): Promise<Qbo.CreditMemo | null> {
    const creditMemo = await this.qboProvider.getCreditMemo(id);
    this.rememberRemoteEntity(creditMemo);
    return creditMemo;
  }

  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Qbo.CreditMemo>> {
    const result = new Map<string, Qbo.CreditMemo>();
    for (const id of ids) {
      const creditMemo = await this.fetchRemote(id);
      if (creditMemo) result.set(creditMemo.Id, creditMemo);
    }
    return result;
  }

  // =================================================================
  // 3. SHOULD SYNC — party, posted status, and the v1 increaser skip
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<QboMemoSource, Qbo.CreditMemo>
  ): boolean | string {
    if (context.direction === "pull") {
      return "Credit memos are push-only — QuickBooks Online credit memos are not pulled into Carbon";
    }
    if (!context.localEntity) return true;
    return qboCreditMemoSkipReason(context.localEntity) ?? true;
  }

  // =================================================================
  // 4. TRANSFORMATION (Carbon -> QBO)
  // =================================================================

  protected async mapToRemote(
    local: QboMemoSource
  ): Promise<QboCreatePayload<Qbo.CreditMemo>> {
    if (!local.customerId) {
      throw new Error(
        `Cannot sync memo ${local.memoId}: no customer linked to this credit memo`
      );
    }

    // JIT dependency: customer before the document
    let customerRemoteId = await this.mappingService.getExternalId(
      "customer",
      local.customerId,
      this.provider.id
    );
    if (!customerRemoteId) {
      customerRemoteId = await this.ensureDependencySynced(
        "customer",
        local.customerId
      );
    }
    if (!customerRemoteId) {
      throw new Error(
        `Cannot sync memo ${local.memoId}: customer not synced to QuickBooks Online`
      );
    }

    const reasonItemRef = await this.resolveReasonItemRef(local);

    return buildQboCreditMemoPayload({
      memo: local,
      customerRef: { value: customerRemoteId },
      reasonItemRef,
      baseCurrencyCode: await this.getBaseCurrencyCode()
    });
  }

  /**
   * The memo's reason account → its mapped QBO income account → the
   * provider-side Service Item bound to it. Both misses are the structured
   * UNMAPPED_ACCOUNTS Warning (user-fixable: map the account, then retry).
   */
  private async resolveReasonItemRef(local: QboMemoSource): Promise<Qbo.Ref> {
    if (!local.reasonAccount) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `Cannot sync memo ${local.memoId}: it has no reason account. Post the memo (with accounting enabled), then retry.`,
        warning: true,
        metadata: { memoId: local.id }
      });
    }

    const incomeAccountRef = (await this.getAccountRefsById()).get(
      local.reasonAccount
    );
    if (!incomeAccountRef) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `Cannot sync memo ${local.memoId}: its reason account has no QuickBooks Online account mapping. Map the account on the integration settings page, then retry.`,
        warning: true,
        metadata: {
          memoId: local.id,
          unmappedAccountIds: [local.reasonAccount]
        }
      });
    }

    const account = await this.database
      .selectFrom("account")
      .select(["number", "name"])
      .where("id", "=", local.reasonAccount)
      .executeTakeFirst();

    return resolveQboCreditReasonItemRef({
      mapping: this.mappingService,
      integration: this.provider.id,
      accountId: local.reasonAccount,
      accountNumber: account?.number ?? null,
      accountName: account?.name ?? null,
      incomeAccountRef,
      createServiceItem: (input) =>
        this.qboProvider.createServiceItem({
          ...input,
          requestId: buildQboRequestId(
            this.companyId,
            CREDIT_REASON_ITEM_ENTITY_TYPE,
            local.reasonAccount!
          )
        })
    });
  }

  // =================================================================
  // 5. PUSH-ONLY
  // =================================================================

  protected async mapToLocal(): Promise<Partial<QboMemoSource>> {
    throw new Error(
      "Credit memos are push-only. Cannot map a QuickBooks Online credit memo to Carbon."
    );
  }

  protected async upsertLocal(): Promise<string> {
    throw new Error(
      "Credit memos are push-only. Cannot upsert locally from QuickBooks Online."
    );
  }

  // =================================================================
  // 6. UPSERT REMOTE — create once, then apply the outstanding settlements
  // =================================================================

  protected async upsertRemote(
    data: QboCreatePayload<Qbo.CreditMemo>,
    localId: string
  ): Promise<string> {
    const mapping = await this.mappingService.getByEntity(
      this.entityType,
      localId,
      this.provider.id
    );

    let remoteId = mapping?.externalId ?? null;
    if (!remoteId) {
      // A posted memo is immutable in Carbon, so there is no update path — the
      // deterministic requestid is what makes a retried create safe.
      const created = await this.qboProvider.createCreditMemo(
        data,
        buildQboRequestId(this.companyId, "creditMemo", localId)
      );
      if (!created?.Id) {
        throw new Error(
          "QuickBooks Online returned no CreditMemo Id for this memo"
        );
      }
      this.rememberRemoteEntity(created);
      remoteId = created.Id;
    }

    await this.applySettlements(localId, remoteId, data.CustomerRef, mapping);

    return remoteId;
  }

  /**
   * One zero-cash `Payment` per NOT-YET-APPLIED settlement (see
   * `readQboAppliedSettlementIds`).
   */
  private async applySettlements(
    localId: string,
    remoteId: string,
    customerRef: Qbo.Ref,
    mapping: ExternalIntegrationMapping | null
  ): Promise<void> {
    const local = await this.fetchLocal(localId);
    if (!local) return;

    const alreadyApplied = new Set(readQboAppliedSettlementIds(mapping));
    const applied = [...alreadyApplied];

    for (const settlement of local.settlements) {
      if (alreadyApplied.has(settlement.id)) continue;
      if (!settlement.targetSalesInvoiceId) continue;

      const invoiceRemoteId = await this.mappingService.getExternalId(
        "invoice",
        settlement.targetSalesInvoiceId,
        this.provider.id
      );
      if (!invoiceRemoteId) {
        throw new JournalEntrySyncError({
          errorCode: "UNSYNCED_DOCUMENT",
          message: `Memo ${local.memoId} is applied to a sales invoice that has not synced to QuickBooks Online yet — sync the invoice, then retry`,
          warning: true,
          metadata: {
            memoId: local.id,
            targetSalesInvoiceId: settlement.targetSalesInvoiceId
          }
        });
      }

      const payload: QboCreditMemoApplicationPayload = {
        CustomerRef: customerRef,
        TotalAmt: 0,
        TxnDate: settlement.appliedDate,
        Line: [
          {
            Amount: settlement.appliedAmount,
            LinkedTxn: [{ TxnId: invoiceRemoteId, TxnType: "Invoice" }]
          },
          {
            Amount: settlement.appliedAmount,
            LinkedTxn: [{ TxnId: remoteId, TxnType: "CreditMemo" }]
          }
        ]
      };

      await this.qboProvider.applyCreditMemo(
        payload,
        buildQboRequestId(this.companyId, "creditMemoApply", settlement.id)
      );
      applied.push(settlement.id);
    }

    this.appliedSettlementIds.set(localId, applied);
  }

  protected async upsertRemoteBatch(
    data: Array<{
      localId: string;
      payload: QboCreatePayload<Qbo.CreditMemo>;
    }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload, localId));
    }
    return result;
  }
}
