import type { NormalizedPayment } from "../../../core/payment-application";
import {
  type PaymentPushContext,
  PaymentSyncerBase
} from "../../../core/payment-syncer";
import { JournalEntrySyncError } from "../../../core/posting";
import type { ShouldSyncContext } from "../../../core/types";
import { parseQboDate, type Qbo } from "../models";
import type { QboProvider } from "../provider";
import { loadQboAccountRefsById } from "./shared";

/**
 * QboPaymentSyncer — the first QBO payment syncer, on the shared
 * `PaymentSyncerBase`. QBO `BillPayment` objects settle Carbon purchase
 * invoices (AP); QBO `Payment` objects settle Carbon sales invoices (AR). The
 * base writes a Draft `payment` + `invoiceSettlement` and then invokes the
 * native `post-payment` edge function (GL journal + Posted/Voided status).
 * Two-way as of Phase G: a Carbon-born Posted payment pushes back out as a QBO
 * Payment (AR) / BillPayment (AP) document (see `pushRemotePayment`).
 *
 * Entity-id contract: the sync operation's entityId is a COMPOSITE, kept
 * identical to the Rillet AP convention. AR is prefix-less
 * `"<invoiceRemoteId>:<paymentRemoteId>"`; AP is
 * `"bill:<primaryBillRemoteId>:<billPaymentRemoteId>"`. For a multi-bill
 * BillPayment the composite carries the FIRST linked bill (for
 * `dependsOnMapping` + the ownership skip), and `mapToNormalized` returns
 * `linkedDocuments` for ALL `Line[].LinkedTxn{TxnType:"Bill"}` so the core fans
 * settlements out over the mapped ones. The `bill:` prefix is also the family
 * discriminator the syncer branches on.
 *
 * Unlike Rillet, QBO payments are directly addressable by id, so `fetchRemote`
 * parses out the `paymentRemoteId` and queries the object directly; the
 * document half of the composite is only used for `dependsOnMapping` + the
 * shouldSync ownership skip.
 */

const SYNC_ID_SEPARATOR = ":";
/** AP composite-id family discriminator prefix. AR is prefix-less. */
const BILL_PREFIX = "bill:";

/** Composite sync entity id for one QBO invoice payment (AR, prefix-less). */
export function getQboPaymentSyncEntityId(
  invoiceRemoteId: string,
  paymentRemoteId: string
): string {
  return `${invoiceRemoteId}${SYNC_ID_SEPARATOR}${paymentRemoteId}`;
}

/** Composite sync entity id for one QBO bill payment (AP, `bill:` prefix). */
export function getQboBillPaymentSyncEntityId(
  billRemoteId: string,
  billPaymentRemoteId: string
): string {
  return `${BILL_PREFIX}${billRemoteId}${SYNC_ID_SEPARATOR}${billPaymentRemoteId}`;
}

/**
 * Split a composite payment entity id into its family, primary document remote
 * id, and payment remote id. A `bill:` prefix marks the AP form; anything else
 * is the AR form. Throws on a malformed id.
 */
export function parseQboPaymentSyncEntityId(entityId: string): {
  family: "ar" | "ap";
  documentRemoteId: string;
  paymentRemoteId: string;
} {
  const isBill = entityId.startsWith(BILL_PREFIX);
  const remainder = isBill ? entityId.slice(BILL_PREFIX.length) : entityId;

  const separatorIndex = remainder.indexOf(SYNC_ID_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) {
    throw new Error(
      `Invalid QuickBooks Online payment sync entity id "${entityId}" — expected "<invoiceRemoteId>:<paymentRemoteId>" or "bill:<billRemoteId>:<billPaymentRemoteId>"`
    );
  }
  return {
    family: isBill ? "ap" : "ar",
    documentRemoteId: remainder.slice(0, separatorIndex),
    paymentRemoteId: remainder.slice(separatorIndex + 1)
  };
}

/** Either QBO payment wire shape the syncer handles (AR Payment / AP BillPayment). */
export type QboPayment = Qbo.Payment | Qbo.BillPayment;

/**
 * Every document (Bill for AP, Invoice for AR) a QBO payment applies to, with
 * the per-line applied amount. Reads `Line[].LinkedTxn` filtered to the
 * family's `TxnType`. A line with several LinkedTxn contributes each matching
 * one at the line's `Amount` (QBO writes one Bill/Invoice per line in
 * practice). Pure — exported for tests.
 */
