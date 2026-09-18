import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  bankTransactionValidator,
  insertBankTransaction
} from "~/modules/accounting";
import { matchBankTransactionsForAccount } from "~/modules/accounting/accounting.ee.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

// NetSuite "Method 1: Manual Match" — one hand-entered transaction (paper
// statement, no file). Lands in the same bankTransaction table as a CSV
// import, then runs through the same auto-match pass so a manual entry that
// happens to line up with an existing posted GL line clears immediately.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const { bankAccountId } = params;
  if (!bankAccountId) throw notFound("bankAccountId not found");

  const formData = await request.formData();
  const validation = await validator(bankTransactionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const inserted = await insertBankTransaction(client, {
    ...validation.data,
    companyId,
    companyBankAccountId: bankAccountId,
    createdBy: userId
  });

  if (inserted.error) {
    throw redirect(
      path.to.bankAccount(bankAccountId),
      await flash(
        request,
        error(inserted.error, "Failed to add bank transaction")
      )
    );
  }

  try {
    await matchBankTransactionsForAccount(getDatabaseClient(), {
      companyBankAccountId: bankAccountId,
      companyId,
      userId
    });
  } catch {
    // Auto-match is a convenience on top of the manual entry, which already
    // succeeded — a match-pass failure here shouldn't roll back the entry.
  }

  throw redirect(
    path.to.bankAccount(bankAccountId),
    await flash(request, success("Bank transaction added"))
  );
}
