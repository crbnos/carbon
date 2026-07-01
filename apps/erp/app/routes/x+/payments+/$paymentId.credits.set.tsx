import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { z } from "zod";
import { applyCreditsToInvoices, getPayment } from "~/modules/invoicing";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

// The credits half of the invoice "Receive Payment" composer. Applies the party's
// posted credits to their open invoices (memo-sourced invoiceSettlement rows,
// GL-neutral) — independent of the payment's own cash applications, but driven
// from the same screen so an invoice can be cleared with cash + credits at once.
const setCreditsValidator = z.object({
  applications: z.string() // JSON-encoded array
});

const rowsValidator = z.array(
  z.object({
    memoId: z.string().min(1),
    invoiceId: z.string().min(1),
    amount: z.number().positive()
  })
);

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { paymentId } = params;
  if (!paymentId) throw redirect(path.to.payments);

  const formData = await request.formData();
  const raw = setCreditsValidator.safeParse({
    applications: formData.get("applications")
  });
  if (!raw.success) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(raw.error, "Invalid payload"))
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.data.applications);
  } catch (e) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(e, "Credits payload is not valid JSON"))
    );
  }

  const rows = rowsValidator.safeParse(parsed);
  if (!rows.success) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(rows.error, "Invalid credit applications"))
    );
  }

  // The invoice side follows the payment's party: a customer's credits clear
  // sales invoices; a supplier's clear purchase invoices.
  const payment = await getPayment(client, paymentId);
  if (payment.error || !payment.data) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(payment.error, "Failed to load payment"))
    );
  }
  const side: "sales" | "purchase" = payment.data.customerId
    ? "sales"
    : "purchase";

  try {
    await applyCreditsToInvoices(getDatabaseClient(), {
      paymentId,
      companyId,
      createdBy: userId,
      appliedDate: new Date().toISOString().slice(0, 10),
      side,
      applications: rows.data
    });
  } catch (e) {
    // applyCreditsToInvoices throws Error with a specific, user-actionable
    // reason (over-applied, invoice already settled, exchange-rate mismatch,
    // etc.). Surface that instead of a generic message so the user knows why.
    const reason =
      e instanceof Error && e.message ? e.message : "Failed to apply credits";
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(e, reason))
    );
  }

  throw redirect(
    path.to.payment(paymentId),
    await flash(request, success("Credits applied"))
  );
}
