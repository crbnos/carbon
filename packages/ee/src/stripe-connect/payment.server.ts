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
  getConnectInvoicePaymentDetails
} from "@carbon/stripe/connect.server";
import { datetime } from "@carbon/utils";
import { fromAbsolute, toCalendarDate } from "@internationalized/date";
import { PostgresDriver } from "kysely";
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

/**
 * Record a Stripe Connect invoice payment against its originating Carbon sales
 * invoice: create a Receipt payment for the GROSS amount collected (what the
 * customer was invoiced and paid), settle it against the invoice, and post it.
 * Stripe's processing fee — withheld before the payout ever reaches the bank —
 * rides along in the SAME journal entry `post-payment` builds: the bank line
 * carries the net deposit and a fee expense line makes up the difference, so
 * there is one entry per payment instead of a payment entry plus a follow-up
 * fee entry.
 *
 * Idempotent on the Stripe invoice id — Stripe retries deliveries, and the
 * partial unique index on `externalIntegrationMapping` makes a concurrent
 * duplicate lose the race at the database rather than double-book cash.
 *
 * Throws on *fixable* configuration problems (missing bank account, missing
 * service-charge account, missing sequence) so the caller returns non-2xx and
 * Stripe retries once the admin has corrected it. Returns `skipped` for
 * anything a retry could never fix.
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

  const alreadyRecorded = await mappingService.getByExternalId(
    INTEGRATION,
    stripeInvoiceId,
    "payment"
  );
  if (alreadyRecorded) {
    return {
      status: "skipped",
      reason: `Stripe invoice ${stripeInvoiceId} is already recorded as payment ${alreadyRecorded.entityId}`
    };
  }

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

  const accountDefaults = await serviceRole
    .from("accountDefault")
    .select("bankCashAccount, serviceChargeAccount")
    .eq("companyId", companyId)
    .single();

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
  // orphaned Draft payment that the idempotency check (keyed on the external
  // mapping, not the payment table) would never notice. Gated on
  // accountingEnabled: `post-payment` only ever builds a GL journal (fee
  // included) when accounting is on, so a company that hasn't configured a
  // service-charge account because they don't use Carbon's accounting at all
  // must not have Stripe payments start failing over it.
  const feeDetails = await getConnectInvoicePaymentDetails(
    stripeAccountId,
    stripeInvoiceId
  );
  let journalFee:
    | { amount: number; accountId: string; description: string }
    | undefined;
  if (feeDetails.feeAmount > 0) {
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
          amount: feeDetails.feeAmount,
          accountId: feeAccount,
          description: `Stripe processing fee — ${stripeInvoice.number ?? stripeInvoiceId}`
        };
      }
    }
  }

  const timezone = await getCompanyTimeZone(serviceRole, companyId);
  const paidAt = stripeInvoice.status_transitions?.paid_at;
  const paymentDate = (
    paidAt
      ? toCalendarDate(fromAbsolute(paidAt * 1000, timezone))
      : datetime.today(timezone)
  ).toString();

  const exchangeRate = Number(salesInvoice.data.exchangeRate ?? 1) || 1;

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
        exchangeRate,
        totalAmount: amountPaid,
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

  const paymentId = insert.data.id;

  // Claim the Stripe invoice for this payment BEFORE settling or posting.
  // A duplicate delivery racing us fails the unique index here, while the
  // payment it created is still an unsettled Draft that can be rolled back.
  try {
    await mappingService.link(
      "payment",
      paymentId,
      INTEGRATION,
      stripeInvoiceId,
      {
        metadata: {
          stripeInvoiceId,
          stripeAccountId,
          chargeIds: feeDetails.chargeIds,
          feeAmount: feeDetails.feeAmount,
          feeCurrency: feeDetails.feeCurrency,
          settlementCurrency: feeDetails.settlementCurrency
        },
        createdBy: SYSTEM_USER
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

  // Settle against the invoice's open balance. Cash beyond it stays unapplied
  // and becomes on-account credit — `post-payment` already handles that.
  const openBalance = Number(salesInvoice.data.balance ?? 0);
  const appliedAmount = Math.min(amountPaid, openBalance);

  if (appliedAmount > 0) {
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
          targetExchangeRate: exchangeRate,
          sourceExchangeRate: exchangeRate,
          appliedDate: paymentDate,
          companyId,
          createdBy: SYSTEM_USER
        })
        .execute();
    });
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
    // leave the Draft in place for a human to post rather than losing the record.
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
