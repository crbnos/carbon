import type { NormalizedPayment } from "../../../core/payment-application";
import { PaymentSyncerBase } from "../../../core/payment-syncer";
import type { ShouldSyncContext } from "../../../core/types";
import type { Rillet, RilletLocalPayment } from "../models";
import type { RilletProvider } from "../provider";
import { loadCompanyBaseCurrency } from "./shared";

// Re-exported for the payment tests (moved to the family-agnostic core, where
// the runtime document-status boundary now lives — post-payment owns status).
export { getSettledInvoiceStatus } from "../../../core/payment-application";

/**
 * RilletPaymentSyncer — the AR payment syncer for Rillet, on the shared
 * `PaymentSyncerBase`. Rillet invoice payments (recorded against pushed AR_ONLY
 * invoices) settle Carbon sales invoices; the base writes a Draft `payment` +
 * `invoiceSettlement` and then invokes the native `post-payment` edge function
 * (GL journal + Posted/Voided status). Pushing is a rejection stub.
 *
 * Entity-id contract: the sync operation's entityId is a COMPOSITE. AR keeps
 * the prefix-less `"<invoiceRemoteId>:<paymentRemoteId>"` form (back-compat with
 * stored AR mappings); AP uses a `"bill:<billRemoteId>:<billPaymentRemoteId>"`
 * form. Rillet payments are only addressable through their document
 * (GET /invoices/{id}/payments, GET /bills/{id}/payments), and the drain hands
 * syncers nothing but entity ids, so the composite makes the syncer
 * self-sufficient. Mappings under entityType "payment" are stored against the
 * composite id. The `bill:` prefix is also the family discriminator the syncer
 * branches on (and the shape later QBO/Xero payment syncers mirror).
 *
 * v1 simplification (documented): exchange rates are recorded as 1 (Rillet
 * payments settle same-currency AR_ONLY invoices / AP bills).
 */

const SYNC_ID_SEPARATOR = ":";
/** AP composite-id family discriminator prefix. AR is prefix-less. */
const BILL_PREFIX = "bill:";

/** Composite sync entity id for one Rillet invoice payment (AR, prefix-less). */
export function getRilletPaymentSyncEntityId(
  invoiceRemoteId: string,
  paymentRemoteId: string
): string {
  return `${invoiceRemoteId}${SYNC_ID_SEPARATOR}${paymentRemoteId}`;
}

/** Composite sync entity id for one Rillet bill payment (AP, `bill:` prefix). */
export function getRilletBillPaymentSyncEntityId(
  billRemoteId: string,
  billPaymentRemoteId: string
): string {
  return `${BILL_PREFIX}${billRemoteId}${SYNC_ID_SEPARATOR}${billPaymentRemoteId}`;
}

/**
 * Split a composite payment entity id into its family, document remote id, and
 * payment remote id. A `bill:` prefix marks the AP form; anything else is the
 * back-compat AR form. Throws on a malformed id.
 */
export function parseRilletPaymentSyncEntityId(entityId: string): {
  family: "ar" | "ap";
  documentRemoteId: string;
  paymentRemoteId: string;
} {
  const isBill = entityId.startsWith(BILL_PREFIX);
  const remainder = isBill ? entityId.slice(BILL_PREFIX.length) : entityId;

  const separatorIndex = remainder.indexOf(SYNC_ID_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex === remainder.length - 1) {
    throw new Error(
      `Invalid Rillet payment sync entity id "${entityId}" — expected "<invoiceRemoteId>:<paymentRemoteId>" or "bill:<billRemoteId>:<billPaymentRemoteId>"`
    );
  }
  return {
    family: isBill ? "ap" : "ar",
    documentRemoteId: remainder.slice(0, separatorIndex),
    paymentRemoteId: remainder.slice(separatorIndex + 1)
  };
}

/** A payment object carrying the shared amount/currency wire shape. */
type RilletPaymentAmountLike = Rillet.InvoicePayment | Rillet.BillPayment;

/**
 * Numeric amount from either wire shape: the list endpoint's
 * `{ amount: { amount: "100.00", currency } }` or the webhook's flat
 * `amount` + `currency`. Shared by AR invoice payments and AP bill payments.
 */
export function getRilletPaymentAmount(
  remote: RilletPaymentAmountLike
): number {
  const raw = remote.amount;
  if (raw && typeof raw === "object") return Number(raw.amount) || 0;
  if (typeof raw === "string" || typeof raw === "number") {
    return Number(raw) || 0;
  }
  return 0;
}

