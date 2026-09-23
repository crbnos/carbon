import { createHash } from "node:crypto";
import type { Database } from "@carbon/database";
import type { KyselyTx } from "@carbon/database/client";
import { loadAccountCodesById } from "../../../core/account-mapping";
import { createMappingService } from "../../../core/external-mapping";
import { MEMO_INCREASER_SKIP_REASON } from "../../../core/models";
import { JournalEntrySyncError } from "../../../core/posting";
import { BaseEntitySyncer, type ShouldSyncContext } from "../../../core/types";
import { withTriggersDisabled } from "../../../core/utils";
import { parseDotnetDate, type Xero } from "../models";
import type { XeroProvider } from "../provider";
import { assertXeroMoneyPrecision } from "../serialize";

/**
 * Xero credit notes for Carbon `memo` rows.
 *
 * This file hosts the shared Xero credit-note machinery AND the AR
 * (`creditMemo`) syncer; `./vendor-credit` is the AP (`vendorCredit`) subclass.
 * The two differ only in party, Xero `Type`, the settled-document entity type
 * and whether Xero accepts a `Reference` — everything else (line building,
 * create, allocation, recovery) is identical, so it lives once here rather
 * than being copied into two files that would drift.
 *
 * Three Xero rules drive the shape (primary-source API survey, recorded in
 * `.ai/plans/2026-09-23-memo-external-gl-representation.md`):
 *  1. A credit note is created directly AUTHORISED — Xero will not allocate a
 *     DRAFT one, and it forbids create-and-allocate in one request.
 *  2. Allocation is a separate `PUT /CreditNotes/{id}/Allocations` and is
 *     ADDITIVE, not a reconcile, so idempotency is ours to own (one mapping row
 *     per Carbon `invoiceSettlement`).
 *  3. `Contact` carries `ContactID` ONLY — any other contact field mutates the
 *     Xero contact record and deletes its ContactPersons.
 */

/** `memo.direction` / `memo.status`, typed from the DB enums rather than restated. */
export type MemoDirection = Database["public"]["Enums"]["memoDirection"];
export type MemoStatus = Database["public"]["Enums"]["memoStatus"];

/**
 * The v1 limitation, worded once. Carbon has four memo combos; only the two
 * balance-REDUCING ones map onto a provider credit document:
 *
 *   customer + Credit -> AR down -> ACCRECCREDIT   (supported)
 *   supplier + Debit  -> AP down -> ACCPAYCREDIT   (supported)
 *   customer + Debit  -> AR up   -> an extra CHARGE, not a credit  (skipped)
 *   supplier + Credit -> AP up   -> an extra BILL,   not a credit  (skipped)
 *
 * An increaser is its own open item in Carbon (settled via
 * `invoiceSettlement.targetMemoId`), so representing it would mean pushing an
 * invoice/bill, not a credit note. Rather than push a malformed credit note or
 * drop the memo silently, `shouldSync` returns this reason and the operation
 * closes `Skipped` with it in `errorMessage` (truthful-ledger rule: a skip
 * WITHOUT a remoteId closes `Skipped`, never `Completed`).
 *
 * The SENTENCE is deliberately identical to QuickBooks Online's and Rillet's
 * copies, so an operator sees the same wording whichever provider is connected.
 * The SYMBOL is Xero-prefixed only because all three live in provider barrels
 * that `providers/index.ts` star-exports into one namespace — the constant
 * really belongs in `core/`.
 */
export const XERO_MEMO_INCREASER_SKIP_REASON = MEMO_INCREASER_SKIP_REASON;

/**
 * `externalIntegrationMapping.entityType` for ONE Xero credit-note allocation,
 * keyed by `<memoId>:<invoiceSettlementId>`.
 *
 * Xero's allocation call is additive — re-sending it allocates AGAIN — so a
 * retry (or a second application added later) must be able to tell which
 * settlements are already on the credit note. One durable row per settlement
 * makes the fan-out resumable exactly the way `PaymentSyncerBase` makes its
 * per-settlement payment fan-out resumable.
 */
