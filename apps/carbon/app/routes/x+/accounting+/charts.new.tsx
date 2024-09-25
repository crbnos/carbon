import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import type {
  AccountClass,
  AccountConsolidatedRate,
  AccountIncomeBalance,
  AccountType,
} from "~/modules/accounting";
import {
  ChartOfAccountForm,
  accountValidator,
  upsertAccount,
} from "~/modules/accounting";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "accounting",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting",
  });

  const formData = await request.formData();
  const validation = await validator(accountValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertAccount = await upsertAccount(client, {
    ...data,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId,
  });
  if (insertAccount.error) {
    return json(
      {},
      await flash(
        request,
        error(insertAccount.error, "Failed to insert account")
      )
    );
  }

  const accountNumber = insertAccount.data?.id;
  if (!accountNumber) {
    return json(
      {},
      await flash(request, error(insertAccount, "Failed to insert account"))
    );
  }

  throw redirect(
    path.to.chartOfAccounts,
    await flash(request, success("Account created"))
  );
}

export default function NewAccountRoute() {
  const initialValues = {
    name: "",
    number: "",
    type: "Posting" as AccountType,
    accountCategoryId: "",
    class: "Asset" as AccountClass,
    incomeBalance: "Balance Sheet" as AccountIncomeBalance,
    consolidatedRate: "Average" as AccountConsolidatedRate,
    directPosting: false,
  };

  return <ChartOfAccountForm initialValues={initialValues} />;
}
