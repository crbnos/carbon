/**
 * Stripe Connect payment recording — shared between the webhook handler in the
 * ERP app and the pull sweep in the jobs package. Kept in @carbon/ee so both
 * callers can import it without crossing the app→package dependency boundary.
 */
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyTimeZone } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import {
  getPostgresClient,
  getPostgresConnectionPool
} from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import type { ConnectInvoice } from "@carbon/stripe/connect.server";
import {
  fromStripeAmount,
  getConnectInvoicePaymentDetails,
  toStripeAmount
} from "@carbon/stripe/connect.server";
import { datetime } from "@carbon/utils";
import { fromAbsolute, toCalendarDate } from "@internationalized/date";
import { PostgresDriver, sql } from "kysely";
import { createMappingService } from "../accounting/index";

const logger = getLogger("ee", "stripe-connect", "payments");

const INTEGRATION = "stripe-connect";
const SYSTEM_USER = "system";

// Module-level Kysely pool — one connection is enough; we only use it for the
// replaceInvoiceSettlements transaction path.
const _pool = getPostgresConnectionPool(1);
const _db = getPostgresClient<KyselyDatabase>(_pool, PostgresDriver);

export type StripeConnectPaymentResult =
  | { status: "recorded"; paymentId: string }
  | { status: "skipped"; reason: string };

export type StripeConnectVoidResult =
  | { status: "voided"; paymentIds: string[] }
  | { status: "skipped"; reason: string };

/**
 * Record a Stripe Connect invoice payment against its originating Carbon sales
 * invoice: create a Receipt payment for the amount collected, settle it
 * against the invoice, and post it. Stripe's processing fee — withheld before
 * the payout ever reaches the bank — rides along in the SAME journal entry
 * `post-payment` builds: the bank line carries the net deposit and a fee
 * expense line makes up the difference, so there is one entry per payment
 * instead of a payment entry plus a follow-up fee entry.
 *
 * Idempotent on the Stripe invoice id, but NOT limited to one payment per
 * invoice: `amount_paid` on a Stripe invoice is cumulative, and Stripe can
 * report it growing across multiple webhook deliveries for the same invoice
 * (installment / partial-payment invoices). Each delivery reconciles against
 * every payment already mapped to this invoice
 * (`externalIntegrationMapping`, `allowDuplicateExternalId: true` for the
 * second and later payments) and:
 *   - resumes a stranded `Draft` payment (a prior delivery that inserted the
 *     payment + mapping but crashed before settlement/posting completed) at
 *     its ALREADY-RECORDED amount, rather than re-deriving anything from
 *     Stripe — a resume completes an interrupted write, it is not a new delta;
 *   - otherwise records a NEW payment for just the delta between the
 *     invoice's current `amount_paid` and what's already been recorded, with
 *     the processing fee prorated to that delta's share of the total.
 *
 * Throws on *fixable* configuration problems (missing bank account, missing
 * service-charge account, missing sequence) so the caller returns non-2xx and
 * Stripe retries once the admin has corrected it. Returns `skipped` for
 * anything a retry could never fix, and for "nothing new to record".
 */
