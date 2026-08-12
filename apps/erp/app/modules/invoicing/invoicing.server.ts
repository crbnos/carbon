import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { createMappingService } from "@carbon/ee/accounting";
import { getLogger } from "@carbon/logger";
import type { ConnectInvoice } from "@carbon/stripe/connect.server";
import {
  fromStripeAmount,
  getConnectInvoicePaymentDetails
} from "@carbon/stripe/connect.server";
import { datetime } from "@carbon/utils";
import { fromAbsolute, toCalendarDate } from "@internationalized/date";
import {
  createJournalEntry,
  getDefaultAccounts,
  postJournalEntry,
  upsertJournalEntryLine
} from "~/modules/accounting";
import { getNextSequence } from "~/modules/settings";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getDatabaseClient } from "~/services/database.server";
import {
  deletePayment,
  getSalesInvoice,
  replaceInvoiceSettlements,
  upsertPayment
} from "./invoicing.service";

const logger = getLogger("erp", "stripe-connect", "payments");

const INTEGRATION = "stripe-connect";

// Webhook-driven writes have no acting user. `system` is the seeded user every
// other unattended path attributes to (see the scheduled Inngest jobs).
const SYSTEM_USER = "system";

export type StripeConnectPaymentResult =
  | { status: "recorded"; paymentId: string }
  | { status: "skipped"; reason: string };

/**
 * Record a Stripe Connect invoice payment against its originating Carbon sales
 * invoice: create a Receipt payment for the GROSS amount collected, settle it
 * against the invoice, post it, and book Stripe's processing fee as its own
 * journal entry.
 *
 * Idempotent on the Stripe invoice id — Stripe retries deliveries, and the
 * partial unique index on `externalIntegrationMapping` makes a concurrent
 * duplicate lose the race at the database rather than double-book cash.
 *
 * Throws on *fixable* configuration problems (missing bank account, missing
 * sequence) so the caller returns non-2xx and Stripe retries once the admin has
 * corrected it. Returns `skipped` for anything a retry could never fix.
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
  const db = getDatabaseClient();
  const mappingService = createMappingService(db, companyId);

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

  const salesInvoice = await getSalesInvoice(serviceRole, carbonInvoiceId);
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

  const accountDefaults = await getDefaultAccounts(serviceRole, companyId);
  const bankAccount =
    (integrationMetadata.paymentBankAccount as string | undefined) ||
    accountDefaults.data?.bankCashAccount;
  if (!bankAccount) {
    throw new Error(
      "No bank account is configured for Stripe Connect receipts (set accountDefault.bankCashAccount or the integration's paymentBankAccount)"
    );
  }

  const timezone = await getCompanyTimeZone(serviceRole, companyId);
  const paidAt = stripeInvoice.status_transitions?.paid_at;
  const paymentDate = (
    paidAt
      ? toCalendarDate(fromAbsolute(paidAt * 1000, timezone))
      : datetime.today(timezone)
  ).toString();

  const exchangeRate = Number(salesInvoice.data.exchangeRate ?? 1) || 1;

  const nextSequence = await getNextSequence(serviceRole, "payment", companyId);
  if (nextSequence.error || !nextSequence.data) {
    throw new Error("Failed to allocate a payment id for the Stripe payment");
  }

  const insert = await upsertPayment(serviceRole, {
    paymentId: nextSequence.data,
    paymentType: "Receipt",
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
  });

  if (insert.error || !insert.data) {
    throw new Error(
      `Failed to create the Carbon payment for Stripe invoice ${stripeInvoiceId}`
    );
  }

  const paymentId = insert.data.id;

  const feeDetails = await getConnectInvoicePaymentDetails(
    stripeAccountId,
    stripeInvoiceId
  );

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
          feeCurrency: feeDetails.feeCurrency
        },
        createdBy: SYSTEM_USER
      }
    );
  } catch (err) {
    await deletePayment(serviceRole, paymentId);
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
    await replaceInvoiceSettlements(db, {
      paymentId,
      companyId,
      createdBy: SYSTEM_USER,
      applications: [
        {
          targetSalesInvoiceId: carbonInvoiceId,
          appliedAmount,
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: exchangeRate,
          sourceExchangeRate: exchangeRate,
          appliedDate: paymentDate
        }
      ]
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
      companyId
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

  await bookStripeFee({
    companyId,
    paymentId,
    postingDate: paymentDate,
    currencyCode,
    exchangeRate,
    feeAccountOverride: integrationMetadata.paymentFeeAccount as
      | string
      | undefined,
    feeDetails,
    bankAccount,
    reference: stripeInvoice.number ?? stripeInvoiceId
  });

  return { status: "recorded", paymentId };
}

/**
 * Book Stripe's processing fee as a standalone journal entry: DR the service
 * charge account, CR the same bank account the receipt debited, so the bank
 * nets to what Stripe actually deposits while AR is still relieved at gross.
 *
 * Never throws — a fee we can't book is a reconciliation item, not a reason to
 * fail a payment that has already posted.
 */
