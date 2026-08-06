import type { NormalizedPayment } from "../../../core/payment-application";
import { PaymentSyncerBase } from "../../../core/payment-syncer";
import type { ShouldSyncContext } from "../../../core/types";
import { parseQboDate, type Qbo } from "../models";
import type { QboProvider } from "../provider";

/**
 * QboPaymentSyncer — the first QBO payment syncer, on the shared
 * `PaymentSyncerBase`. QBO `BillPayment` objects settle Carbon purchase
 * invoices (AP); QBO `Payment` objects settle Carbon sales invoices (AR). The
 * base writes a Draft `payment` + `invoiceSettlement` and then invokes the
 * native `post-payment` edge function (GL journal + Posted/Voided status).
 * Pushing is a rejection stub.
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
    if (context.direction === "push") {
      return "Payments are pull-only for QuickBooks Online: pushing Carbon payments to QuickBooks Online is not supported";
    }

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
}