export async function recordStripeConnectPayment({
  companyId,
  stripeAccountId,
  integrationMetadata,
  stripeInvoice
}: {
  companyId: string;
  stripeAccountId: string;
  integrationMetadata: Record<string, unknown>;
  stripeInvoice: ConnectInvoice;
}): Promise<StripeConnectPaymentResult> {
  const serviceRole = getCarbonServiceRole();
  const mappingService = createMappingService(_db, companyId);

  const stripeInvoiceId = stripeInvoice.id;
  if (!stripeInvoiceId) {
    return { status: "skipped", reason: "Stripe invoice has no id" };
  }

  // Every payment ever recorded against this Stripe invoice — normally zero
  // (first delivery) or one (fully paid), but installment/partial-payment
  // invoices can have several once a later delivery reports a higher
  // amount_paid than what's already been recorded.
  const existingMappings = await mappingService.getAllByExternalId(
    INTEGRATION,
    stripeInvoiceId,
    "payment"
  );

  // The send path stamps `carbonInvoiceId` on the Stripe invoice; the mapping
  // table is the fallback for invoices sent before that, or if metadata is lost.
  const carbonInvoiceId =
    (stripeInvoice.metadata?.carbonInvoiceId as string | undefined) ??
    (await mappingService.getEntityId(
      INTEGRATION,
      stripeInvoiceId,
      "salesInvoice"
    ));

  if (!carbonInvoiceId) {
    return {
      status: "skipped",
      reason: `No Carbon sales invoice is linked to Stripe invoice ${stripeInvoiceId}`
    };
  }

  const salesInvoice = await serviceRole
    .from("salesInvoices")
    .select("*")
    .eq("id", carbonInvoiceId)
    .single();

  if (salesInvoice.error || !salesInvoice.data) {
    return {
      status: "skipped",
      reason: `Carbon sales invoice ${carbonInvoiceId} could not be loaded`
    };
  }

  // The mapping and the metadata are both company-scoped already, but the
  // invoice is fetched by id alone — re-assert the tenant before writing cash.
  if (salesInvoice.data.companyId !== companyId) {
    throw new Error(
      `Sales invoice ${carbonInvoiceId} belongs to a different company than the Stripe account that reported the payment`
    );
  }

  const currencyCode = (
    salesInvoice.data.currencyCode ??
    stripeInvoice.currency ??
    "USD"
  ).toUpperCase();

  const amountPaid = fromStripeAmount(stripeInvoice.amount_paid, currencyCode);
  if (amountPaid <= 0) {
    return {
      status: "skipped",
      reason: `Stripe invoice ${stripeInvoiceId} reported no amount paid`
    };
  }

  const customerId =
    salesInvoice.data.invoiceCustomerId ?? salesInvoice.data.customerId;
  if (!customerId) {
    return {
      status: "skipped",
      reason: `Sales invoice ${carbonInvoiceId} has no customer to credit`
    };
  }

  // Reconcile this delivery against every payment already recorded for this
  // invoice: resume a stranded Draft, or compute the unrecorded delta.
  type ExistingMapping = (typeof existingMappings)[number];
  let resume: {
    paymentId: string;
    mapping: ExistingMapping;
    totalAmount: number;
  } | null = null;
  let recordedTotal = 0;

  if (existingMappings.length > 0) {
    const paymentIds = existingMappings.map((m) => m.entityId);
    const existingPayments = await serviceRole
      .from("payment")
      .select("id, status, totalAmount")
      .in("id", paymentIds)
      .eq("companyId", companyId);

    if (existingPayments.error) {
      return {
        status: "skipped",
        reason: `Could not verify prior Stripe Connect payments recorded for invoice ${stripeInvoiceId}`
      };
    }

    const paymentById = new Map(
      (existingPayments.data ?? []).map((p) => [p.id, p])
    );

    for (const mapping of existingMappings) {
      const payment = paymentById.get(mapping.entityId);
      if (!payment) continue; // orphaned mapping — ignore, don't block

      if (payment.status === "Draft") {
        // A prior delivery inserted the payment + mapping but crashed before
        // settlement/posting completed. Resume THAT attempt at its own
        // recorded amount — read off the payment row itself (not the mapping
        // metadata's amountRecorded, which didn't exist before this fix and
        // would read as 0 for a Draft stranded prior to it) — rather than
        // treating this as a fresh delta.
        resume = {
          paymentId: mapping.entityId,
          mapping,
          totalAmount: Number(payment.totalAmount ?? 0)
        };
        break;
      }

      if (payment.status !== "Voided") {
        recordedTotal += Number(payment.totalAmount ?? 0);
      }
    }
  }

  const accountDefaults = await serviceRole
    .from("accountDefault")
    .select("bankCashAccount, serviceChargeAccount")
    .eq("companyId", companyId)
    .single();

  const timezone = await getCompanyTimeZone(serviceRole, companyId);
  const paidAt = stripeInvoice.status_transitions?.paid_at;
  const paymentDate = (
    paidAt
      ? toCalendarDate(fromAbsolute(paidAt * 1000, timezone))
      : datetime.today(timezone)
  ).toString();

  let paymentId: string;
  let amountToRecord: number;
  // The realized rate the cash actually moved at, when Stripe converted it —
  // falls back to the invoice's own booked rate below (item 5/FX).
  let realizedExchangeRate: number | null = null;
  let journalFee:
    | { amount: number; accountId: string; description: string }
    | undefined;

  if (resume) {
    // Resume: reuse exactly what the interrupted attempt already captured —
    // do not re-derive anything from Stripe, this completes a write, it does
    // not start a new one.
    paymentId = resume.paymentId;
    amountToRecord = resume.totalAmount;
    const meta = (resume.mapping.metadata ?? {}) as Record<string, unknown>;
    realizedExchangeRate = (meta.exchangeRate as number | null) ?? null;

    const feeAmount = Number(meta.feeAmount ?? 0);
    const feeCurrency = (meta.feeCurrency as string | null) ?? null;
    if (feeAmount > 0 && feeCurrency === currencyCode) {
      const companySettings = await serviceRole
        .from("companySettings")
        .select("accountingEnabled")
        .eq("id", companyId)
        .single();

      if (companySettings.data?.accountingEnabled) {
        const feeAccount =
          (integrationMetadata.paymentFeeAccount as string | undefined) ||
          accountDefaults.data?.serviceChargeAccount;
        if (!feeAccount) {
          throw new Error(
            "No service charge account is configured for Stripe processing fees (set accountDefault.serviceChargeAccount or the integration's paymentFeeAccount)"
          );
        }
        journalFee = {
          amount: feeAmount,
          accountId: feeAccount,
          description: `Stripe processing fee — ${stripeInvoice.number ?? stripeInvoiceId}`
        };
      }
    }
  } else {
    // Round through Stripe's own minor-unit conversion (the same one
    // `amountPaid`/`recordedTotal` already went through) rather than the
    // internal SCALE=5 default — this is a settlement value, and it must
    // land on the currency's own decimal places, not a finer one.
    const delta = fromStripeAmount(
      toStripeAmount(amountPaid - recordedTotal, currencyCode),
      currencyCode
    );
    if (delta <= 0) {
      return {
        status: "skipped",
        reason: `Stripe invoice ${stripeInvoiceId} has no new amount to record (already recorded ${recordedTotal} of ${amountPaid})`
      };
    }
    amountToRecord = delta;
    const isTopUp = recordedTotal > 0;

    const bankAccount =
      (integrationMetadata.paymentBankAccount as string | undefined) ||
      accountDefaults.data?.bankCashAccount;
    if (!bankAccount) {
      throw new Error(
        "No bank account is configured for Stripe Connect receipts (set accountDefault.bankCashAccount or the integration's paymentBankAccount)"
      );
    }

    // Resolved BEFORE the payment is created (like bankAccount above) so a
    // missing service-charge account throws before any row is written — a
    // retry after the admin fixes it starts clean instead of leaving behind an
    // orphaned Draft payment. Gated on accountingEnabled: `post-payment` only
    // ever builds a GL journal (fee included) when accounting is on, so a
    // company that hasn't configured a service-charge account because they
    // don't use Carbon's accounting at all must not have Stripe payments
    // start failing over it.
    const feeDetails = await getConnectInvoicePaymentDetails(
      stripeAccountId,
      stripeInvoiceId
    );
    realizedExchangeRate = feeDetails.exchangeRate;

    // Prorate the fee to this delta's share of the invoice's total collected
    // — feeDetails.feeAmount is the CUMULATIVE fee across every charge behind
    // the invoice, and on a top-up delivery only a slice of it is new.
    const feeAmount = isTopUp
      ? fromStripeAmount(
          toStripeAmount(
            (feeDetails.feeAmount * delta) / amountPaid,
            currencyCode
          ),
          currencyCode
        )
      : feeDetails.feeAmount;

    if (feeAmount > 0) {
      // Fees are assessed in the account's settlement currency, which needn't be
      // the invoice currency. getConnectInvoicePaymentDetails already converts
      // the fee back into the charge's own currency using Stripe's own
      // balance-transaction exchange rate whenever one was available, so
      // feeCurrency matches the invoice currency in the normal case. The only
      // residual mismatch is the rare case where Stripe settled into a
      // different currency with no rate to convert by — that's not a
      // fixable-by-retry problem, so it warns and leaves it to manual
      // reconciliation rather than throwing.
      if (feeDetails.feeCurrency && feeDetails.feeCurrency !== currencyCode) {
        logger.warn(
          "Skipping Stripe fee journal line — no exchange rate was available to convert the fee into the invoice currency",
          {
            companyId,
            stripeInvoiceId,
            feeCurrency: feeDetails.feeCurrency,
            settlementCurrency: feeDetails.settlementCurrency,
            currencyCode
          }
        );
      } else {
        const companySettings = await serviceRole
          .from("companySettings")
          .select("accountingEnabled")
          .eq("id", companyId)
          .single();

        if (companySettings.data?.accountingEnabled) {
          const feeAccount =
            (integrationMetadata.paymentFeeAccount as string | undefined) ||
            accountDefaults.data?.serviceChargeAccount;
          if (!feeAccount) {
            throw new Error(
              "No service charge account is configured for Stripe processing fees (set accountDefault.serviceChargeAccount or the integration's paymentFeeAccount)"
            );
          }
          journalFee = {
            amount: feeAmount,
            accountId: feeAccount,
            description: `Stripe processing fee — ${stripeInvoice.number ?? stripeInvoiceId}`
          };
        }
      }
    }

    const nextSeq = await serviceRole.rpc("get_next_sequence", {
      sequence_name: "payment",
      company_id: companyId
    });
    if (nextSeq.error || !nextSeq.data) {
      throw new Error("Failed to allocate a payment id for the Stripe payment");
    }

    const insert = await serviceRole
      .from("payment")
      .insert([
        {
          paymentId: nextSeq.data,
          paymentType: "Receipt" as const,
          customerId,
          paymentDate,
          currencyCode,
          exchangeRate:
            realizedExchangeRate ??
            (Number(salesInvoice.data.exchangeRate ?? 1) || 1),
          totalAmount: amountToRecord,
          bankAccount,
          reference: stripeInvoice.number ?? stripeInvoiceId,
          memo: `Stripe payment for ${salesInvoice.data.invoiceId ?? carbonInvoiceId}`,
          companyId,
          createdBy: SYSTEM_USER
        }
      ])
      .select("id, paymentId")
      .single();

    if (insert.error || !insert.data) {
      throw new Error(
        `Failed to create the Carbon payment for Stripe invoice ${stripeInvoiceId}`
      );
    }

    paymentId = insert.data.id;
    const mappingMetadata: Record<string, unknown> = {
      stripeInvoiceId,
      stripeAccountId,
      chargeIds: feeDetails.chargeIds,
      feeAmount,
      feeCurrency: feeDetails.feeCurrency,
      settlementCurrency: feeDetails.settlementCurrency,
      exchangeRate: realizedExchangeRate,
      amountRecorded: amountToRecord,
      // The invoice's cumulative amount_paid at the moment THIS row was
      // linked — the running total the next delivery's delta is computed
      // against (recordedTotal above sums payment.totalAmount, which is
      // independent of this and would work alone, but the snapshot makes the
      // reconciliation auditable from the mapping row itself).
      amountPaidAtRecording: amountPaid
    };

    // Claim the Stripe invoice for this payment BEFORE settling or posting.
    // A duplicate delivery racing us fails the unique index here (when this
    // is the first payment for the invoice), while the payment it created is
    // still an unsettled Draft that can be rolled back. Later top-up
    // payments deliberately allow duplicates — that's the whole point.
    try {
      await mappingService.link(
        "payment",
        paymentId,
        INTEGRATION,
        stripeInvoiceId,
        {
          metadata: mappingMetadata,
          createdBy: SYSTEM_USER,
          allowDuplicateExternalId: isTopUp
        }
      );
    } catch (err) {
      await serviceRole.from("payment").delete().eq("id", paymentId);
      if ((err as { code?: string }).code === "23505") {
        return {
          status: "skipped",
          reason: `Stripe invoice ${stripeInvoiceId} was recorded concurrently by another delivery`
        };
      }
      throw err;
    }
  }

  // Settle against the invoice's open balance. Cash beyond it stays unapplied
  // and becomes on-account credit — `post-payment` already handles that.
  const openBalance = Number(salesInvoice.data.balance ?? 0);
  const appliedAmount = Math.min(amountToRecord, openBalance);
  const targetExchangeRate = Number(salesInvoice.data.exchangeRate ?? 1) || 1;
  // The rate the cash actually moved at — falls back to the invoice's own
  // booked rate when Stripe didn't need to convert (same-currency
  // settlement), which keeps totalFxImpact correctly at 0 in that case.
  const sourceExchangeRate = realizedExchangeRate ?? targetExchangeRate;

  if (appliedAmount > 0) {
    try {
      await _db.transaction().execute(async (trx) => {
        const payment = await trx
          .selectFrom("payment")
          .select(["id", "status", "paymentType", "customerId", "supplierId"])
          .where("id", "=", paymentId)
          .where("companyId", "=", companyId)
          .forUpdate()
          .executeTakeFirst();

        if (!payment) throw new Error("Payment not found");
        if (payment.status !== "Draft") {
          throw new Error(
            "Applications can only be edited while the payment is Draft"
          );
        }

        await trx
          .deleteFrom("invoiceSettlement")
          .where("paymentId", "=", paymentId)
          .execute();

        // Verify the invoice belongs to the same customer as the payment —
        // Kysely bypasses RLS so this is the only enforcement boundary.
        const invoice = await trx
          .selectFrom("salesInvoice")
          .select(["id", "customerId"])
          .where("id", "=", carbonInvoiceId)
          .where("companyId", "=", companyId)
          .executeTakeFirst();

        if (!invoice) throw new Error("Sales invoice not found for settlement");
        if (invoice.customerId !== payment.customerId) {
          throw new Error(
            "Settlement target customer does not match payment customer"
          );
        }

        await trx
          .insertInto("invoiceSettlement")
          .values({
            paymentId,
            targetSalesInvoiceId: carbonInvoiceId,
            targetPurchaseInvoiceId: null,
            appliedAmount,
            discountAmount: 0,
            writeOffAmount: 0,
            targetExchangeRate,
            sourceExchangeRate,
            appliedDate: paymentDate,
            companyId,
            createdBy: SYSTEM_USER
          })
          .execute();
      });
    } catch (err) {
      // The payment (and, for a fresh record, its mapping) already exist —
      // only the settlement failed. Leave the Draft in place: it's resumable
      // by the next delivery (webhook retry, or the pull sweep) via the
      // `resume` path above, instead of being stranded forever behind the
      // "already recorded" mapping check.
      logger.error("Failed to settle the Stripe Connect payment", {
        error: err,
        companyId,
        paymentId,
        stripeInvoiceId
      });
      return { status: "recorded", paymentId };
    }
  } else {
    logger.warn(
      "Stripe payment has no open invoice balance to settle; recording it as on-account credit",
      { companyId, carbonInvoiceId, paymentId }
    );
  }

  const posted = await serviceRole.functions.invoke("post-payment", {
    body: {
      type: "post",
      paymentId,
      userId: SYSTEM_USER,
      companyId,
      fee: journalFee
    }
  });

  if (posted.error) {
    // The payment and its settlement are correct — only the posting failed, so
    // leave the Draft in place for a human (or the next delivery's resume
    // path) to post rather than losing the record.
    logger.error("Failed to post the Stripe Connect payment", {
      error: posted.error,
      companyId,
      paymentId,
      stripeInvoiceId
    });
    return { status: "recorded", paymentId };
  }

  return { status: "recorded", paymentId };
}

