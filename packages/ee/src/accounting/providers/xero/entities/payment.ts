import type { NormalizedPayment } from "../../../core/payment-application";
import { PaymentSyncerBase } from "../../../core/payment-syncer";
import type { ShouldSyncContext } from "../../../core/types";
import { parseDotnetDate, type Xero } from "../models";
import type { XeroProvider } from "../provider";

/**
 * XeroPaymentSyncer — the pull-only payment syncer for Xero, on the shared
 * family-agnostic `PaymentSyncerBase`. A Xero `Payment` (on the /Payments
 * endpoint) settles exactly ONE invoice: an ACCPAY invoice (a bill → AP,
 * settling a Carbon purchaseInvoice) or an ACCREC invoice (a sales invoice →
 * AR, settling a Carbon salesInvoice). The base writes a Draft `payment` +
 * `invoiceSettlement` and then invokes the native `post-payment` edge function
 * (GL journal + Posted/Voided status). Pushing is a rejection stub.
 *
 * Entity-id contract: the sync operation's entityId is a COMPOSITE, identical
 * to the Rillet AP reference. AR keeps the prefix-less
 * `"<invoiceRemoteId>:<paymentRemoteId>"` form; AP uses a
 * `"bill:<invoiceRemoteId>:<paymentRemoteId>"` form. The `bill:` prefix marks
 * AP and is the family discriminator the syncer branches on. The "document" is
 * the settled Xero invoice's `InvoiceID` (mapped under entityType "invoice" for
 * ACCREC / "bill" for ACCPAY). Xero payments settle exactly one invoice, so
 * there is no multi-document fan-out — one `documentRemoteId`/`amount`.
 */

const SYNC_ID_SEPARATOR = ":";
/** AP composite-id family discriminator prefix. AR is prefix-less. */
const BILL_PREFIX = "bill:";

/** Composite sync entity id for a Xero ACCREC (sales invoice) payment — AR. */
export function getXeroPaymentSyncEntityId(
  invoiceRemoteId: string,
  paymentRemoteId: string
): string {
  return `${invoiceRemoteId}${SYNC_ID_SEPARATOR}${paymentRemoteId}`;
}

/** Composite sync entity id for a Xero ACCPAY (bill) payment — AP (`bill:`). */
export function getXeroBillPaymentSyncEntityId(
  invoiceRemoteId: string,
  paymentRemoteId: string
): string {
  return `${BILL_PREFIX}${invoiceRemoteId}${SYNC_ID_SEPARATOR}${paymentRemoteId}`;
}

/**
 * Split a composite payment entity id into its family, document (invoice)
 * remote id, and payment remote id. A `bill:` prefix marks the AP form;
 * anything else is the AR form. Throws on a malformed id.
 */
export function parseXeroPaymentSyncEntityId(entityId: string): {
  family: "ar" | "ap";
  documentRemoteId: string;
  paymentRemoteId: string;
} {
  const isBill = entityId.startsWith(BILL_PREFIX);
  const remainder = isBill ? entityId.slice(BILL_PREFIX.length) : entityId;

  const separatorIndex = remainder.indexOf(SYNC_ID_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) {
    throw new Error(
      `Invalid Xero payment sync entity id "${entityId}" — expected "<invoiceRemoteId>:<paymentRemoteId>" or "bill:<invoiceRemoteId>:<paymentRemoteId>"`
    );
  }
  return {
    family: isBill ? "ap" : "ar",
    documentRemoteId: remainder.slice(0, separatorIndex),
    paymentRemoteId: remainder.slice(separatorIndex + 1)
  };
}

/**
 * Xero's Payment `Date` is usually a plain `YYYY-MM-DD` (sometimes
 * `YYYY-MM-DDT00:00:00`), but be defensive about the serialized .NET
 * `/Date(...)/` form some responses use. Returns the YYYY-MM-DD date part.
 */
export function getXeroPaymentDate(raw: string | undefined): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (raw.startsWith("/Date(")) {
    return parseDotnetDate(raw).toISOString().slice(0, 10);
  }
  return raw.slice(0, 10);
}