/** Currency from either wire shape (see getRilletPaymentAmount). */
export function getRilletPaymentCurrency(
  remote: RilletPaymentAmountLike
): string | null {
  if (remote.amount && typeof remote.amount === "object") {
    return remote.amount.currency ?? null;
  }
  return remote.currency ?? null;
}

/**
 * Normalize a Rillet invoice payment onto the local shape. Pure — exported for
 * tests. The invoice id / composite id are completed from the operation's
 * entity id (the list-endpoint invoice_id is carried through when present).
 */
export function mapRilletPaymentToLocal(
  remote: Rillet.InvoicePayment
): Partial<RilletLocalPayment> {
  const date = (
    remote.date ??
    remote.payment_date ??
    remote.updated_at ??
    remote.created_at ??
    new Date().toISOString()
  ).slice(0, 10);

  return {
    paymentRemoteId: remote.id,
    ...(remote.invoice_id ? { invoiceRemoteId: remote.invoice_id } : {}),
    amount: getRilletPaymentAmount(remote),
    currencyCode: getRilletPaymentCurrency(remote),
    date,
    status: remote.status,
    updatedAt: remote.updated_at ?? new Date().toISOString()
  };
}

/** Either Rillet payment wire shape the syncer handles (AR invoice / AP bill). */
type RilletPayment = Rillet.InvoicePayment | Rillet.BillPayment;

export class RilletPaymentSyncer extends PaymentSyncerBase<RilletPayment> {
  private get rilletProvider(): RilletProvider {
    return this.provider as RilletProvider;
  }

  /** company.baseCurrencyCode, read once per syncer instance (FX gate). */
  private baseCurrencyPromise?: Promise<string>;

  private getBaseCurrency(): Promise<string> {
    if (!this.baseCurrencyPromise) {
      this.baseCurrencyPromise = loadCompanyBaseCurrency(
        this.database,
        this.companyId
      );
    }
    return this.baseCurrencyPromise;
  }

  // =================================================================
  // 1. REMOTE FETCH — composite id → list the document's payments
  // =================================================================

  async fetchRemote(entityId: string): Promise<RilletPayment | null> {
    const { family, documentRemoteId, paymentRemoteId } =
      parseRilletPaymentSyncEntityId(entityId);

    const payments =
      family === "ap"
        ? await this.rilletProvider.listBillPayments(documentRemoteId)
        : await this.rilletProvider.listInvoicePayments(documentRemoteId);
    return payments.find((payment) => payment.id === paymentRemoteId) ?? null;
  }

  /**
   * Keyed by the COMPOSITE entity id (the base pull workflow uses the map keys
   * as remote ids, and the drain matches results back to operations by
   * entityId). One listing per distinct document per batch (AR invoices and AP
   * bills share the cache key space via the composite prefix).
   */
  protected async fetchRemoteBatch(
    ids: string[]
  ): Promise<Map<string, RilletPayment>> {
    const result = new Map<string, RilletPayment>();
    const paymentsByDocument = new Map<string, RilletPayment[]>();

    for (const entityId of ids) {
      const { family, documentRemoteId, paymentRemoteId } =
        parseRilletPaymentSyncEntityId(entityId);

      // The family-qualified document id is the cache key, so an AR invoice and
      // an AP bill that happen to share a remote id never collide.
      const cacheKey =
        (family === "ap" ? "bill:" : "invoice:") + documentRemoteId;
      let payments = paymentsByDocument.get(cacheKey);
      if (!payments) {
        payments =
          family === "ap"
            ? await this.rilletProvider.listBillPayments(documentRemoteId)
            : await this.rilletProvider.listInvoicePayments(documentRemoteId);
        paymentsByDocument.set(cacheKey, payments);
      }

      const payment = payments.find((p) => p.id === paymentRemoteId);
      if (payment) result.set(entityId, payment);
    }

    return result;
  }

  // =================================================================
  // 2. TIMESTAMP + SHOULD SYNC
  // =================================================================