export const CREDIT_NOTE_ALLOCATION_ENTITY_TYPE = "creditNoteAllocation";

/** `<memoId>:<invoiceSettlementId>` — the allocation mapping's Carbon-side key. */
export function creditNoteAllocationKey(
  memoId: string,
  settlementId: string
): string {
  return `${memoId}:${settlementId}`;
}

/** One `invoiceSettlement` row funded by the memo (source = `memoId`). */
export interface XeroMemoApplication {
  id: string;
  appliedDate: string;
  /** Exact source-document principal, in the MEMO's currency. */
  sourceAmount: number | null;
  appliedAmount: number;
  discountAmount: number;
  writeOffAmount: number;
  fxGainLossAmount: number;
  sourceExchangeRate: number;
  targetExchangeRate: number;
  targetSalesInvoiceId: string | null;
  targetPurchaseInvoiceId: string | null;
}

/** The Carbon `memo` row plus the applications it funds. */
export interface XeroMemoSource {
  id: string;
  memoId: string;
  direction: MemoDirection;
  status: MemoStatus;
  customerId: string | null;
  supplierId: string | null;
  memoDate: string;
  postingDate: string | null;
  currencyCode: string;
  exchangeRate: number;
  /** Document-currency amount (`toBaseAmount(amount, exchangeRate)` is the base value). */
  amount: number;
  reasonAccount: string | null;
  reference: string | null;
  notes: string | null;
  updatedAt: string;
  applications: XeroMemoApplication[];
}

/** What a credit note is written as — Xero fills the id and timestamp. */
export type XeroCreditNoteWrite = Omit<
  Xero.CreditNote,
  "CreditNoteID" | "UpdatedDateUTC"
>;

/**
 * The single credit-note line: the memo's reason account, coded by
 * `AccountCode` directly. Xero needs **no item** for this — an AccountCode-only
 * line is Xero's own canonical example, which is why Xero is the one provider
 * that never touches `resolveCreditReasonItem`.
 *
 * `Quantity: 1` + `UnitAmount` = the memo amount; `LineAmount` is deliberately
 * NOT sent so Xero derives it from the pair it was given. `TaxType: "NONE"`
 * keeps the line tax-neutral — a Carbon memo posts DR reason / CR receivables
 * with no tax component, and a defaulted Xero tax rate would silently change
 * the amount.
 *
 * Pure — exported for tests.
 */
export function buildXeroCreditNoteLineItem(args: {
  memo: XeroMemoSource;
  accountCodesById: ReadonlyMap<string, string>;
}): Xero.CreditNoteLineItem {
  const { memo } = args;

  if (!memo.reasonAccount) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `Cannot sync memo ${memo.memoId}: it has no reason account. The reason account is derived when the memo is posted — post the memo, then retry.`,
      warning: true,
      metadata: { memoId: memo.id }
    });
  }

  const accountCode = args.accountCodesById.get(memo.reasonAccount);
  if (!accountCode) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      message: `Cannot sync memo ${memo.memoId}: its reason account has no Xero account mapping. Map the account on the integration settings page, then retry.`,
      warning: true,
      metadata: { memoId: memo.id, unmappedAccountIds: [memo.reasonAccount] }
    });
  }

  assertXeroMoneyPrecision(memo.amount);

  return {
    Description: memo.notes ?? memo.reference ?? memo.memoId,
    Quantity: 1,
    UnitAmount: memo.amount,
    AccountCode: accountCode,
    TaxType: "NONE"
  };
}

/**
 * Shared base for the two Xero credit-note syncers. Push-only: a credit note
 * created in Xero is not pulled back into Carbon as a memo (`memo` is
 * Carbon-owned — see `XERO_CARBON_OWNED_ENTITIES`).
 */
export abstract class XeroCreditNoteSyncerBase extends BaseEntitySyncer<
  XeroMemoSource,
  Xero.CreditNote,
  "CreditNoteID" | "UpdatedDateUTC"
