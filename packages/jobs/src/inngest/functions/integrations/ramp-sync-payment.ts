// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { posting } from "@carbon/api/postings.server";
import type { Database } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  type NormalizedPayment,
  upsertLocalPaymentDraft
} from "@carbon/ee/accounting";
import type { RampBill, RampBillPayment } from "@carbon/ee/ramp.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Kysely, sql } from "kysely";

type PaymentStatus = Database["public"]["Enums"]["paymentStatus"];

type StageResult = {
  paymentRowId: string;
  postAction: "post" | "none";
};

type SyncItem = { id: string; referenceId: string; deepLinkUrl?: string };
type FailItem = { id: string; message: string };
type NormalizedAmount =
  | { ok: true; value: number }
  | { ok: false; error: string };

/** The account a card-paid bill is paid from, or why there is none. */
export type RampCardPaymentAccount = { accountId: string } | { error: string };

export type RampBillPaymentDependencies = {
  companyId: string;
  baseCurrency: string;
  /** Pays a bank-rail bill; null when the integration names none. */
  statementBankAccountId: string | null;
  card: RampCardPaymentAccount;
  db: Kysely<KyselyDatabase>;
  client: SupabaseClient<Database>;
  getMappedInvoiceId: (billRemoteId: string) => Promise<string | null>;
  normalizeAmount: (
    value: unknown,
    currencyCode: string,
    label: string
  ) => Promise<NormalizedAmount>;
  getExchangeRate: (currencyCode: string) => Promise<number>;
  invoiceDeepLinkUrl: (invoiceRowId: string) => string;
};

// ApiBillPayment.payment_method in Ramp's OpenAPI contract (2026-09-11).
const CARD_PAYMENT_METHODS = new Set([
  "CARD",
  "ONE_TIME_CARD",
  "ONE_TIME_CARD_DELIVERY",
  "AUTOMATIC_CARD_PAYMENT"
]);
const BANK_PAYMENT_METHODS = new Set([
  "ACH",
  "CHECK",
  "DIRECT_DEBIT",
  "DOMESTIC_WIRE",
  "FED_NOW",
  "INTERNATIONAL",
  "LOCAL_BANK_TRANSFER",
  "RTP",
  "SWIFT"
]);

/**
 * How a Ramp bill payment is handled: a card payment posts from the card
 * liability account, a verified bank rail from the statement bank account, and
 * anything else fails rather than guessing an offset account.
 */
export function rampBillPaymentRoute(
  method: string | null | undefined
): "card" | "bank" | "unsupported" {
  if (CARD_PAYMENT_METHODS.has(method ?? "")) return "card";
  if (BANK_PAYMENT_METHODS.has(method ?? "")) return "bank";
  return "unsupported";
}

export async function ensureRampPaymentPosted(deps: {
  stage: () => Promise<StageResult>;
  post: (paymentRowId: string) => Promise<{ error: boolean; message?: string }>;
  readStatus: (paymentRowId: string) => Promise<PaymentStatus | null>;
}): Promise<{ paymentRowId: string }> {
  const staged = await deps.stage();
  let postError: string | undefined;
  if (staged.postAction === "post") {
    const posted = await deps.post(staged.paymentRowId);
    if (posted.error) postError = posted.message ?? "Payment posting failed";
  }

  const status = await deps.readStatus(staged.paymentRowId);
  if (status !== "Posted") {
    throw new Error(
      postError ??
        `Payment ${staged.paymentRowId} is ${status ?? "missing"}, not Posted`
    );
  }
  return { paymentRowId: staged.paymentRowId };
}

export type RampPaymentDraft = {
  companyId: string;
  actorId: string;
  bankAccount: string;
  paymentMappingId: string;
  /** A card-paid bill's Ramp transactions, claimed for this payment so the
   *  card charge sync books none of them a second time. */
  cardTransactionIds?: string[];
  /** Exact memo used by the pre-Task-9 non-atomic writer, for safe migration. */
  legacyMemo?: string;
  normalized: NormalizedPayment;
};

export function assertNoLegacyUntrackedPayment(
  hasMapping: boolean,
  legacyPaymentId: string | null
): void {
  if (!hasMapping && legacyPaymentId) {
    throw new Error(
      `Untracked legacy Ramp payment ${legacyPaymentId} requires operator reconciliation before retry`
    );
  }
}

export function preserveStagedPaymentExchangeRate(
  requestedRate: number | null,
  stagedRate: number | null | undefined
): number | null {
  return stagedRate === undefined || stagedRate === null
    ? requestedRate
    : stagedRate;
}