export function getQboPaymentLinkedDocuments(
  remote: QboPayment,
  txnType: "Bill" | "Invoice"
): { remoteId: string; amount: number }[] {
  const docs: { remoteId: string; amount: number }[] = [];
  for (const line of remote.Line ?? []) {
    for (const linked of line.LinkedTxn ?? []) {
      if (linked.TxnType === txnType) {
        docs.push({ remoteId: linked.TxnId, amount: line.Amount ?? 0 });
      }
    }
  }
  return docs;
}

/**
 * Build the canonical composite sync entity id + primary document remote id
 * from a fetched QBO payment object. Used by both the CDC `listChanges` sweep
 * and the notification-only webhook so BOTH enqueue the IDENTICAL composite —
 * the composite is the `payment` mapping key, so a mismatch between the two
 * paths would double-record the settlement. Returns null when the payment
 * settles no Bill/Invoice (nothing for Carbon to settle). Pure — exported for
 * tests + the webhook route.
 */
export function buildQboPaymentSyncChange(
  remote: QboPayment,
  family: "ar" | "ap"
): { entityId: string; documentRemoteId: string } | null {
  const docs = getQboPaymentLinkedDocuments(
    remote,
    family === "ap" ? "Bill" : "Invoice"
  );
  const primary = docs[0];
  if (!primary) return null;

  return {
    documentRemoteId: primary.remoteId,
    entityId:
      family === "ap"
        ? getQboBillPaymentSyncEntityId(primary.remoteId, remote.Id)
        : getQboPaymentSyncEntityId(primary.remoteId, remote.Id)
  };
}

export class QboPaymentSyncer extends PaymentSyncerBase<QboPayment> {
  private get qboProvider(): QboProvider {
    return this.provider as QboProvider;
  }

  /** QBO accepts Carbon-born payments back out (Phase G). */
  protected supportsPaymentPush = true;

  /** Carbon account.id → QBO AccountRef, read once per syncer instance. */
  private accountRefsByIdPromise?: Promise<Map<string, Qbo.Ref>>;

