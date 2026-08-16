import { loadAccountCodesById } from "../../../core/account-mapping";
import type { NormalizedPayment } from "../../../core/payment-application";
import {
  type PaymentPushContext,
  PaymentSyncerBase
} from "../../../core/payment-syncer";
import { JournalEntrySyncError } from "../../../core/posting";
import type { ShouldSyncContext } from "../../../core/types";
import { parseDotnetDate, type Xero } from "../models";
import type { XeroProvider } from "../provider";

/**
 * XeroPaymentSyncer — the two-way payment syncer for Xero, on the shared
 * family-agnostic `PaymentSyncerBase`. A Xero `Payment` (on the /Payments
 * endpoint) settles exactly ONE invoice: an ACCPAY invoice (a bill → AP,
 * settling a Carbon purchaseInvoice) or an ACCREC invoice (a sales invoice →
 * AR, settling a Carbon salesInvoice). The base writes a Draft `payment` +
 * `invoiceSettlement` and then invokes the native `post-payment` edge function
 * (GL journal + Posted/Voided status). Two-way as of Phase G: a Carbon-born
 * Posted payment pushes back out as a Xero `/Payments` document (see
 * `pushRemotePayment`).
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

  /** Xero accepts Carbon-born payments back out (Phase G). */
  protected supportsPaymentPush = true;

  /** Carbon account.id → Xero account code, read once per syncer instance. */
  private accountCodesByIdPromise?: Promise<Map<string, string>>;

  private getAccountCodesById(): Promise<Map<string, string>> {
    if (!this.accountCodesByIdPromise) {
      this.accountCodesByIdPromise = loadAccountCodesById(this.database, {
        companyId: this.companyId,
        integration: this.provider.id
      });
    }
    return this.accountCodesByIdPromise;
  }

  /** Xero chart of accounts, read once per syncer instance (BANK-type check). */
  private chartOfAccountsPromise?: Promise<Xero.Account[]>;

  private getChartOfAccounts(): Promise<Xero.Account[]> {
    if (!this.chartOfAccountsPromise) {
      this.chartOfAccountsPromise = this.xeroProvider.listChartOfAccounts();
    }
    return this.chartOfAccountsPromise;
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
    // Push is gated entirely in PaymentSyncerBase.pushToAccounting (origin,
    // documents-mode, single-settlement, FX) — shouldSync only governs the pull.
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

  // =================================================================
  // 4. PUSH (Phase G — Carbon-born payment → Xero /Payments document)
  // =================================================================

  /**
   * Create one Xero payment for the settled invoice. Resolves the settled
   * document's Xero InvoiceID and the bank account's Xero code from the
   * mappings. A missing document mapping → UNSYNCED_DOCUMENT Warning (the
   * invoice/bill must sync first — a dependency-ordering issue, NOT a missing
   * account); a missing bank account code → UNMAPPED_ACCOUNTS Warning (map it on
   * the integration settings page). Xero's /Payments endpoint additionally
   * requires the payment Account to be a BANK-type account with payments
   * enabled — the mapped code is checked against the chart before the PUT so a
   * non-bank code surfaces a fixable Warning instead of an opaque Xero 400. AR
   * (ACCREC) and AP (ACCPAY) both settle through the same /Payments call.
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
        } has not synced to Xero yet — sync it, then retry the payment`,
        warning: true,
        metadata: { targetDocumentId: context.targetDocumentId }
      });
    }

    const bankCode = (await this.getAccountCodesById()).get(
      context.bankAccountId
    );
    if (!bankCode) {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `The payment's bank/cash account is not mapped to a Xero account — map it on the integration settings page, then retry`,
        warning: true,
        metadata: { bankAccountId: context.bankAccountId }
      });
    }

    // Xero /Payments rejects a payment whose Account is not a BANK-type account
    // with payments enabled. Resolve the mapped code against the chart and
    // refuse early with a fixable Warning.
    const bankAccount = (await this.getChartOfAccounts()).find(
      (account) => account.Code === bankCode
    );
    // Xero /Payments requires the Account to be Type BANK. `EnablePaymentsToAccount`
    // is NOT the gate here — it enables NON-bank accounts as payment targets; a
    // BANK account always accepts payments even with the flag false (verified on
    // the Xero sandbox 2026-08-14: a payment posted to a BANK account with
    // EnablePaymentsToAccount=false).
    if (!bankAccount || bankAccount.Type !== "BANK") {
      throw new JournalEntrySyncError({
        errorCode: "UNMAPPED_ACCOUNTS",
        message: `The payment's bank/cash account must map to a Xero BANK-type account (mapped code ${bankCode}). Map it to a Xero bank account on the integration settings page, then retry.`,
        warning: true,
        metadata: { bankAccountId: context.bankAccountId, bankCode }
      });
    }

    const payload = {
      Invoice: { InvoiceID: documentRemoteId },
      Account: { Code: bankCode },
      Amount: context.amount,
      Date: context.paidDate
    };

    const remoteId = await this.xeroProvider.createPayment(payload);

    const compositeEntityId =
      context.family === "ar"
        ? getXeroPaymentSyncEntityId(documentRemoteId, remoteId)
        : getXeroBillPaymentSyncEntityId(documentRemoteId, remoteId);

    return { remoteId, compositeEntityId };
  }
}