/** Atomically stage the Draft, settlement FX snapshots, and payment mapping. */
export async function stageRampPaymentDraft(
  db: Kysely<KyselyDatabase>,
  args: RampPaymentDraft
): Promise<StageResult> {
  return db.transaction().execute(async (tx) => {
    const mapping = await tx
      .selectFrom("externalIntegrationMapping")
      .select("entityId")
      .where("integration", "=", "ramp")
      .where("entityType", "=", "payment")
      .where("externalId", "=", args.paymentMappingId)
      .where("companyId", "=", args.companyId)
      .executeTakeFirst();
    if (args.legacyMemo) {
      const legacyPayment = mapping
        ? null
        : await tx
            .selectFrom("payment")
            .select("id")
            .where("companyId", "=", args.companyId)
            .where("memo", "=", args.legacyMemo)
            .executeTakeFirst();
      assertNoLegacyUntrackedPayment(
        Boolean(mapping),
        legacyPayment?.id ?? null
      );
    }

    const existingPayment = mapping?.entityId
      ? await tx
          .selectFrom("payment")
          .select("exchangeRate")
          .where("id", "=", mapping.entityId.split(":")[0]!)
          .where("companyId", "=", args.companyId)
          .executeTakeFirst()
      : null;
    const normalized = {
      ...args.normalized,
      exchangeRate: preserveStagedPaymentExchangeRate(
        args.normalized.exchangeRate,
        existingPayment?.exchangeRate
      )
    };

    const result = await upsertLocalPaymentDraft(tx, {
      providerId: "ramp",
      companyId: args.companyId,
      actorId: args.actorId,
      bankAccount: args.bankAccount,
      paymentMappingId: args.paymentMappingId,
      normalized,
      getNextReadableId: async () => {
        const sequence = await sql<{ get_next_sequence: string }>`
          SELECT get_next_sequence('payment', ${args.companyId}) as get_next_sequence
        `.execute(tx);
        return (
          sequence.rows[0]?.get_next_sequence ??
          `PAY-${args.normalized.paymentRemoteId.slice(0, 8)}`
        );
      }
    });
    if (result.postAction === "void") {
      throw new Error("Ramp settlement unexpectedly requested a void");
    }
    if (args.cardTransactionIds?.length) {
      await claimCardTransactions(tx, {
        companyId: args.companyId,
        actorId: args.actorId,
        paymentRowId: result.paymentRowId,
        transactionIds: args.cardTransactionIds
      });
    }
    return {
      paymentRowId: result.paymentRowId,
      postAction: result.postAction
    };
  });
}

/**
 * The claim mapping: a Ramp card transaction that paid a bill, to its payment.
 * A mapping's entity is unique per type, and one payment can claim several
 * transactions, so the entity id is `<payment id>:<transaction id>`.
 */
export const CARD_BILL_PAYMENT_ENTITY = "cardBillPayment";

/** The payment a card-bill-payment claim's entity id names. */
export function claimedPaymentId(entityId: string): string {
  return entityId.split(":")[0]!;
}

/**
 * Claims a card-paid bill's Ramp transactions for its payment, in the staging
 * transaction. A transaction already booked as a live charge is refused: the
 * card would be credited twice. Voiding or deleting the charge is the
 * person's call, so the error names it; the next sync then proceeds.
 */
export async function claimCardTransactions(
  tx: Kysely<KyselyDatabase>,
  args: {
    companyId: string;
    actorId: string;
    paymentRowId: string;
    transactionIds: string[];
  }
): Promise<void> {
  const { companyId, paymentRowId, transactionIds } = args;
  const charges = await tx
    .selectFrom("externalIntegrationMapping as mapping")
    .innerJoin("charge", (join) =>
      join
        .onRef("charge.id", "=", "mapping.entityId")
        .onRef("charge.companyId", "=", "mapping.companyId")
    )
    .select(["mapping.externalId", "charge.chargeId", "charge.status"])
    .where("mapping.companyId", "=", companyId)
    .where("mapping.integration", "=", "ramp")
    .where("mapping.entityType", "=", "charge")
    .where("mapping.externalId", "in", transactionIds)
    .where("charge.status", "!=", "Voided")
    .execute();
  const charge = charges[0];
  if (charge) {
    throw new Error(
      `Ramp transaction ${charge.externalId} is already booked as ${charge.status} charge ${charge.chargeId}. ${
        charge.status === "Draft" ? "Delete" : "Void"
      } that charge, then sync again: the bill payment books the card instead.`
    );
  }

  await tx
    .insertInto("externalIntegrationMapping")
    .values(
      transactionIds.map((externalId) => ({
        entityType: CARD_BILL_PAYMENT_ENTITY,
        entityId: `${paymentRowId}:${externalId}`,
        integration: "ramp",
        externalId,
        companyId,
        createdBy: args.actorId
      }))
    )
    .onConflict((oc) =>
      oc
        .columns(["integration", "externalId", "entityType", "companyId"])
        .where("allowDuplicateExternalId", "=", false)
        .doNothing()
    )
    .execute();
  const claims = await tx
    .selectFrom("externalIntegrationMapping")
    .select(["externalId", "entityId"])
    .where("companyId", "=", companyId)
    .where("integration", "=", "ramp")
    .where("entityType", "=", CARD_BILL_PAYMENT_ENTITY)
    .where("externalId", "in", transactionIds)
    .execute();
  const other = claims.find(
    (claim) => claimedPaymentId(claim.entityId) !== paymentRowId
  );
  if (other) {
    throw new Error(
      `Ramp transaction ${other.externalId} already paid another bill payment`
    );
  }
}