/**
 * Resolve the Stripe invoice id behind a charge, from Carbon's OWN recorded
 * data — used to trace a `charge.dispute.*` / `charge.refunded` event (which
 * only carries a charge id) back to the invoice a payment was recorded
 * against. Stripe's pinned API version (`2025-06-30.basil`) removed the
 * `invoice` back-reference from `Charge` itself, so this can't be resolved
 * via a Stripe API call — `recordStripeConnectPayment` already stores every
 * charge id behind a payment in its mapping's `metadata.chargeIds`, which is
 * a reverse index of exactly this. Never throws; returns `null` when no
 * mapping references the charge (e.g. a charge on an invoice Carbon never
 * recorded), so the caller can log and skip.
 */
export async function getStripeInvoiceIdForCharge(
  companyId: string,
  chargeId: string
): Promise<string | null> {
  const row = await _db
    .selectFrom("externalIntegrationMapping")
    .select(["externalId"])
    .where("integration", "=", INTEGRATION)
    .where("entityType", "=", "payment")
    .where("companyId", "=", companyId)
    .where(sql<boolean>`"metadata"->'chargeIds' ? ${chargeId}`)
    .executeTakeFirst();

  return row?.externalId ?? null;
}

/**
 * Reverse a Stripe Connect payment via `post-payment`'s existing `void` op —
 * a FULL reversal that mirrors every journal line (including the fee line)
 * with a negated amount. Called for a full refund, a lost dispute, or an
 * invoice being voided on Stripe's side. Voids every non-Voided payment
 * mapped to the invoice (installment/partial-payment invoices can have more
 * than one — see `recordStripeConnectPayment`).
 *
 * There is no partial-reversal capability — a partial refund has no safe
 * automated GL treatment here and must be handled manually; callers should
 * not invoke this for one.
 */
