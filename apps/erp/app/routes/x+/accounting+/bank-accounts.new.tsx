import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  companyBankAccountValidator,
  upsertCompanyBankAccount
} from "~/modules/accounting";
import { CompanyBankAccountForm } from "~/modules/accounting/ui/BankReconciliation";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(companyBankAccountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...rest } = validation.data;

  const result = await upsertCompanyBankAccount(client, {
    ...rest,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.bankAccounts,
      await flash(request, error(result.error, "Failed to create bank account"))
    );
  }

  throw redirect(
    path.to.bankAccount(result.data.id),
    await flash(request, success("Bank account created"))
  );
}

export default function NewBankAccountRoute() {
  const navigate = useNavigate();

  const initialValues = {
    name: "",
    glAccountId: "",
    currencyCode: "USD",
    active: true
  };

  return (
    <CompanyBankAccountForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
