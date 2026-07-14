import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { z } from "zod";
import {
  invoiceSettlementBase,
  invoiceSettlementValidator,
  replaceInvoiceSettlements
} from "~/modules/invoicing";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

// Apply-table submits the full list of applications as one JSON payload.
// Each row is validated against invoiceSettlementValidator (with the
// paymentId injected from the URL), then replaceInvoiceSettlements
// runs a delete-then-insert under RLS (Draft-only via the parent
// payment policy).
const setApplicationsValidator = z.object({
  applications: z.string() // JSON-encoded array
});

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "invoicing"
  });

  const { paymentId } = params;
  if (!paymentId) throw redirect(path.to.payments);

  const formData = await request.formData();
  const raw = setApplicationsValidator.safeParse({
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
      await flash(request, error(e, "Applications payload is not valid JSON"))
    );
  }

  // Per-row validation through the shared zod validator. paymentId is
  // injected so the validator's required-field check passes without
  // depending on the client to send it on every row.
  const rowsValidator = z.array(
    invoiceSettlementBase.omit({ paymentId: true })
  );
  const rowsResult = rowsValidator.safeParse(parsed);
  if (!rowsResult.success) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(rowsResult.error, "Invalid applications"))
    );
  }

  // Re-validate each row through the full refined validator now that
  // paymentId is present.
  const applications = [];
  for (const row of rowsResult.data) {
    const validated = invoiceSettlementValidator.safeParse({
      ...row,
      paymentId
    });
    if (!validated.success) {
      throw redirect(
        path.to.payment(paymentId),
        await flash(
          request,
          error(validated.error, "Application failed validation")
        )
      );
    }
    const { id: _omit, paymentId: _omit2, ...rest } = validated.data;
    applications.push(rest);
  }

  try {
    await replaceInvoiceSettlements(getDatabaseClient(), {
      paymentId,
      companyId,
      createdBy: userId,
      applications
    });
  } catch (e) {
    throw redirect(
      path.to.payment(paymentId),
      await flash(request, error(e, "Failed to save applications"))
    );
  }

  throw redirect(
    path.to.payment(paymentId),
    await flash(request, success("Applications saved"))
  );
}