async function bookStripeFee({
  companyId,
  paymentId,
  postingDate,
  currencyCode,
  exchangeRate,
  feeAccountOverride,
  feeDetails,
  bankAccount,
  reference
}: {
  companyId: string;
  paymentId: string;
  postingDate: string;
  currencyCode: string;
  exchangeRate: number;
  feeAccountOverride: string | undefined;
  feeDetails: Awaited<ReturnType<typeof getConnectInvoicePaymentDetails>>;
  bankAccount: string;
  reference: string;
}): Promise<void> {
  if (feeDetails.feeAmount <= 0) return;

  const serviceRole = getCarbonServiceRole();

  try {
    // Fees are assessed in the account's settlement currency, which needn't be
    // the invoice currency. Converting one to the other would need a second FX
    // rate we don't have here, so book only the matching case and leave the
    // rest to manual reconciliation.
    if (feeDetails.feeCurrency && feeDetails.feeCurrency !== currencyCode) {
      logger.warn(
        "Skipping Stripe fee journal entry — fee currency differs from the invoice currency",
        {
          companyId,
          paymentId,
          feeCurrency: feeDetails.feeCurrency,
          currencyCode
        }
      );
      return;
    }

    const [settings, company, accountDefaults] = await Promise.all([
      serviceRole
        .from("companySettings")
        .select("accountingEnabled")
        .eq("id", companyId)
        .single(),
      serviceRole
        .from("company")
        .select("companyGroupId")
        .eq("id", companyId)
        .single(),
      getDefaultAccounts(serviceRole, companyId)
    ]);

    // With accounting off there is no general ledger to book the fee into —
    // `post-payment` skips its own journal for the same reason.
    if (!settings.data?.accountingEnabled) return;

    const feeAccount =
      feeAccountOverride || accountDefaults.data?.serviceChargeAccount;
    if (!feeAccount) {
      logger.warn(
        "Skipping Stripe fee journal entry — no service charge account is configured",
        { companyId, paymentId }
      );
      return;
    }

    const companyGroupId = company.data?.companyGroupId;
    if (!companyGroupId) {
      logger.warn(
        "Skipping Stripe fee journal entry — company has no company group",
        { companyId, paymentId }
      );
      return;
    }

    // Journal lines are stored in base currency, same as the payment journal.
    const feeInBaseCurrency =
      Math.round(feeDetails.feeAmount * exchangeRate * 10000) / 10000;

    const nextSequence = await getNextSequence(
      serviceRole,
      "journalEntry",
      companyId
    );
    if (nextSequence.error || !nextSequence.data) {
      logger.error("Failed to allocate a journal entry id for the Stripe fee", {
        error: nextSequence.error,
        companyId,
        paymentId
      });
      return;
    }

    const description = `Stripe processing fee — ${reference}`;

    const journal = await createJournalEntry(serviceRole, {
      journalEntryId: nextSequence.data,
      description,
      postingDate,
      // The fee belongs to a payment; reusing the existing enum value keeps
      // this migration-free.
      sourceType: "Payment",
      companyId,
      createdBy: SYSTEM_USER
    });

    if (journal.error || !journal.data) {
      logger.error("Failed to create the Stripe fee journal entry", {
        error: journal.error,
        companyId,
        paymentId
      });
      return;
    }

    for (const line of [
      { accountId: feeAccount, debit: feeInBaseCurrency, credit: 0 },
      { accountId: bankAccount, debit: 0, credit: feeInBaseCurrency }
    ]) {
      const inserted = await upsertJournalEntryLine(serviceRole, {
        journalId: journal.data.id,
        accountId: line.accountId,
        description,
        debit: line.debit,
        credit: line.credit,
        companyId,
        companyGroupId
      });
      if (inserted.error) {
        logger.error("Failed to add a line to the Stripe fee journal entry", {
          error: inserted.error,
          companyId,
          paymentId
        });
        return;
      }
    }

    const postedJournal = await postJournalEntry(
      serviceRole,
      journal.data.id,
      SYSTEM_USER
    );
    if (postedJournal.error) {
      logger.error("Failed to post the Stripe fee journal entry", {
        error: postedJournal.error,
        companyId,
        paymentId
      });
    }
  } catch (err) {
    logger.error("Unexpected failure booking the Stripe fee", {
      error: err,
      companyId,
      paymentId
    });
  }
}
