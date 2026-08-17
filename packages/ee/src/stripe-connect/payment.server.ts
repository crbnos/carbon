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
import { datetime, round, toStoredAmount } from "@carbon/utils";
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
 * invoice: create a Receipt payment for the GROSS amount collected, settle it
 * against the invoice, post it, and book Stripe's processing fee as its own
 * journal entry.
 *
 * Idempotent on the Stripe invoice id — Stripe retries deliveries, and the
 * partial unique index on `externalIntegrationMapping` makes a concurrent
 * duplicate lose the race at the database rather than double-book cash.
 *
 * Throws on *fixable* configuration problems (missing bank account, missing
 * sequence) so the caller returns non-2xx and Stripe retries once the admin
 * has corrected it. Returns `skipped` for anything a retry could never fix.
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
      serviceRole
        .from("accountDefault")
        .select("serviceChargeAccount")
        .eq("companyId", companyId)
        .single()
    ]);

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

    const feeInBaseCurrency = round(feeDetails.feeAmount * exchangeRate);

    const nextSeq = await serviceRole.rpc("get_next_sequence", {
      sequence_name: "journalEntry",
      company_id: companyId
    });
    if (nextSeq.error || !nextSeq.data) {
      logger.error("Failed to allocate a journal entry id for the Stripe fee", {
        error: nextSeq.error,
        companyId,
        paymentId
      });
      return;
    }

    const description = `Stripe processing fee — ${reference}`;

    // Resolve the accounting period for the posting date. If none exists yet
    // (the month hasn't been opened) we skip the fee journal rather than
    // creating a period here — the payment itself is already posted, and the
    // fee can be reconciled manually or the period opened later.
    const periodResult = await serviceRole
      .from("accountingPeriod")
      .select("id, closeStatus, status")
      .eq("companyId", companyId)
      .lte("startDate", postingDate)
      .gte("endDate", postingDate)
      .maybeSingle();

    if (!periodResult.data) {
      logger.warn(
        "Skipping Stripe fee journal entry — no accounting period found for date",
        { companyId, paymentId, postingDate }
      );
      return;
    }

    const closeStatus = (periodResult.data as { closeStatus?: string })
      .closeStatus;
    if (closeStatus === "Closed") {
      logger.warn(
        "Skipping Stripe fee journal entry — accounting period is closed",
        { companyId, paymentId, postingDate }
      );
      return;
    }

    const journal = await serviceRole
      .from("journal")
      .insert([
        {
          journalEntryId: nextSeq.data,
          description,
          postingDate,
          sourceType: "Payment" as const,
          status: "Draft" as const,
          companyId,
          createdBy: SYSTEM_USER
        }
      ])
      .select("id")
      .single();

    if (journal.error || !journal.data) {
      logger.error("Failed to create the Stripe fee journal entry", {
        error: journal.error,
        companyId,
        paymentId
      });
      return;
    }

    // For each line we need the account's class to compute the stored signed
    // amount. DR fee account (Expense class → positive amount), CR bank account
    // (Asset class → negative amount).
    for (const line of [
      { accountId: feeAccount, debit: feeInBaseCurrency, credit: 0 },
      { accountId: bankAccount, debit: 0, credit: feeInBaseCurrency }
    ]) {
      const account = await serviceRole
        .from("account")
        .select("class")
        .eq("id", line.accountId)
        .single();

      if (account.error || !account.data?.class) {
        logger.error(
          "Failed to resolve account class for Stripe fee journal line",
          {
            error: account.error,
            accountId: line.accountId,
            companyId,
            paymentId
          }
        );
        return;
      }

      const amount = toStoredAmount(
        line.debit,
        line.credit,
        account.data.class as Parameters<typeof toStoredAmount>[2]
      );

      const inserted = await serviceRole
        .from("journalLine")
        .insert([
          {
            journalId: journal.data.id,
            accountId: line.accountId,
            description,
            amount,
            journalLineReference: crypto.randomUUID(),
            companyId
          }
        ])
        .select("id")
        .single();

      if (inserted.error) {
        logger.error("Failed to add a line to the Stripe fee journal entry", {
          error: inserted.error,
          companyId,
          paymentId
        });
        return;
      }
    }

    const postedJournal = await serviceRole
      .from("journal")
      .update({
        status: "Posted" as const,
        postedAt: new Date().toISOString(),
        postedBy: SYSTEM_USER,
        accountingPeriodId: periodResult.data.id,
        updatedBy: SYSTEM_USER
      })
      .eq("id", journal.data.id)
      .select("id")
      .single();

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
