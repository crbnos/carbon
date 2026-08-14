import type { KyselyTx } from "@carbon/database/client";
import { createMappingService } from "./external-mapping";

/**
 * Family-agnostic payment-application core. Providers normalize their native
 * payment object into a `NormalizedPayment`; `upsertLocalPaymentDraft` writes
 * the Carbon `payment` + `invoiceSettlement` rows as a **Draft** (idempotent by
 * the `payment` external mapping under the composite id). The GL journal and the
 * document-status transitions are NOT written here — the caller (PaymentSyncerBase)
 * invokes the native `post-payment` edge function after commit, which owns the
 * journal + status. This is the shared write path AR (invoice → Receipt) and AP
 * (bill → Disbursement) both funnel through: Carbon's `payment`/`invoiceSettlement`
 * tables are already family-symmetric (discriminated by paymentType + party +
 * settlement target), so a bill payment is the exact mirror of an invoice payment.
 */

/**
 * The provider-neutral shape a payment syncer produces from its native payment
 * object. `documentRemoteId` is the settled invoice/bill remote id (single-doc
 * default); `linkedDocuments` carries the fan-out when one provider payment
 * settles several documents (e.g. a QBO BillPayment paying multiple bills).
 */
export type NormalizedPayment = {
  /** Derived from the settled document: invoice → AR, bill → AP. */
  family: "ar" | "ap";
  /** Settled invoice/bill remote id (the single-document default). */
  documentRemoteId: string;
  /** The provider's payment id. */
  paymentRemoteId: string;
  /** Payment amount in the payment currency. */
  amount: number;
  /** Payment currency (falls back to the document currency when absent). */
  currencyCode: string | null;
  /** Payment → base exchange rate (v1 same-currency paths record 1). */
  exchangeRate: number;
  /** YYYY-MM-DD. */
  paidDate: string;
  /** Human/provider reference stored on the payment. */
  reference: string;
  /**
   * settled = record/settle; failed/void = reverse a previously recorded
   * payment. A first-seen failed payment is skipped upstream by shouldSync.
   */
  status: "settled" | "failed" | "void";
  /**
   * Multi-document fan-out. When present and non-empty, one settlement is
   * written per mapped document; otherwise `documentRemoteId`/`amount` are
   * used as the single linked document.
   */
  linkedDocuments?: { remoteId: string; amount: number }[];
};

/**
 * Invoice status implied by its settled total (cents-accurate). Returns null
 * for "don't touch": a zero/negative settled total says nothing about what the
 * status should be, and a degenerate zero-total invoice is never restated.
 *
 * Kept as a shared export because the payment tests assert its boundaries. The
 * runtime pull path no longer calls it — `post-payment` owns document status
 * (the invoice/bill status is derived in the `salesInvoices`/`purchaseInvoices`
 * views from Posted-payment settlements).
 */
export function getSettledInvoiceStatus(args: {
  invoiceTotal: number;
  settledTotal: number;
}): "Paid" | "Partially Paid" | null {
  const totalCents = Math.round(args.invoiceTotal * 100);
  const settledCents = Math.round(args.settledTotal * 100);

  if (totalCents <= 0 || settledCents <= 0) return null;
  if (settledCents >= totalCents) return "Paid";
  return "Partially Paid";
}

/**
 * Separator in the outbound push's per-settlement `payment` mapping key
 * (`<paymentId>:<targetDocumentId>` — see PaymentSyncerBase.pushToAccounting).
 * The pull anchor splits on it to recover the payment row id; payment ids
 * never contain ":".
 */
export const SETTLEMENT_KEY_SEPARATOR = ":";

/** What the caller should do with `post-payment` after the Draft write commits. */
export type PaymentPostAction = "post" | "void" | "none";

export interface UpsertPaymentDraftArgs {
  /** Provider id (mapping integration key), e.g. "rillet". */
  providerId: string;
  companyId: string;
  /** System user id for createdBy/updatedBy (and the post-payment userId). */
  actorId: string;
  /** accountDefault.bankCashAccount — payment.bankAccount is NOT NULL. */
  bankAccount: string;
  /** The composite sync entity id (`<documentRemoteId>:<paymentRemoteId>`). */
  paymentMappingId: string;
  /** Yields the next readable payment id (get_next_sequence). Called on insert. */
  getNextReadableId: () => Promise<string>;
  normalized: NormalizedPayment;
}