export class XeroPaymentSyncer extends PaymentSyncerBase<Xero.Payment> {
  private get xeroProvider(): XeroProvider {
    return this.provider as XeroProvider;
  }

  // =================================================================
  // 1. REMOTE FETCH — composite id → GET /Payments/{PaymentID}
  // =================================================================

  async fetchRemote(entityId: string): Promise<Xero.Payment | null> {
    const { paymentRemoteId } = parseXeroPaymentSyncEntityId(entityId);

    const response = await this.xeroProvider.request<{
      Payments: Xero.Payment[];
    }>("GET", `/Payments/${paymentRemoteId}`);

    if (response.error) return null;
    return response.data?.Payments?.[0] ?? null;
  }

  /**
   * Keyed by the COMPOSITE entity id (the base pull workflow uses the map keys
   * as remote ids, and matches results back to operations by entityId). Xero
   * payments are directly addressable, so each is fetched by its PaymentID.
   */
  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, Xero.Payment>> {
    const result = new Map<string, Xero.Payment>();
    for (const entityId of ids) {
      const payment = await this.fetchRemote(entityId);
      if (payment) result.set(entityId, payment);
    }
    return result;
  }

  // =================================================================
  // 2. TIMESTAMP + SHOULD SYNC
  // =================================================================

  protected getRemoteUpdatedAt(remote: Xero.Payment): Date | null {
    if (!remote.UpdatedDateUTC) return null;
    const parsed = parseDotnetDate(remote.UpdatedDateUTC);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  protected async shouldSync(
    context: ShouldSyncContext<Xero.Payment, Xero.Payment>
  ): Promise<boolean | string> {
    if (context.direction === "push") {
      return "Payments are pull-only for Xero: pushing Carbon payments to Xero is not supported";
    }

    const { family, documentRemoteId } = parseXeroPaymentSyncEntityId(
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

    // Ownership gate: the pushed invoice's mapping is the ownership record. No
    // local mapping means the ACCPAY/ACCREC invoice belongs to another Carbon
    // instance or was created directly in Xero — either way there is no Carbon
    // document to settle here, and that is a benign skip, not a failure. Keyed
    // on "bill" (ACCPAY → purchaseInvoice) / "invoice" (ACCREC → salesInvoice).
    const docEntityType = family === "ap" ? "bill" : "invoice";
    const localDocId = await this.mappingService.getEntityId(
      this.provider.id,
      documentRemoteId,
      docEntityType
    );
    if (!localDocId) {
      return `Xero ${docEntityType} ${documentRemoteId} has no Carbon mapping — the payment belongs to another Carbon instance or to a document created directly in Xero`;
    }

    // A payment first seen as DELETED (void) was never recorded — nothing to
    // void. (The AUTHORISED-only poll filter normally excludes these; guard the
    // webhook/direct-fetch path anyway.)
    if (context.remoteEntity?.Status === "DELETED" && context.isFirstSync) {
      return "Voided (DELETED) Xero payment was never recorded in Carbon — nothing to do";
    }

    return true;
  }

  // =================================================================
  // 3. NORMALIZATION (Xero -> family-agnostic NormalizedPayment)
  // =================================================================

  protected mapToNormalized(
    remote: Xero.Payment,
    entityId: string
  ): NormalizedPayment {
    const { family, documentRemoteId, paymentRemoteId } =
      parseXeroPaymentSyncEntityId(entityId);

    return {
      family,
      documentRemoteId,
      paymentRemoteId,
      amount: remote.Amount ?? 0,
      currencyCode: remote.Invoice?.CurrencyCode ?? null,
      exchangeRate: remote.CurrencyRate ?? 1,
      paidDate: getXeroPaymentDate(remote.Date),
      // The Xero PaymentID is the human/provider reference.
      reference: paymentRemoteId,
      status: remote.Status === "DELETED" ? "void" : "settled"
    };
  }
}