  protected getRemoteUpdatedAt(remote: RilletPayment): Date | null {
    if (!remote.updated_at) return null;
    const parsed = new Date(remote.updated_at);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  protected async shouldSync(
    context: ShouldSyncContext<RilletPayment, RilletPayment>
  ): Promise<boolean | string> {
    if (context.direction === "push") {
      return "Payments are pull-only for Rillet: pushing Carbon payments to Rillet is not supported";
    }

    const { family, documentRemoteId } = parseRilletPaymentSyncEntityId(
      context.entityId
    );

    // Documents-mode gate: inbound payment sync-back is allowed only when the
    // payment's AR/AP family is in `documents` mode (Carbon owns the settled
    // documents). A `journals`/`none` family does not pull payments — a benign
    // skip, like the ownership skip below. An unconfigured integration defaults
    // to documents, preserving today's Rillet AR behavior.
    if (!(await this.isPaymentSyncbackEnabled(family))) {
      return `payment sync-back is disabled: the ${family} family is not in documents mode`;
    }

    // Ownership gate: Rillet feeds/webhooks are organization-level and cannot be
    // filtered by subsidiary, so with several Carbon instances writing to one
    // Rillet org (one subsidiary each), every instance receives every payment
    // event. The pushed document's mapping is the ownership record: no local
    // mapping means the invoice/bill belongs to another instance's subsidiary or
    // was created directly in Rillet — either way there is no Carbon document to
    // settle here, and that is a benign skip, not a failure.
    if (family === "ap") {
      const purchaseInvoiceId = await this.mappingService.getEntityId(
        this.provider.id,
        documentRemoteId,
        "bill"
      );
      if (!purchaseInvoiceId) {
        return `Rillet bill ${documentRemoteId} has no Carbon mapping — the payment belongs to another Carbon instance's subsidiary or to a bill created directly in Rillet`;
      }
    } else {
      const salesInvoiceId = await this.mappingService.getEntityId(
        this.provider.id,
        documentRemoteId,
        "invoice"
      );
      if (!salesInvoiceId) {
        return `Rillet invoice ${documentRemoteId} has no Carbon mapping — the payment belongs to another Carbon instance's subsidiary or to an invoice created directly in Rillet`;
      }
    }

    // A payment first seen as FAILED was never recorded — nothing to void.
    if (context.remoteEntity?.status === "FAILED" && context.isFirstSync) {
      return "Failed Rillet payment was never recorded in Carbon — nothing to do";
    }

    // FX gate: mapToNormalized hardcodes exchangeRate 1 (a documented v1
    // same-currency simplification), which would silently mis-state a
    // cross-currency settlement. Park (skip with reason) any payment whose
    // currency differs from the company base currency; a same-currency or
    // currency-less payment proceeds unchanged.
    const paymentCurrency = context.remoteEntity
      ? getRilletPaymentCurrency(context.remoteEntity)
      : null;
    if (paymentCurrency) {
      const baseCurrency = await this.getBaseCurrency();
      if (paymentCurrency !== baseCurrency) {
        return `FX payment (${paymentCurrency} ≠ base ${baseCurrency}) — not supported v1`;
      }
    }

    return true;
  }

  // =================================================================
  // 3. NORMALIZATION (Rillet -> family-agnostic NormalizedPayment)
  // =================================================================

  protected mapToNormalized(
    remote: RilletPayment,
    entityId: string
  ): NormalizedPayment {
    const { family, documentRemoteId, paymentRemoteId } =
      parseRilletPaymentSyncEntityId(entityId);

    if (family === "ap") {
      const bill = remote as Rillet.BillPayment;
      const paidDate = (
        bill.date ??
        bill.payment_date ??
        bill.updated_at ??
        bill.created_at ??
        new Date().toISOString()
      ).slice(0, 10);

      return {
        family: "ap",
        documentRemoteId,
        paymentRemoteId,
        amount: getRilletPaymentAmount(bill),
        currencyCode: getRilletPaymentCurrency(bill),
        exchangeRate: 1,
        paidDate,
        // The Rillet bill-payment id is the human/provider reference.
        reference: paymentRemoteId,
        status: bill.status === "FAILED" ? "failed" : "settled"
      };
    }

    const local = mapRilletPaymentToLocal(remote as Rillet.InvoicePayment);

    return {
      family: "ar",
      documentRemoteId,
      paymentRemoteId,
      amount: local.amount ?? 0,
      currencyCode: local.currencyCode ?? null,
      exchangeRate: 1,
      paidDate: local.date ?? new Date().toISOString().slice(0, 10),
      reference: paymentRemoteId,
      status:
        (remote as Rillet.InvoicePayment).status === "FAILED"
          ? "failed"
          : "settled"
    };
  }
}
