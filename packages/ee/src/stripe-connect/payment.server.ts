// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { posting } from "@carbon/api/postings.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getCompanyTimeZone } from "@carbon/database";
import type { KyselyDatabase } from "@carbon/database/client";
import { getPostgresClient, getProcessPool } from "@carbon/database/client";
import {
  countedProcessorFee,
  processorFeeAccount
} from "@carbon/database/payment-processor-fee";
import { acquireLease, withLease } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { ConnectInvoice } from "@carbon/stripe/connect.server";
import {
  fromStripeAmount,
  getConnectInvoicePaymentDetails,
  toStripeAmount
} from "@carbon/stripe/connect.server";
import { datetime, isUniqueViolation } from "@carbon/utils";
import { fromAbsolute, toCalendarDate } from "@internationalized/date";
import { PostgresDriver, sql } from "kysely";
import { createMappingService } from "../accounting/index";
import { refundedChargePayments } from "./refund-attribution";
import { carbonSettlementRate } from "./settlement-rate";

const logger = getLogger("ee", "stripe-connect", "payments");

const INTEGRATION = "stripe-connect";
const SYSTEM_USER = "system";

// Settlement replacement and the post-payment / void server functions run
// their transactions on this client, over the process pool.
const _pool = getProcessPool();
const _db = getPostgresClient<KyselyDatabase>(_pool, PostgresDriver);

export type StripeConnectPaymentResult =
  | { status: "recorded"; paymentId: string }
  | { status: "skipped"; reason: string };

export type StripeConnectVoidResult =
  | { status: "voided"; paymentIds: string[] }
  | { status: "skipped"; reason: string };

const INVOICE_LEASE_MS = 60_000;
const INVOICE_LEASE_RENEW_MS = 20_000;
const INVOICE_LEASE_WAIT_MS = 250;
const INVOICE_LEASE_ATTEMPTS = 20;

/**
 * Runs `work` while this process holds the Stripe invoice's lease. Stripe
 * sends `invoice.paid` and `invoice.payment_succeeded` together, and the pull
 * sweep can overlap a webhook: two deliveries reading the same recorded total
 * would each record the same installment. Recording and voiding share the
 * lease, so a refund cannot race the payment it reverses. A Redis lease holds
 * no database connection, which the settlement and posting below each need.
 * Waits up to about five seconds, then throws so the delivery is retried
 * (webhook 500, or the sweep holds its cursor). Throws when Redis is down too:
 * recording without the lease could book the cash twice.
 */
async function withStripeInvoiceLease<T>(
  companyId: string,
  stripeInvoiceId: string,
  work: () => Promise<T>
): Promise<T> {
  const key = `stripe-connect:invoice:${companyId}:${stripeInvoiceId}`;
  for (let attempt = 0; attempt < INVOICE_LEASE_ATTEMPTS; attempt++) {
    const lease = await acquireLease(key, INVOICE_LEASE_MS);
    if (lease.status === "acquired") {
      return withLease(
        key,
        lease.owner,
        { leaseMs: INVOICE_LEASE_MS, renewMs: INVOICE_LEASE_RENEW_MS },
        work
      );
    }
    if (lease.status === "unavailable") {
      throw new Error(
        `Redis is unavailable, so Stripe invoice ${stripeInvoiceId} cannot be recorded safely`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, INVOICE_LEASE_WAIT_MS));
  }
  throw new Error(
    `Another delivery is still processing Stripe invoice ${stripeInvoiceId}`
  );
}

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
 * One delivery per Stripe invoice at a time (`withStripeInvoiceLease`).
 *
 * Throws on *fixable* problems so the caller returns non-2xx and Stripe
 * retries: configuration (missing bank account, service-charge account or
 * sequence), a settlement or posting that failed after the Draft was written
 * (the retry resumes it), a transient Stripe failure, and a lease another
 * delivery holds. Returns `skipped` for anything a retry could never fix, and
 * for "nothing new to record": an invoice marked paid outside Stripe, one
 * whose charges were all refunded, and one whose amount is already recorded
 * (Voided payments count, so a refund is never recorded again).
 */
export async function recordStripeConnectPayment(args: {
  companyId: string;
  stripeAccountId: string;
  integrationMetadata: Record<string, unknown>;
  stripeInvoice: ConnectInvoice;
}): Promise<StripeConnectPaymentResult> {
  if (!args.stripeInvoice.id) {
    return { status: "skipped", reason: "Stripe invoice has no id" };
  }
  return withStripeInvoiceLease(args.companyId, args.stripeInvoice.id, () =>
    recordStripeConnectPaymentNow(args)
  );
}

/**
 * Marks a mapping whose `exchangeRate` is in Carbon's direction (foreign units
 * per base unit). Mappings written before the fix hold Stripe's own rate.
 */
const CARBON_RATE_DIRECTION = "foreign-per-base";