export interface UpsertPaymentDraftResult {
  paymentRowId: string;
  family: "ar" | "ap";
  postAction: PaymentPostAction;
}

/**
 * Write (or reconcile) the Carbon Draft payment + settlements for one pulled
 * provider payment, inside the caller's Kysely transaction. Returns the payment
 * row id and the `post-payment` action the caller should invoke:
 *
 * - settled, no existing / non-Posted payment → write a Draft `payment` +
 *   one `invoiceSettlement` per mapped document → `postAction: "post"`.
 * - settled, existing payment already Posted → idempotent no-op → `"none"`
 *   (avoids re-drafting + double-posting a settled payment).
 * - failed/void, existing Posted payment → leave it Posted → `"void"`
 *   (post-payment's void requires status Posted).
 * - failed/void, existing non-Posted (or already Voided) → `"none"`.
 *
 * Unmapped linked documents are silently dropped (ownership skip); if NONE map,
 * throws — shouldSync should have skipped the change before reaching here.
 */
export async function upsertLocalPaymentDraft(
  tx: KyselyTx,
  args: UpsertPaymentDraftArgs
): Promise<UpsertPaymentDraftResult> {
  const {
    providerId,
    companyId,
    actorId,
    bankAccount,
    paymentMappingId,
    getNextReadableId,
    normalized
  } = args;
  const { family, status } = normalized;
  const mapping = createMappingService(tx, companyId);
  const docEntityType = family === "ar" ? "invoice" : "bill";
  const now = new Date().toISOString();

  // Resolve linked documents (default: the single documentRemoteId).
  const linked =
    normalized.linkedDocuments && normalized.linkedDocuments.length > 0
      ? normalized.linkedDocuments
      : [{ remoteId: normalized.documentRemoteId, amount: normalized.amount }];

  const resolved: { invoiceId: string; amount: number }[] = [];
  let partyId: string | null = null;
  let documentCurrency: string | null = null;

  for (const doc of linked) {
    const localDocId = await mapping.getEntityId(
      providerId,
      doc.remoteId,
      docEntityType
    );
    if (!localDocId) continue; // ownership skip: drop unmapped documents

    if (family === "ar") {
      const invoice = await tx
        .selectFrom("salesInvoice")
        .select(["id", "customerId", "currencyCode"])
        .where("id", "=", localDocId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!invoice) continue;
      partyId ??= invoice.customerId;
      documentCurrency ??= invoice.currencyCode;
      resolved.push({ invoiceId: invoice.id, amount: doc.amount });
    } else {
      const invoice = await tx
        .selectFrom("purchaseInvoice")
        .select(["id", "supplierId", "currencyCode"])
        .where("id", "=", localDocId)
        .where("companyId", "=", companyId)
        .executeTakeFirst();
      if (!invoice) continue;
      partyId ??= invoice.supplierId;
      documentCurrency ??= invoice.currencyCode;
      resolved.push({ invoiceId: invoice.id, amount: doc.amount });
    }
  }

  if (resolved.length === 0) {
    throw new Error(
      `No mapped ${docEntityType} for ${providerId} payment ${normalized.paymentRemoteId} (composite ${paymentMappingId}); the document must be pushed/mapped first`
    );
  }

  // Idempotency anchor: the payment mapping under the composite id.
  const existingMapping = await mapping.getByExternalId(
    providerId,
    paymentMappingId,
    "payment"
  );
  // The mapping's entityId is either a bare payment row id (pull-created, or a
  // single-settlement push) or the multi-settlement push fan-out's
  // `<paymentId>:<targetDocumentId>` key — payment ids never contain ":", so
  // the prefix is always the row id. Without this, pulling back a payment
  // Carbon pushed with several settlements missed the row, re-inserted it, and
  // died on the mapping's unique-externalId constraint.
  const existingPaymentId =
    existingMapping?.entityId?.split(SETTLEMENT_KEY_SEPARATOR)[0] ?? null;
  const existingPayment = existingPaymentId
    ? await tx
        .selectFrom("payment")
        .select(["id", "status"])
        .where("id", "=", existingPaymentId)
        .where("companyId", "=", companyId)
        .executeTakeFirst()
    : null;

  // ---- failed / void ------------------------------------------------------
  if (status !== "settled") {
    if (!existingPayment) {
      throw new Error(
        `${providerId} payment ${normalized.paymentRemoteId} is ${status} but was never recorded in Carbon — nothing to void`
      );
    }
    if (existingPayment.status === "Posted") {
      return { paymentRowId: existingPayment.id, family, postAction: "void" };
    }
    // Draft (never posted) or already Voided → nothing to reverse.
    return { paymentRowId: existingPayment.id, family, postAction: "none" };
  }

  // ---- settled ------------------------------------------------------------
  // An already-Posted payment is left untouched: re-drafting + re-posting would
  // orphan its journal and double-book Carbon's GL. The fast-bailout in the base
  // pull flow means we only get here when the remote genuinely changed.
  if (existingPayment && existingPayment.status === "Posted") {
    return { paymentRowId: existingPayment.id, family, postAction: "none" };
  }

  const paymentType = family === "ar" ? "Receipt" : "Disbursement";
  const currencyCode = normalized.currencyCode ?? documentCurrency ?? undefined;
  if (!currencyCode) {
    throw new Error(
      `Cannot record ${providerId} payment ${normalized.paymentRemoteId}: no currency on the payment or its document`
    );
  }

  let paymentRowId: string;
  if (existingPayment) {
    paymentRowId = existingPayment.id;
    await tx
      .updateTable("payment")
      .set({
        status: "Draft",
        paymentType,
        customerId: family === "ar" ? partyId : null,
        supplierId: family === "ap" ? partyId : null,
        paymentDate: normalized.paidDate,
        postingDate: normalized.paidDate,
        currencyCode,
        exchangeRate: normalized.exchangeRate,
        totalAmount: normalized.amount,
        bankAccount,
        reference: normalized.reference,
        journalId: null,
        postedAt: null,
        postedBy: null,
        voidedAt: null,
        voidedBy: null,
        updatedBy: actorId,
        updatedAt: now
      })
      .where("id", "=", paymentRowId)
      .where("companyId", "=", companyId)
      .execute();
  } else {
    const readableId = await getNextReadableId();
    const inserted = await tx
      .insertInto("payment")
      .values({
        paymentId: readableId,
        paymentType,
        status: "Draft",
        customerId: family === "ar" ? partyId : null,
        supplierId: family === "ap" ? partyId : null,
        paymentDate: normalized.paidDate,
        postingDate: normalized.paidDate,
        currencyCode,
        exchangeRate: normalized.exchangeRate,
        totalAmount: normalized.amount,
        bankAccount,
        reference: normalized.reference,
        companyId,
        createdBy: actorId,
        createdAt: now
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    paymentRowId = inserted.id;

    // Link the payment mapping under the composite id so a later pull finds it.
    // (The base pull flow also links id → composite remoteId; both are the same
    // upsert, so this is idempotent and keeps the write self-contained.)
    await mapping.link("payment", paymentRowId, providerId, paymentMappingId, {
      createdBy: actorId
    });
  }

  // Replace this payment's settlements (one per mapped document). A zero-amount
  // settlement is skipped — invoiceSettlement requires a positive component sum.
  await tx
    .deleteFrom("invoiceSettlement")
    .where("paymentId", "=", paymentRowId)
    .where("companyId", "=", companyId)
    .execute();

  const settlementRows = resolved
    .filter((r) => r.amount > 0)
    .map((r) => ({
      paymentId: paymentRowId,
      ...(family === "ar"
        ? { targetSalesInvoiceId: r.invoiceId }
        : { targetPurchaseInvoiceId: r.invoiceId }),
      appliedAmount: r.amount,
      discountAmount: 0,
      writeOffAmount: 0,
      sourceExchangeRate: normalized.exchangeRate,
      targetExchangeRate: 1,
      appliedDate: normalized.paidDate,
      companyId,
      createdBy: actorId
    }));

  if (settlementRows.length > 0) {
    await tx.insertInto("invoiceSettlement").values(settlementRows).execute();
  }

  return { paymentRowId, family, postAction: "post" };
}