/** Stage/resume, invoke posting, then observe the tenant-scoped final state. */
export async function createOrResumeRampPayment(
  db: Kysely<KyselyDatabase>,
  client: SupabaseClient<Database>,
  args: RampPaymentDraft
): Promise<{ paymentRowId: string }> {
  return ensureRampPaymentPosted({
    stage: () => stageRampPaymentDraft(db, args),
    post: async (paymentRowId) => {
      const response = await posting(
        "post-payment",
        { client, db, companyId: args.companyId, userId: args.actorId },
        {
          type: "post",
          paymentId: paymentRowId
        }
      );
      return {
        error: Boolean(response.error),
        message: response.error?.message
      };
    },
    readStatus: async (paymentRowId) => {
      const payment = await client
        .from("payment")
        .select("status")
        .eq("id", paymentRowId)
        .eq("companyId", args.companyId)
        .maybeSingle();
      if (payment.error) throw payment.error;
      return payment.data?.status ?? null;
    }
  });
}

/** Sync one Ramp bill payment through the resumable payment stager. */
export async function syncRampBillPayment(
  deps: RampBillPaymentDependencies,
  bill: RampBill,
  payment: RampBillPayment
): Promise<{ ok: SyncItem } | { skip: SyncItem } | { fail: FailItem }> {
  const paymentRampId = payment.id;
  if (!paymentRampId) {
    return { fail: { id: bill.id, message: "Bill payment has no id" } };
  }

  const method = payment.payment_method ?? "";
  const route = rampBillPaymentRoute(method);
  if (route === "unsupported") {
    return {
      fail: {
        id: paymentRampId,
        message: `Unsupported Ramp bill payment method: ${method || "missing"}`
      }
    };
  }
  const cardTransactionIds =
    route === "card"
      ? [...new Set(payment.details?.transaction_ids ?? [])]
      : [];
  let bankAccount: string;
  if (route === "card") {
    if ("error" in deps.card) {
      return { fail: { id: paymentRampId, message: deps.card.error } };
    }
    if (cardTransactionIds.length === 0) {
      return {
        fail: {
          id: paymentRampId,
          message: "Ramp has matched no card transaction to this bill payment"
        }
      };
    }
    bankAccount = deps.card.accountId;
  } else {
    if (!deps.statementBankAccountId) {
      return {
        fail: {
          id: paymentRampId,
          message: "Set the Ramp statement bank account to sync bank-paid bills"
        }
      };
    }
    bankAccount = deps.statementBankAccountId;
  }

  const invoiceId = await deps.getMappedInvoiceId(bill.id);
  if (!invoiceId) {
    return {
      fail: {
        id: paymentRampId,
        message: "Bill was never synced to Carbon — sync the bill first"
      }
    };
  }

  const invoice = await deps.client
    .from("purchaseInvoice")
    .select("id, currencyCode, exchangeRate")
    .eq("id", invoiceId)
    .eq("companyId", deps.companyId)
    .maybeSingle();
  if (invoice.error) {
    return { fail: { id: paymentRampId, message: invoice.error.message } };
  }
  if (!invoice.data) {
    return {
      fail: {
        id: paymentRampId,
        message: "The bill's Carbon invoice no longer exists"
      }
    };
  }

  const currencyCode =
    invoice.data.currencyCode ?? bill.currency_code ?? deps.baseCurrency;
  const normalizedAmount = await deps.normalizeAmount(
    payment.amount,
    currencyCode,
    "Bill payment amount"
  );
  if (!normalizedAmount.ok) {
    return { fail: { id: paymentRampId, message: normalizedAmount.error } };
  }
  const paymentDate = (payment.effective_date ?? payment.payment_date)?.slice(
    0,
    10
  );
  if (!paymentDate) {
    return {
      fail: { id: paymentRampId, message: "Bill payment has no usable date" }
    };
  }
  if (invoice.data.exchangeRate === null) {
    return {
      fail: {
        id: paymentRampId,
        message: "Bill invoice has no authoritative exchange-rate snapshot"
      }
    };
  }

  try {
    const paymentExchangeRate = await deps.getExchangeRate(currencyCode);
    const outcome = await createOrResumeRampPayment(deps.db, deps.client, {
      companyId: deps.companyId,
      actorId: "system",
      bankAccount,
      paymentMappingId: paymentRampId,
      cardTransactionIds,
      legacyMemo: `Ramp bill payment ${paymentRampId}`,
      normalized: {
        family: "ap",
        documentRemoteId: bill.id,
        paymentRemoteId: paymentRampId,
        amount: Math.abs(normalizedAmount.value),
        currencyCode,
        exchangeRate: paymentExchangeRate,
        paidDate: paymentDate,
        reference: `Ramp bill payment ${paymentRampId}`,
        status: "settled"
      }
    });
    return {
      ok: {
        id: paymentRampId,
        referenceId: outcome.paymentRowId,
        deepLinkUrl: deps.invoiceDeepLinkUrl(invoiceId)
      }
    };
  } catch (error) {
    return {
      fail: {
        id: paymentRampId,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