async function companyBaseCurrency(
  serviceRole: ReturnType<typeof getCarbonServiceRole>,
  companyId: string
): Promise<string | null> {
  const company = await serviceRole
    .from("company")
    .select("baseCurrencyCode")
    .eq("id", companyId)
    .single();
  if (company.error || !company.data) {
    throw new Error(
      "Failed to load the company's base currency for the Stripe payment"
    );
  }
  return company.data.baseCurrencyCode;
}

async function recordStripeConnectPaymentNow({
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

  // Only the money that moved through Stripe is Stripe cash. `amount_paid`
  // also counts what the seller marked paid outside Stripe; dahlia reports that
  // part as `amount_paid_off_stripe` (an older webhook payload leaves it out,
  // and `paidOutsideStripe` below still catches an invoice paid wholly outside).
  const amountPaid = fromStripeAmount(
    Math.max(
      stripeInvoice.amount_paid - (stripeInvoice.amount_paid_off_stripe ?? 0),
      0
    ),
    currencyCode
  );
  if (amountPaid <= 0) {
    return {
      status: "skipped",
      reason: `Stripe invoice ${stripeInvoiceId} reported no amount paid through Stripe`
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

      // A Voided payment still counts. Carbon voids one for a refund or a
      // lost dispute, and Stripe leaves the invoice `paid`, so leaving it out
      // would record the returned money again. A person who voided one by
      // mistake records the payment by hand.
      recordedTotal += Number(payment.totalAmount ?? 0);
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
    if (
      realizedExchangeRate !== null &&
      meta.exchangeRateDirection !== CARBON_RATE_DIRECTION
    ) {
      // Recorded before the rate fix: the Draft holds Stripe's own rate, the
      // wrong way round. It has not been posted, so correct it before it is.
      realizedExchangeRate = carbonSettlementRate({
        stripeRate: realizedExchangeRate,
        settlementCurrency: (meta.settlementCurrency as string | null) ?? null,
        baseCurrency: await companyBaseCurrency(serviceRole, companyId)
      });
      const corrected = await serviceRole
        .from("payment")
        .update({
          exchangeRate:
            realizedExchangeRate ??
            (Number(salesInvoice.data.exchangeRate ?? 1) || 1)
        })
        .eq("id", paymentId)
        .eq("companyId", companyId)
        .eq("status", "Draft");
      if (corrected.error) {
        throw new Error(
          `Failed to correct the exchange rate of Draft payment ${paymentId}`
        );
      }
    }

    // The rules a journal rebuilt from the stored payment reads the fee by,
    // so the resumed posting and a later rebuild book the same fee. Every
    // company books it: Provisional before the accounting cutover, Posted
    // after it.
    const fee = countedProcessorFee(
      {
        id: paymentId,
        currencyCode,
        reference: stripeInvoice.number ?? null
      },
      { externalId: stripeInvoiceId, metadata: resume.mapping.metadata }
    );
    if (fee) {
      journalFee = {
        ...fee,
        accountId: processorFeeAccount(
          integrationMetadata,
          accountDefaults.data?.serviceChargeAccount
        )
      };
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
    // orphaned Draft payment. `serviceChargeAccount` is a required account
    // default, so every company resolves it; `post-payment` books the fee in
    // a Provisional journal before the accounting cutover.
    const feeDetails = await getConnectInvoicePaymentDetails(
      stripeAccountId,
      stripeInvoiceId
    );
    // Marked paid in the Stripe Dashboard: the money did not move through
    // Stripe, so it is not Stripe cash. The seller records it in Carbon.
    if (feeDetails.paidOutsideStripe) {
      return {
        status: "skipped",
        reason: `Stripe invoice ${stripeInvoiceId} was marked paid outside Stripe`
      };
    }
    // Refunded before Carbon recorded it (the refund webhook found nothing to
    // void): Stripe still reports the invoice paid, but no cash stayed.
    if (feeDetails.fullyRefunded) {
      return {
        status: "skipped",
        reason: `Every charge behind Stripe invoice ${stripeInvoiceId} was refunded`
      };
    }
    // Stripe's rate is in Stripe's direction, and describes the cash only when
    // Stripe settled into the base currency (`carbonSettlementRate`). Settled
    // into any other currency, the cash is booked at the invoice's own rate.
    if (feeDetails.exchangeRate && feeDetails.settlementCurrency) {
      const baseCurrencyCode = await companyBaseCurrency(
        serviceRole,
        companyId
      );
      realizedExchangeRate = carbonSettlementRate({
        stripeRate: feeDetails.exchangeRate,
        settlementCurrency: feeDetails.settlementCurrency,
        baseCurrency: baseCurrencyCode
      });
      if (realizedExchangeRate === null) {
        logger.warn(
          "Stripe settled the payment into a currency that is not the base currency; booking it at the invoice's exchange rate",
          {
            companyId,
            stripeInvoiceId,
            settlementCurrency: feeDetails.settlementCurrency,
            baseCurrencyCode
          }
        );
      }
    }

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
        // Every company books the fee: Provisional before the accounting
        // cutover, Posted after it. A fee with no currency is booked here in
        // the invoice currency, and the mapping records that currency below.
        journalFee = {
          amount: feeAmount,
          accountId: processorFeeAccount(
            integrationMetadata,
            accountDefaults.data?.serviceChargeAccount
          ),
          description: `Stripe processing fee — ${stripeInvoice.number ?? stripeInvoiceId}`
        };
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
      // The currency the fee was booked in. A fee Stripe reported with no
      // currency is booked in the invoice currency above, so record that:
      // `countedProcessorFee` (the resume path and a journal rebuild) then
      // books the same fee instead of dropping it.
      feeCurrency: journalFee ? currencyCode : feeDetails.feeCurrency,
      settlementCurrency: feeDetails.settlementCurrency,
      exchangeRate: realizedExchangeRate,
      exchangeRateDirection: CARBON_RATE_DIRECTION,
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
          // Any earlier mapping holds the invoice's one unique slot, also an
          // orphaned one or one whose payment was voided.
          allowDuplicateExternalId: existingMappings.length > 0
        }
      );
    } catch (err) {
      await serviceRole.from("payment").delete().eq("id", paymentId);
      if (isUniqueViolation(err)) {
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
      // only the settlement failed. The Draft stays, and the throw makes the
      // delivery retry (webhook 500, or the sweep holds its cursor); the retry
      // resumes it through the `resume` path above.
      logger.error("Failed to settle the Stripe Connect payment", {
        error: err,
        companyId,
        paymentId,
        stripeInvoiceId
      });
      throw new Error(
        `Stripe payment ${paymentId} was recorded but could not be settled against its invoice`
      );
    }
  } else {
    logger.warn(
      "Stripe payment has no open invoice balance to settle; recording it as on-account credit",
      { companyId, carbonInvoiceId, paymentId }
    );
  }

  const posted = await posting(
    "post-payment",
    { db: _db, companyId, userId: SYSTEM_USER },
    { type: "post", paymentId, fee: journalFee }
  );

  if (posted.error) {
    // The payment and its settlement are correct — only the posting failed.
    // The Draft stays, and the throw makes the delivery retry and resume it.
    // A posting that can never pass (a closed period) keeps failing until a
    // person posts the Draft or reopens the period; the sweep then moves on.
    logger.error("Failed to post the Stripe Connect payment", {
      error: posted.error,
      companyId,
      paymentId,
      stripeInvoiceId
    });
    throw new Error(
      `Stripe payment ${paymentId} was recorded but could not be posted: ${posted.error.message}`
    );
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
 * invoice being voided on Stripe's side. For a refund or a dispute (`chargeId`)
 * it voids only the payment that recorded that charge
 * (`refundedChargePayments`); for a voided invoice, every Posted payment
 * mapped to it (installment invoices can have more than one).
 *
 * There is no partial-reversal capability — a partial refund has no safe
 * automated GL treatment here and must be handled manually; callers should
 * not invoke this for one.
 */
export async function voidStripeConnectPayment(args: {
  companyId: string;
  stripeInvoiceId: string;
  /**
   * The refunded or disputed charge. Only the payment that recorded it is
   * voided (`refundedChargePayments`); without it, every payment on the
   * invoice is (the invoice was voided).
   */
  chargeId?: string;
}): Promise<StripeConnectVoidResult> {
  return withStripeInvoiceLease(args.companyId, args.stripeInvoiceId, () =>
    voidStripeConnectPaymentNow(args)
  );
}

async function voidStripeConnectPaymentNow({
  companyId,
  stripeInvoiceId,
  chargeId
}: {
  companyId: string;
  stripeInvoiceId: string;
  chargeId?: string;
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

  let paymentIds = mappings.map((m) => m.entityId);
  if (chargeId) {
    const attributed = refundedChargePayments(
      mappings.map((m) => {
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        return {
          paymentId: m.entityId,
          createdAt: m.createdAt,
          chargeIds: Array.isArray(meta.chargeIds)
            ? (meta.chargeIds as string[])
            : []
        };
      }),
      chargeId
    );
    if (attributed.status === "manual") {
      logger.warn("Stripe Connect refund needs manual handling", {
        companyId,
        stripeInvoiceId,
        chargeId,
        reason: attributed.reason
      });
      return { status: "skipped", reason: attributed.reason };
    }
    paymentIds = attributed.paymentIds;
  }
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
    const voided = await posting(
      "post-payment",
      { db: _db, companyId, userId: SYSTEM_USER },
      // A refund or a lost dispute (`chargeId`): Stripe keeps its fee, so it
      // stays an expense. A voided invoice charged nothing.
      { type: "void", paymentId: payment.id, retainFee: !!chargeId }
    );

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