  private getAccountRefsById(): Promise<Map<string, Qbo.Ref>> {
    if (!this.accountRefsByIdPromise) {
      this.accountRefsByIdPromise = loadQboAccountRefsById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountRefsByIdPromise;
  }

  // =================================================================
  // 1. REMOTE FETCH — composite id → the payment is addressable by id
  // =================================================================

  async fetchRemote(entityId: string): Promise<QboPayment | null> {
    const { family, paymentRemoteId } = parseQboPaymentSyncEntityId(entityId);
    const remote =
      family === "ap"
        ? await this.qboProvider.getBillPayment(paymentRemoteId)
        : await this.qboProvider.getPayment(paymentRemoteId);

    // Not found → a hard-deleted payment. The pull sweep only enqueues a
    // composite whose payment mapping still exists (it resolves the composite
    // FROM that mapping when a CDC tombstone arrives), so a 404 here means the
    // QBO object was deleted after we recorded it. Return a tombstone marker so
    // the base flows into the void path: `mapToNormalized` reads no amount/lines
    // → amount 0 → status "void", reversing the previously-recorded Carbon
    // payment. A first-ever pull that 404s is caught by shouldSync's
    // first-seen-void skip, so nothing is voided that was never recorded.
    if (!remote) {
      return { Id: paymentRemoteId } as QboPayment;
    }
    return remote;
  }

  /** Keyed by the COMPOSITE entity id (the base pull flow keys results by it). */
  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, QboPayment>> {
    const result = new Map<string, QboPayment>();
    for (const entityId of ids) {
      const payment = await this.fetchRemote(entityId);
      if (payment) result.set(entityId, payment);
    }
    return result;
  }

  // =================================================================
  // 2. TIMESTAMP + SHOULD SYNC
  // =================================================================

  protected getRemoteUpdatedAt(remote: QboPayment): Date | null {
    return parseQboDate(remote.MetaData?.LastUpdatedTime);
  }

  protected async shouldSync(
    context: ShouldSyncContext<QboPayment, QboPayment>
  ): Promise<boolean | string> {
    // Push is gated entirely in PaymentSyncerBase.pushToAccounting (origin,
    // documents-mode, single-settlement, FX) — shouldSync only governs the pull.
    const { family, documentRemoteId } = parseQboPaymentSyncEntityId(
      context.entityId
    );

    // Documents-mode gate: inbound payment sync-back is allowed only when the
    // payment's AR/AP family is in `documents` mode (Carbon owns the settled
    // documents). A `journals`/`none` family does not pull payments — a benign
    // skip, like the ownership skip below. An unconfigured integration defaults
    // to documents.
    if (!(await this.isPaymentSyncbackEnabled(family))) {
      return `payment sync-back is disabled: the ${family} family is not in documents mode`;
    }

    // Ownership gate: the pushed document's mapping is the ownership record. No
    // local mapping means the bill/invoice belongs to another Carbon instance
    // or was created directly in QBO — a benign skip, not a failure.
    const docType = family === "ap" ? "bill" : "invoice";
    const localDocId = await this.mappingService.getEntityId(
      this.provider.id,
      documentRemoteId,
      docType
    );
    if (!localDocId) {
      return `QuickBooks Online ${docType} ${documentRemoteId} has no Carbon mapping — the payment belongs to another Carbon instance or to a ${docType} created directly in QuickBooks Online`;
    }

    // A payment first seen as voided (TotalAmt 0) was never recorded — nothing
    // to void. (QBO has no payment status enum; a void zeroes TotalAmt.)
    if (context.isFirstSync && (context.remoteEntity?.TotalAmt ?? 0) === 0) {
      return "Voided QuickBooks Online payment was never recorded in Carbon — nothing to do";
    }

    return true;
  }

  // =================================================================
  // 3. NORMALIZATION (QBO -> family-agnostic NormalizedPayment)
  // =================================================================

  protected mapToNormalized(
    remote: QboPayment,
    entityId: string
  ): NormalizedPayment {
    const { family, documentRemoteId, paymentRemoteId } =
      parseQboPaymentSyncEntityId(entityId);

    const totalAmt = remote.TotalAmt ?? 0;
    const linked = getQboPaymentLinkedDocuments(
      remote,
      family === "ap" ? "Bill" : "Invoice"
    );

    // TotalAmt fallback for a single linked document whose line amount is
    // absent (QBO usually populates line Amount, but be defensive).
    if (linked.length === 1 && linked[0] && linked[0].amount === 0) {
      linked[0].amount = totalAmt;
    }

    // Settlement fan-out only over positive applications; a void (TotalAmt 0,
    // zeroed lines) drops to the documentRemoteId fallback in the core, which
    // resolves the existing payment mapping to reverse it.
    const linkedDocuments = linked.filter((doc) => doc.amount > 0);

    const paidDate = (remote.TxnDate ?? new Date().toISOString()).slice(0, 10);

    return {
      family,
      documentRemoteId,
      paymentRemoteId,
      amount: totalAmt,
      currencyCode: remote.CurrencyRef?.value ?? null,
      exchangeRate: remote.ExchangeRate ?? 1,
      paidDate,
      // The QBO (bill) payment Id is the human/provider reference.
      reference: paymentRemoteId,
      // No status enum on QBO payments; a void zeroes TotalAmt.
      status: totalAmt === 0 ? "void" : "settled",
      ...(linkedDocuments.length > 0 ? { linkedDocuments } : {})
    };
  }

  // =================================================================
  // 4. PUSH (Phase G — Carbon-born payment → QBO Payment / BillPayment)
  // =================================================================

  /**
   * Create one QBO payment document for the settled document. Resolves the
   * settled document's QBO id, the counterparty ref (QBO requires CustomerRef on
   * a Payment / VendorRef on a BillPayment), and the bank account's QBO ref from
   * the mappings. A missing document/counterparty mapping → UNSYNCED_DOCUMENT
   * Warning (sync the dependency first); a missing bank ref → UNMAPPED_ACCOUNTS
   * Warning (map it on the integration settings page). AP → POST /billpayment,
   * AR → POST /payment; each links its `Amount` to the Bill/Invoice via
   * LinkedTxn. Returns the created id + the composite mapping id.
   */
  protected async pushRemotePayment(
    context: PaymentPushContext
  ): Promise<{ remoteId: string; compositeEntityId: string }> {
    const documentRemoteId = await this.mappingService.getExternalId(
      context.family === "ar" ? "invoice" : "bill",
      context.targetDocumentId,
      this.provider.id
    );
    if (!documentRemoteId) {
      throw new JournalEntrySyncError({
        errorCode: "UNSYNCED_DOCUMENT",
        message: `The settled ${
          context.family === "ar" ? "invoice" : "bill"
        } has not synced to QuickBooks Online yet — sync it, then retry the payment`,
        warning: true,
        metadata: { targetDocumentId: context.targetDocumentId }
      });
    }

    const bankRef = (await this.getAccountRefsById()).get(
      context.bankAccountId
    );
    if (!bankRef) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `The payment's bank/cash account is not mapped to a QuickBooks Online account — map it on the integration settings page, then retry`,
        warning: true,
        metadata: { bankAccountId: context.bankAccountId }
      });
    }

    // QBO requires the counterparty ref (CustomerRef on a Payment, VendorRef on
    // a BillPayment); it is NOT inferable from the LinkedTxn alone.
    const counterpartyRef = await this.resolveCounterpartyRef(context);

    if (context.family === "ap") {
      // VERIFY (QBO sandbox): a bank-cleared BillPayment uses PayType "Check"
      // with CheckPayment.BankAccountRef; confirm this is accepted for a plain
      // bank disbursement (vs "CreditCard"/other) and that BankAccountRef takes
      // the Account id value.
      const remoteId = await this.qboProvider.createBillPayment({
        VendorRef: counterpartyRef,
        TotalAmt: context.amount,
        TxnDate: context.paidDate,
        PayType: "Check",
        CheckPayment: { BankAccountRef: bankRef },
        Line: [
          {
            Amount: context.amount,
            LinkedTxn: [{ TxnId: documentRemoteId, TxnType: "Bill" }]
          }
        ]
      });
      return {
        remoteId,
        compositeEntityId: getQboBillPaymentSyncEntityId(
          documentRemoteId,
          remoteId
        )
      };
    }

    // VERIFY (QBO sandbox): a Payment deposits to DepositToAccountRef (the
    // Account id value); confirm the receipt lands in the mapped bank account.
    const remoteId = await this.qboProvider.createPayment({
      CustomerRef: counterpartyRef,
      TotalAmt: context.amount,
      TxnDate: context.paidDate,
      DepositToAccountRef: bankRef,
      Line: [
        {
          Amount: context.amount,
          LinkedTxn: [{ TxnId: documentRemoteId, TxnType: "Invoice" }]
        }
      ]
    });
    return {
      remoteId,
      compositeEntityId: getQboPaymentSyncEntityId(documentRemoteId, remoteId)
    };
  }

  /**
   * Resolve the settled document's counterparty as a QBO ref: the Carbon
   * salesInvoice.customerId (AR) / purchaseInvoice.supplierId (AP), then that
   * entity's QBO mapping. A missing customer/supplier or an unsynced one →
   * UNSYNCED_DOCUMENT Warning (a dependency-ordering issue the operator fixes by
   * syncing the master record).
   */
  private async resolveCounterpartyRef(
    context: PaymentPushContext
  ): Promise<Qbo.Ref> {
    const counterpartyId =
      context.family === "ar"
        ? ((
            await this.database
              .selectFrom("salesInvoice")
              .select("customerId")
              .where("id", "=", context.targetDocumentId)
              .where("companyId", "=", this.companyId)
              .executeTakeFirst()
          )?.customerId ?? null)
        : ((
            await this.database
              .selectFrom("purchaseInvoice")
              .select("supplierId")
              .where("id", "=", context.targetDocumentId)
              .where("companyId", "=", this.companyId)
              .executeTakeFirst()
          )?.supplierId ?? null);

    if (!counterpartyId) {
      throw new JournalEntrySyncError({
        errorCode: "UNSYNCED_DOCUMENT",
        message: `The settled ${
          context.family === "ar" ? "sales invoice" : "purchase invoice"
        } ${context.targetDocumentId} has no ${
          context.family === "ar" ? "customer" : "supplier"
        } — cannot record the payment's counterparty in QuickBooks Online`,
        warning: true,
        metadata: { targetDocumentId: context.targetDocumentId }
      });
    }

    const counterpartyRemoteId = await this.mappingService.getExternalId(
      context.family === "ar" ? "customer" : "vendor",
      counterpartyId,
      this.provider.id
    );
    if (!counterpartyRemoteId) {
      throw new JournalEntrySyncError({
        errorCode: "UNSYNCED_DOCUMENT",
        message: `The payment's ${
          context.family === "ar" ? "customer" : "supplier"
        } has not synced to QuickBooks Online yet — sync it, then retry the payment`,
        warning: true,
        metadata: { counterpartyId }
      });
    }

    return { value: counterpartyRemoteId };
  }
}
