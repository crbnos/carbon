// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { leasePaymentValidator } from "~/modules/purchasing/purchasing.models";
import { upsertLeasePayment } from "~/modules/purchasing/purchasing.service";

const logger = getLogger("erp", "lease-payment-update");

/** The payment fields the setup grid edits one cell at a time, as
 *  `leasePaymentValidator` names them. */
const PAYMENT_FIELDS = [
  "periodStart",
  "periodEnd",
  "dueDate",
  "amount"
] as const;
type PaymentField = (typeof PAYMENT_FIELDS)[number];

const isPaymentField = (field: string): field is PaymentField =>
  (PAYMENT_FIELDS as readonly string[]).includes(field);

/**
 * One field of a Draft lease's payment row, saved from a setup grid cell.
 *
 * The current row is read, the one field swapped in, and the merged row runs
 * through the validator and service the payment form uses. Returns
 * `{ error }`: a cell reverts on error, and nothing flashes.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { id, paymentId } = params;
  if (!id || !paymentId) {
    return data({ error: "Payment not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const field = formData.get("field");
  const value = formData.get("value");
  if (
    typeof field !== "string" ||
    !isPaymentField(field) ||
    (typeof value !== "string" && value !== null)
  ) {
    return data({ error: "Invalid form data" }, { status: 400 });
  }

  // The row must belong to the URL's lease.
  const current = await client
    .from("leasePayment")
    .select(
      "id, leaseId, leaseLineId, paymentType, periodStart, periodEnd, dueDate, amount"
    )
    .eq("id", paymentId)
    .eq("leaseId", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (current.error || !current.data) {
    return data({ error: "Payment not found" }, { status: 404 });
  }
  const row = current.data;

  const merged: Record<string, string | number | null> = {
    id: row.id,
    leaseId: row.leaseId,
    leaseLineId: row.leaseLineId,
    paymentType: row.paymentType,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    dueDate: row.dueDate,
    amount: row.amount
  };
  merged[field] = value || null;

  const form = new FormData();
  for (const [key, term] of Object.entries(merged)) {
    if (term !== null && term !== "") form.append(key, String(term));
  }

  const validation = await validator(leasePaymentValidator).validate(form);
  if (validation.error) {
    const message =
      Object.values(validation.error.fieldErrors)[0] ??
      "This payment is not valid";
    return data({ error: message }, { status: 400 });
  }

  // Refuses a lease that is not a Draft.
  const update = await upsertLeasePayment(client, {
    ...validation.data,
    id: paymentId,
    leaseId: id,
    companyId,
    userId
  });
  if (update.error) {
    logger.error("lease payment update failed", {
      companyId,
      paymentId,
      field,
      error: update.error
    });
    return data(
      { error: update.error.message || "Failed to update payment" },
      { status: 400 }
    );
  }

  return data({ error: null });
}
