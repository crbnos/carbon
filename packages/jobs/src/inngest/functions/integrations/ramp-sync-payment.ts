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

export type RampBillPaymentDependencies = {
  companyId: string;
  baseCurrency: string;
  statementBankAccountId: string;
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
    return {
      paymentRowId: result.paymentRowId,
      postAction: result.postAction
    };
  });
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
      const response = await client.functions.invoke("post-payment", {
        body: {
          type: "post",
          paymentId: paymentRowId,
          userId: args.actorId,
          companyId: args.companyId
        }
      });
      return {
        error: Boolean(response.error),
        message:
          (response.data as { message?: string } | undefined)?.message ??
          response.error?.message
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

/** Sync one non-card Ramp bill payment through the resumable payment stager. */
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
  if (CARD_PAYMENT_METHODS.has(method)) {
    return { skip: { id: paymentRampId, referenceId: paymentRampId } };
  }
  if (!BANK_PAYMENT_METHODS.has(method)) {
    return {
      fail: {
        id: paymentRampId,
        message: `Unsupported Ramp bill payment method: ${method || "missing"}`
      }
    };
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
      bankAccount: deps.statementBankAccountId,
      paymentMappingId: paymentRampId,
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