export async function voidStripeConnectPayment({
  companyId,
  stripeInvoiceId
}: {
  companyId: string;
  stripeInvoiceId: string;
}): Promise<StripeConnectVoidResult> {
  const serviceRole = getCarbonServiceRole();
  const mappingService = createMappingService(_db, companyId);

  const mappings = await mappingService.getAllByExternalId(
    INTEGRATION,
    stripeInvoiceId,
    "payment"
  );
  if (mappings.length === 0) {
    return {
      status: "skipped",
      reason: `No Stripe Connect payment is recorded for Stripe invoice ${stripeInvoiceId}`
    };
  }

  const paymentIds = mappings.map((m) => m.entityId);
  const existingPayments = await serviceRole
    .from("payment")
    .select("id, status")
    .in("id", paymentIds)
    .eq("companyId", companyId);

  if (existingPayments.error) {
    throw new Error(
      `Failed to load Stripe Connect payments recorded for invoice ${stripeInvoiceId}`
    );
  }

  const voidable = (existingPayments.data ?? []).filter(
    (p) => p.status === "Posted"
  );
  if (voidable.length === 0) {
    return {
      status: "skipped",
      reason: `No Posted Stripe Connect payment to void for invoice ${stripeInvoiceId}`
    };
  }

  const voidedIds: string[] = [];
  for (const payment of voidable) {
    const voided = await serviceRole.functions.invoke("post-payment", {
      body: {
        type: "void",
        paymentId: payment.id,
        userId: SYSTEM_USER,
        companyId
      }
    });

    if (voided.error) {
      logger.error("Failed to void a Stripe Connect payment", {
        error: voided.error,
        companyId,
        paymentId: payment.id,
        stripeInvoiceId
      });
      throw new Error(
        `Failed to void payment ${payment.id} for Stripe invoice ${stripeInvoiceId}: ${voided.error.message}`
      );
    }

    voidedIds.push(payment.id);
  }

  return { status: "voided", paymentIds: voidedIds };
}
