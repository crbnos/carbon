import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  bankTransactionMatchValidator,
  matchBankTransactionManually
} from "~/modules/accounting";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { bankAccountId, transactionId } = params;
  if (!bankAccountId) throw notFound("bankAccountId not found");
  if (!transactionId) throw notFound("transactionId not found");

  const formData = await request.formData();
  const validation = await validator(bankTransactionMatchValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await matchBankTransactionManually(client, {
    bankTransactionId: transactionId,
    journalLineId: validation.data.journalLineId,
    updatedBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.bankAccount(bankAccountId),
      await flash(request, error(result.error, "Failed to match transaction"))
    );
  }

  throw redirect(
    path.to.bankAccount(bankAccountId),
    await flash(request, success("Transaction matched"))
  );
}
