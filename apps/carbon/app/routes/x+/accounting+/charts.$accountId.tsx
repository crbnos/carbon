import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import {
  accountValidator,
  ChartOfAccountForm,
  getAccount,
  upsertAccount,
} from "~/modules/accounting";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee",
  });

  const { accountId } = params;
  if (!accountId) throw notFound("accountId not found");

  const account = await getAccount(client, accountId);

  return json({
    account: account?.data ?? null,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting",
  });

  const formData = await request.formData();
  const validation = await validator(accountValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateAccount = await upsertAccount(client, {
    id,
    ...data,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });

  if (updateAccount.error) {
    return json(
      {},
      await flash(
        request,
        error(updateAccount.error, "Failed to update account")
      )
    );
  }

  throw redirect(
    path.to.chartOfAccounts,
    await flash(request, success("Updated account"))
  );
}

export default function EditChartOfAccountsRoute() {
  const { account } = useLoaderData<typeof loader>();

  const initialValues = {
    id: account?.id ?? undefined,
    number: account?.number ?? "",
    name: account?.name ?? "",
    type: account?.type ?? "Posting",
    accountCategoryId: account?.accountCategoryId ?? undefined,
    accountSubcategoryId: account?.accountSubcategoryId ?? undefined,
    class: account?.class ?? "Asset",
    incomeBalance: account?.incomeBalance ?? "Balance Sheet",
    consolidatedRate: account?.consolidatedRate ?? "Average",
    directPosting: account?.directPosting ?? false,
    ...getCustomFields(account?.customFields),
  };

  return (
    <ChartOfAccountForm key={initialValues.id} initialValues={initialValues} />
  );
}
