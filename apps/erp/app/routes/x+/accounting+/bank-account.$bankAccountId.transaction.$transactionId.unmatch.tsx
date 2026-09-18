import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { unmatchBankTransaction } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { bankAccountId, transactionId } = params;
  if (!bankAccountId) throw notFound("bankAccountId not found");
  if (!transactionId) throw notFound("transactionId not found");

  const result = await unmatchBankTransaction(client, transactionId, userId);

  if (result.error) {
    throw redirect(
      path.to.bankAccount(bankAccountId),
      await flash(request, error(result.error, "Failed to unmatch transaction"))
    );
  }

  throw redirect(
    path.to.bankAccount(bankAccountId),
    await flash(request, success("Transaction unmatched"))
  );
}