> {
  private accountCodesByIdPromise?: Promise<Map<string, string>>;

  protected get xeroProvider(): XeroProvider {
    return this.provider as XeroProvider;
  }

  // =================================================================
  // Per-family contract
  // =================================================================

  /** ACCRECCREDIT (customer) or ACCPAYCREDIT (supplier). */
  protected abstract readonly creditNoteType: Xero.CreditNote["Type"];

  /** The party column that must be set on the memo. */
  protected abstract readonly party: "customer" | "supplier";

  /**
   * The memo direction that REDUCES this party's balance. The other direction
   * is an increaser and is skipped (see XERO_MEMO_INCREASER_SKIP_REASON).
   */
  protected abstract readonly decreasingDirection: MemoDirection;

  /** Entity type of the party contact, for `ensureDependencySynced`. */
  protected abstract readonly contactEntityType: "customer" | "vendor";

  /** Entity type of the settled document, for `ensureDependencySynced`. */
  protected abstract readonly documentEntityType: "invoice" | "bill";

  /** Human word for the settled document, used in messages. */
  protected abstract readonly documentLabel: string;

  protected partyId(memo: XeroMemoSource): string | null {
    return this.party === "customer" ? memo.customerId : memo.supplierId;
  }

  protected targetDocumentId(application: XeroMemoApplication): string | null {
    return this.documentEntityType === "invoice"
      ? application.targetSalesInvoiceId
      : application.targetPurchaseInvoiceId;
  }

  // =================================================================
  // 1. TIMESTAMP EXTRACTION
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.CreditNote): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    return parseDotnetDate(remote.UpdatedDateUTC);
  }

  // =================================================================
  // 2. LOCAL FETCH (Single + Batch)
  // =================================================================

  async fetchLocal(id: string): Promise<XeroMemoSource | null> {
    const memos = await this.fetchMemosByIds([id]);
    return memos.get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, XeroMemoSource>> {
    if (ids.length === 0) return new Map();
    return this.fetchMemosByIds(ids);
  }

  private async fetchMemosByIds(
    ids: string[]
  ): Promise<Map<string, XeroMemoSource>> {
    const result = new Map<string, XeroMemoSource>();
    if (ids.length === 0) return result;

    const memoRows = await this.database
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
        "updatedAt",
        "createdAt"
      ])
      .where("id", "in", ids)
      .where("companyId", "=", this.companyId)
      .execute();

    if (memoRows.length === 0) return result;

    // Applications the memo FUNDS (source = memoId). A balance-increasing memo
    // is instead the TARGET of a settlement (targetMemoId) — it never reaches
    // here because shouldSync skips it.
    const settlementRows = await this.database
      .selectFrom("invoiceSettlement")
      .select([
        "id",
        "memoId",
        "appliedDate",
        "sourceAmount",
        "appliedAmount",
        "discountAmount",
        "writeOffAmount",
        "fxGainLossAmount",
        "sourceExchangeRate",
        "targetExchangeRate",
        "targetSalesInvoiceId",
        "targetPurchaseInvoiceId"
      ])
      .where(
        "memoId",
        "in",
        memoRows.map((memo) => memo.id)
      )
      .where("companyId", "=", this.companyId)
      .orderBy("id")
      .execute();

    const applicationsByMemo = new Map<string, XeroMemoApplication[]>();
    for (const row of settlementRows) {
      if (!row.memoId) continue;
      const existing = applicationsByMemo.get(row.memoId) ?? [];
      existing.push({
        id: row.id,
        appliedDate: toDateString(row.appliedDate),
        sourceAmount:
          row.sourceAmount === null ? null : Number(row.sourceAmount),
        appliedAmount: Number(row.appliedAmount) || 0,
        discountAmount: Number(row.discountAmount) || 0,
        writeOffAmount: Number(row.writeOffAmount) || 0,
        fxGainLossAmount: Number(row.fxGainLossAmount) || 0,
        sourceExchangeRate: Number(row.sourceExchangeRate) || 1,
        targetExchangeRate: Number(row.targetExchangeRate) || 1,
        targetSalesInvoiceId: row.targetSalesInvoiceId,
        targetPurchaseInvoiceId: row.targetPurchaseInvoiceId
      });
      applicationsByMemo.set(row.memoId, existing);
    }

    for (const row of memoRows) {
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
        updatedAt: toTimestampString(row.updatedAt ?? row.createdAt),
        applications: applicationsByMemo.get(row.id) ?? []
      });
    }

    return result;
  }

  // =================================================================
  // 3. REMOTE FETCH (Single + Batch)
  // =================================================================

  async fetchRemote(id: string): Promise<Xero.CreditNote | null> {
    const result = await this.xeroProvider.request<{
      CreditNotes: Xero.CreditNote[];
    }>("GET", `/CreditNotes/${encodeURIComponent(id)}`);

    if (result.error) return null;

    const creditNote = result.data?.CreditNotes?.[0];
    if (!creditNote || creditNote.Type !== this.creditNoteType) return null;

    return creditNote;
  }

  /**
   * Xero has no `IDs=` filter on /CreditNotes, so this is N reads. It is only
   * reached on the pull path, which this push-only entity never takes; the
   * loop keeps the contract honest rather than returning a lie.
   */
  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.CreditNote>> {
    const result = new Map<string, Xero.CreditNote>();
    for (const id of ids) {
      const creditNote = await this.fetchRemote(id);
      if (creditNote) result.set(id, creditNote);
    }
    return result;
  }

  // =================================================================
  // 4. SHOULD SYNC — party, v1 increaser limit, posted gate
  // =================================================================

  protected shouldSync(
    context: ShouldSyncContext<XeroMemoSource, Xero.CreditNote>
  ): boolean | string {
    if (context.direction !== "push" || !context.localEntity) return true;

    const memo = context.localEntity;

    // Own party first — `memo` backs two entity types, resolved per row by
    // party, so a mis-routed row must say so rather than push the wrong Type.
    const partyId = this.partyId(memo);
    if (!partyId) {
      return `Memo ${memo.memoId} has no ${this.party} — it is not a ${this.documentLabel} credit`;
    }

    // The v1 limitation, before any other gate, so the skip reason names it.
    if (memo.direction !== this.decreasingDirection) {
      return `${XERO_MEMO_INCREASER_SKIP_REASON} (memo ${memo.memoId} is a ${this.party} ${memo.direction} memo, which increases the balance)`;
    }

    if (memo.status !== "Posted") {
      return `Memo ${memo.memoId} must be posted before syncing (current status: ${memo.status})`;
    }

    // Xero allocates in the credit note's own currency and Carbon's posting
    // already refuses a memo application whose rate snapshot differs from its
    // target's. Guessing an FX allocation would post a wrong amount, so park.
    const crossCurrency = memo.applications.find(
      (application) =>
        application.sourceExchangeRate !== application.targetExchangeRate
    );
    if (crossCurrency) {
      return `Memo ${memo.memoId} has a cross-currency application (settlement ${crossCurrency.id}) — cross-currency credit-note allocation is not supported in v1`;
    }

    const adjusted = memo.applications.find(
      (application) =>
        application.discountAmount !== 0 ||
        application.writeOffAmount !== 0 ||
        application.fxGainLossAmount !== 0
    );
    if (adjusted) {
      return `Memo ${memo.memoId} has an application carrying a discount, write-off or FX gain/loss (settlement ${adjusted.id}) — adjusted credit-note allocation is not supported in v1`;
    }

    return true;
  }

  private getAccountCodesById(): Promise<Map<string, string>> {
    if (!this.accountCodesByIdPromise) {
      this.accountCodesByIdPromise = loadAccountCodesById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountCodesByIdPromise;
  }

  // =================================================================
  // 5. TRANSFORMATION (Carbon -> Xero)
  // =================================================================

  protected async mapToRemote(
    local: XeroMemoSource
  ): Promise<XeroCreditNoteWrite> {
    const accountCodesById = await this.getAccountCodesById();
    const lineItem = buildXeroCreditNoteLineItem({
      memo: local,
      accountCodesById
    });

    const partyId = this.partyId(local);
    if (!partyId) {
      throw new Error(
        `Cannot sync memo ${local.memoId}: no ${this.party} linked`
      );
    }
    const contactId = await this.ensureDependencySynced(
      this.contactEntityType,
      partyId
    );

    const company = await this.database
      .selectFrom("company")
      .select("baseCurrencyCode")
      .where("id", "=", this.companyId)
      .executeTakeFirst();
    if (!company?.baseCurrencyCode) {
      throw new Error(
        `Cannot sync memo ${local.memoId}: the company has no base currency`
      );
    }

    return {
      Type: this.creditNoteType,
      // ACCPAYCREDIT has NO Reference field, so the Carbon document number
      // travels in CreditNoteNumber for BOTH types — it is also the key the
      // create-recovery read looks the credit note up by.
      CreditNoteNumber: local.memoId,
      // Xero rejects Reference on an ACCPAYCREDIT; only the AR type carries it.
      ...(this.creditNoteType === "ACCRECCREDIT" && local.reference
        ? { Reference: local.reference }
        : {}),
      // ContactID ONLY: any other contact field mutates the Xero contact
      // record and deletes its ContactPersons.
      Contact: { ContactID: contactId },
      Date: local.postingDate ?? local.memoDate,
      // A credit note must be AUTHORISED to be allocatable, and Xero forbids
      // create-and-allocate in one request — so it is born AUTHORISED.
      Status: "AUTHORISED",
      CurrencyCode: local.currencyCode,
      // Pin every foreign snapshot, including a negotiated 1:1 rate.
      CurrencyRate:
        local.currencyCode !== company.baseCurrencyCode
          ? local.exchangeRate
          : undefined,
      LineItems: [lineItem]
    };
  }

  // =================================================================
  // 6. TRANSFORMATION (Xero -> Carbon) — not supported (push-only)
  // =================================================================

  protected async mapToLocal(
    _remote: Xero.CreditNote
  ): Promise<Partial<XeroMemoSource>> {
    throw new Error(
      "Credit notes are push-only. Cannot map from Xero to Carbon."
    );
  }

  protected async upsertLocal(
    _tx: KyselyTx,
    _data: Partial<XeroMemoSource>,
    _remoteId: string
  ): Promise<string> {
    throw new Error(
      "Credit notes are push-only. Cannot upsert locally from Xero."
    );
  }

  // =================================================================
  // 7. UPSERT REMOTE — create (once), then allocate (additively, guarded)
  // =================================================================

  protected async upsertRemote(
    data: XeroCreditNoteWrite,
    localId: string
  ): Promise<string> {
    const creditNoteId = await this.resolveCreditNote(data, localId);
    await this.settleAllocations(creditNoteId, localId);
    return creditNoteId;
  }

  /**
   * One credit note per memo, never an update: a posted Carbon memo's amount
   * and reason account are immutable, and Xero refuses line edits to an
   * allocated credit note. Only the applications move, and those are
   * `settleAllocations`' job.
   *
   * Recovery order: the mapping row, then a deterministic read by
   * `CreditNoteNumber`. The second exists because the remote create and the
   * local mapping write are not one transaction — Xero's `Idempotency-Key`
   * expires after six minutes, so a retry outside that window would otherwise
   * mint a duplicate credit note.
   */
  private async resolveCreditNote(
    data: XeroCreditNoteWrite,
    localId: string
  ): Promise<string> {
    const mapped = await this.getRemoteId(localId);
    if (mapped) return mapped;

    const creditNoteNumber = data.CreditNoteNumber;
    if (!creditNoteNumber) {
      throw new Error(
        `Cannot sync memo ${localId}: the credit note carries no CreditNoteNumber, so a retry could not recover it`
      );
    }

    const existing =
      await this.xeroProvider.getCreditNoteByNumber(creditNoteNumber);
    if (existing) {
      if (existing.Type !== data.Type || existing.Status === "DELETED") {
        throw new Error(
          `Xero credit note ${creditNoteNumber} exists but is ${existing.Status} ${existing.Type}; resolve it in Xero before retrying`
        );
      }
      return existing.CreditNoteID;
    }

    const created = await this.xeroProvider.createCreditNote(data, {
      // Transient-network guard only (Xero expires it after six minutes);
      // durable idempotency is the mapping row + the recovery read above.
      idempotencyKey: createHash("sha256")
        .update(`${this.companyId}:${this.entityType}:${localId}`)
        .digest("hex")
    });

    return created.CreditNoteID;
  }

  /**
   * Push each `invoiceSettlement` the memo funds as ONE
   * `PUT /CreditNotes/{id}/Allocations` call.
   *
   * Xero's allocation is ADDITIVE, not a reconcile, so each settlement gets its
   * own durable mapping row and an already-covered one is skipped. That makes
   * the fan-out resumable: a failure on application k leaves 1..k-1 durable and
   * the retry pushes only what is still uncovered.
   */
  private async settleAllocations(
    creditNoteId: string,
    localId: string
  ): Promise<void> {
    const memo = await this.fetchLocal(localId);
    if (!memo || memo.applications.length === 0) return;

    for (const application of memo.applications) {
      const key = creditNoteAllocationKey(memo.id, application.id);
      const covered = await this.mappingService.getExternalId(
        CREDIT_NOTE_ALLOCATION_ENTITY_TYPE,
        key,
        this.provider.id
      );
      if (covered) continue;

      const targetDocumentId = this.targetDocumentId(application);
      if (!targetDocumentId) {
        throw new JournalEntrySyncError({
          errorCode: "UNSYNCED_DOCUMENT",
          message: `Cannot allocate memo ${memo.memoId}: application ${application.id} has no ${this.documentLabel} target.`,
          warning: true,
          metadata: { memoId: memo.id, settlementId: application.id }
        });
      }

      const amount = application.sourceAmount;
      if (amount === null || !Number.isFinite(amount) || amount <= 0) {
        throw new JournalEntrySyncError({
          errorCode: "UNSYNCED_DOCUMENT",
          message: `Cannot allocate memo ${memo.memoId}: application ${application.id} has no positive source principal.`,
          warning: true,
          metadata: { memoId: memo.id, settlementId: application.id }
        });
      }
      assertXeroMoneyPrecision(amount);

      const invoiceRemoteId = await this.ensureDependencySynced(
        this.documentEntityType,
        targetDocumentId
      );

      const allocation = await this.xeroProvider.allocateCreditNote(
        creditNoteId,
        {
          Invoice: { InvoiceID: invoiceRemoteId },
          // Documented read-only, but Xero's own OpenAPI spec marks it required.
          Date: application.appliedDate,
          Amount: amount
        }
      );

      // Link immediately so a later application's failure cannot cause this
      // one to be re-allocated on the retry.
      await withTriggersDisabled(this.database, async (tx) => {
        await createMappingService(tx, this.companyId).link(
          CREDIT_NOTE_ALLOCATION_ENTITY_TYPE,
          key,
          this.provider.id,
          allocation.AllocationID ?? `${creditNoteId}:${application.id}`
        );
      });
    }
  }

  /**
   * One credit note per request: each needs its own allocation round-trips and
   * its own recovery read, and memo volumes per drain are small.
   */
  protected async upsertRemoteBatch(
    data: Array<{ localId: string; payload: XeroCreditNoteWrite }>
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const { localId, payload } of data) {
      result.set(localId, await this.upsertRemote(payload, localId));
    }
    return result;
  }
}

/**
 * Customer credits (`creditMemo`): a customer + **Credit** memo reduces AR and
 * is pushed as a Xero `ACCRECCREDIT`. A customer + Debit memo increases AR and
 * is skipped (XERO_MEMO_INCREASER_SKIP_REASON).
 */
export class CreditMemoSyncer extends XeroCreditNoteSyncerBase {
  protected readonly creditNoteType = "ACCRECCREDIT" as const;
  protected readonly party = "customer" as const;
  protected readonly decreasingDirection: MemoDirection = "Credit";
  protected readonly contactEntityType = "customer" as const;
  protected readonly documentEntityType = "invoice" as const;
  protected readonly documentLabel = "sales invoice";
}

/** DATE columns arrive from the pg driver as JS Dates; keep them as YYYY-MM-DD. */
function toDateString(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

function toTimestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
