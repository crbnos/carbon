import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { toBaseAmount } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getOpenReimbursementsForEmployee,
  getPaymentCurrencyConfiguration,
  getReimbursement,
  reimbursementPaymentValidator,
  replaceInvoiceSettlements,
  upsertPayment
} from "~/modules/invoicing";
import { getNextSequence } from "~/modules/settings";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

/**
 * The "Pay expense" action. It creates the ordinary documents rather than a
 * bespoke payout: one `payment` with an employee payee, one `invoiceSettlement`
 * with `targetReimbursementId`, then the existing `post-payment` edge function.
 * The settlement goes through `replaceInvoiceSettlements`, whose employee arm
 * is the authority on party, currency, Posted status and the balance ceiling —
 * this route never writes a settlement row itself.
 *
 * The payment carries the REIMBURSEMENT's exchange rate, not a fresh one. The
 * modal has no rate field (Rillet's payments endpoint has none either), and
 * paying a booked employee payable at its own rate is what keeps the payout
 * free of a revaluation nobody asked for. Currencies must match anyway —
 * `replaceInvoiceSettlements` refuses otherwise.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "invoicing"
  });

  const { reimbursementId } = params;
  if (!reimbursementId) throw redirect(path.to.reimbursements);

  const formData = await request.formData();
  const validation = await validator(reimbursementPaymentValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const reimbursement = await getReimbursement(
    client,
    companyId,
    reimbursementId
  );
  if (reimbursement.error || !reimbursement.data) {
    throw redirect(
      path.to.reimbursements,
      await flash(
        request,
        error(reimbursement.error, "Failed to load reimbursement")
      )
    );
  }
  if (reimbursement.data.status !== "Posted") {
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(
        request,
        error(null, "Only a posted reimbursement can be paid")
      )
    );
  }

  // Re-read the balance server-side: the modal's default came from a loader
  // that may be minutes old, and a second payout must not overdraw the payable.
  const open = await getOpenReimbursementsForEmployee(
    client,
    companyId,
    reimbursement.data.employeeId,
    reimbursement.data.currencyCode
  );
  if (open.error) {
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(request, error(open.error, "Failed to load the balance due"))
    );
  }
  const balance = (open.data ?? []).find((r) => r.id === reimbursementId);
  if (!balance) {
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(request, error(null, "This reimbursement is fully paid"))
    );
  }
  if (validation.data.amount > balance.remainingDocument) {
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(
        request,
        error(null, "The amount exceeds the reimbursement's balance due")
      )
    );
  }

  try {
    await getPaymentCurrencyConfiguration(
      client,
      companyId,
      reimbursement.data.currencyCode
    );
  } catch (e) {
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(
        request,
        error(
          e,
          e instanceof Error ? e.message : "Invalid currency configuration"
        )
      )
    );
  }

  const next = await getNextSequence(client, "payment", companyId);
  if (next.error || !next.data) {
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(request, error(next.error, "Failed to allocate payment id"))
    );
  }

  const exchangeRate = Number(reimbursement.data.exchangeRate);
  const payment = await upsertPayment(client, {
    paymentId: next.data,
    paymentType: "Disbursement",
    employeeId: reimbursement.data.employeeId,
    paymentDate: validation.data.paymentDate,
    currencyCode: reimbursement.data.currencyCode,
    exchangeRate,
    totalAmount: validation.data.amount,
    bankAccount: validation.data.bankAccount,
    companyId,
    createdBy: userId
  });
  if (payment.error || !payment.data) {
    throw redirect(
      path.to.reimbursement(reimbursementId),
      await flash(request, error(payment.error, "Failed to create the payment"))
    );
  }

  try {
    // The Kysely client is built HERE and passed in — a route may import a
    // `.server` module, a `*.service.ts` may not (`no-db-client-in-service`).
    await replaceInvoiceSettlements(getDatabaseClient(), {
      paymentId: payment.data.id,
      companyId,
      createdBy: userId,
      applications: [
        {
          targetReimbursementId: reimbursementId,
          sourceAmount: validation.data.amount,
          appliedAmount: toBaseAmount(validation.data.amount, exchangeRate),
          discountAmount: 0,
          writeOffAmount: 0,
          targetExchangeRate: exchangeRate,
          sourceExchangeRate: exchangeRate,
          appliedDate: validation.data.paymentDate
        }
      ]
    });
  } catch (e) {
    // The Draft payment exists and is valid on its own; send the user to it so
    // the application can be finished by hand rather than silently losing it.
    throw redirect(
      path.to.payment(payment.data.id),
      await flash(
        request,
        error(e, "Payment created, but applying it to the reimbursement failed")
      )
    );
  }

  const serviceRole = getCarbonServiceRole();
  try {
    const result = await serviceRole.functions.invoke("post-payment", {
      body: { type: "post", paymentId: payment.data.id, userId, companyId }
    });
    if (result.error) {
      const message =
        (result.data as { message?: string } | undefined)?.message ??
        result.error.message ??
        "Failed to post the payment";
      throw redirect(
        path.to.payment(payment.data.id),
        await flash(request, error(result.error, message))
      );
    }
  } catch (err) {
    if (err instanceof Response) throw err;
    throw redirect(
      path.to.payment(payment.data.id),
      await flash(request, error(err, "Failed to post the payment"))
    );
  }

  throw redirect(
    path.to.reimbursement(reimbursementId),
    await flash(request, success("Reimbursement paid"))
  );
}
