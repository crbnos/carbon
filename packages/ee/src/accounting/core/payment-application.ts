import type { KyselyTx } from "@carbon/database/client";
import {
  assertExchangeRate,
  calculateSettlementFx,
  round,
  toBaseAmount,
  toDocumentAmount
} from "@carbon/utils";
import { now as currentTime } from "@internationalized/date";
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
  /** Foreign per base rate; null means omitted by the provider, resolved from authoritative currencies. */
  exchangeRate: number | null;
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
  const now = currentTime("UTC").toAbsoluteString();

  // Resolve linked documents (default: the single documentRemoteId).
  const linked =
    normalized.linkedDocuments && normalized.linkedDocuments.length > 0
      ? normalized.linkedDocuments
      : [{ remoteId: normalized.documentRemoteId, amount: normalized.amount }];

  const mappings = await tx
    .selectFrom("externalIntegrationMapping")
    .select(["entityId", "externalId"])
    .where("integration", "=", providerId)
    .where("entityType", "=", docEntityType)
    .where(
      "externalId",
      "in",
      linked.map((doc) => doc.remoteId)
    )
    .where("companyId", "=", companyId)
    .execute();
  const idByRemote = new Map<string, string>();
  for (const row of mappings) {
    if (!row.externalId || !row.entityId)
      throw new Error("Invalid provider document mapping");
    if (idByRemote.has(row.externalId))
      throw new Error("Ambiguous provider document mapping");
    idByRemote.set(row.externalId, row.entityId);
  }
  const ids = [...new Set(mappings.map((row) => row.entityId))];
  const [company, invoices] = await Promise.all([
    tx
      .selectFrom("company")
      .select(["baseCurrencyCode", "companyGroupId"])
      .where("id", "=", companyId)
      .executeTakeFirst(),
    ids.length === 0
      ? Promise.resolve([])
      : family === "ar"
        ? tx
            .selectFrom("salesInvoices")
            .select([
              "id",
              "customerId as partyId",
              "currencyCode",
              "exchangeRate",
              "totalAmount",
              "balance"
            ])
            .where("id", "in", ids)
            .where("companyId", "=", companyId)
            .execute()
        : tx
            .selectFrom("purchaseInvoices")
            .select([
              "id",
              "supplierId as partyId",
              "currencyCode",
              "exchangeRate",
              "totalAmount",
              "balance"
            ])
            .where("id", "in", ids)
            .where("companyId", "=", companyId)
            .execute()
  ]);
  const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const resolved: {
    invoiceId: string;
    amount: number;
    exchangeRate: number;
    totalAmount: number;
    balance: number;
  }[] = [];
  let partyId: string | null = null;
  let documentCurrency: string | null = null;
  const resolvedIds = new Set<string>();
  for (const doc of linked) {
    const invoiceId = idByRemote.get(doc.remoteId);
    if (!invoiceId) continue; // Only genuinely unmapped provider documents are ownership skips.
    if (resolvedIds.has(invoiceId))
      throw new Error("Duplicate provider payment document application");
    resolvedIds.add(invoiceId);
    const invoice = invoiceById.get(invoiceId);
    if (!invoice?.partyId || !invoice.currencyCode)
      throw new Error(
        `Mapped ${docEntityType} ${invoiceId} is missing or has invalid company/party/currency metadata`
      );
    const rate = Number(invoice.exchangeRate);
    assertExchangeRate(rate);
    if (invoice.currencyCode === company?.baseCurrencyCode && rate !== 1)
      throw new Error("Base-currency document requires identity exchange rate");
    if (partyId && partyId !== invoice.partyId)
      throw new Error("Payment links documents for different parties");
    if (documentCurrency && documentCurrency !== invoice.currencyCode)
      throw new Error("Payment links unsupported document currency pair");
    partyId = invoice.partyId;
    documentCurrency = invoice.currencyCode;
    if (
      !Number.isFinite(doc.amount) ||
      doc.amount < 0 ||
      !Number.isFinite(Number(invoice.totalAmount)) ||
      !Number.isFinite(Number(invoice.balance))
    )
      throw new Error("Payment/document amount must be finite and nonnegative");
    resolved.push({
      invoiceId,
      amount: doc.amount,
      exchangeRate: rate,
      totalAmount: Number(invoice.totalAmount),
      balance: Number(invoice.balance)
    });
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
  const currencyCode = normalized.currencyCode ?? documentCurrency;
  if (
    !company?.baseCurrencyCode ||
    !company.companyGroupId ||
    !currencyCode ||
    currencyCode !== documentCurrency
  )
    throw new Error("Unsupported payment/document currency pair");
  const exchangeRate =
    normalized.exchangeRate ??
    (currencyCode === company.baseCurrencyCode ? 1 : null);
  if (exchangeRate === null)
    throw new Error("Foreign-currency payment exchange rate is required");
  assertExchangeRate(exchangeRate);
  if (currencyCode === company.baseCurrencyCode && exchangeRate !== 1)
    throw new Error("Base-currency payment requires identity exchange rate");
  const currency = await tx
    .selectFrom("currency")
    .select("decimalPlaces")
    .where("code", "=", currencyCode)
    .where("companyGroupId", "=", company.companyGroupId)
    .executeTakeFirst();
  if (!currency || currency.decimalPlaces == null)
    throw new Error("Payment currency precision is required");
  const decimalPlaces = currency.decimalPlaces;
  if (
    !Number.isFinite(normalized.amount) ||
    normalized.amount <= 0 ||
    toDocumentAmount(normalized.amount, 1, decimalPlaces) !== normalized.amount
  )
    throw new Error(
      "Payment total must be positive in document currency precision"
    );
  let resolvedTotal = 0;
  for (const doc of resolved) {
    if (
      toDocumentAmount(doc.amount, 1, decimalPlaces) !== doc.amount ||
      doc.amount >
        toDocumentAmount(
          Math.min(doc.totalAmount, doc.balance),
          doc.exchangeRate,
          decimalPlaces
        )
    )
      throw new Error(
        "Payment principal exceeds invoice balance or document precision"
      );
    resolvedTotal += doc.amount;
  }
  if (round(resolvedTotal, decimalPlaces) > normalized.amount)
    throw new Error("Linked principal exceeds payment total");

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
        exchangeRate,
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
        exchangeRate,
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
      appliedAmount: toBaseAmount(r.amount, r.exchangeRate),
      sourceAmount: r.amount,
      sourcePaymentId: null,
      fxGainLossAmount: calculateSettlementFx({
        appliedAmount: toBaseAmount(r.amount, r.exchangeRate),
        sourceAmount: r.amount,
        sourceExchangeRate: exchangeRate,
        isAR: family === "ar"
      }),
      discountAmount: 0,
      writeOffAmount: 0,
      sourceExchangeRate: exchangeRate,
      targetExchangeRate: r.exchangeRate,
      appliedDate: normalized.paidDate,
      companyId,
      createdBy: actorId
    }));

  if (settlementRows.length > 0) {
    await tx.insertInto("invoiceSettlement").values(settlementRows).execute();
  }

  return { paymentRowId, family, postAction: "post" };
}
