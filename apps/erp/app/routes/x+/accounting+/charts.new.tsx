import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useSearchParams
} from "react-router";

import type { AccountClass, AccountIncomeBalance } from "~/modules/accounting";
import {
  accountValidator,
  getGroupAccounts,
  upsertAccount
} from "~/modules/accounting";
import { ChartOfAccountForm } from "~/modules/accounting/ui/ChartOfAccounts";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { accountsQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {
    create: "accounting"
  });

  const groupAccounts = await getGroupAccounts(client, companyGroupId);

  return {
    groupAccounts: groupAccounts.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(accountValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertAccount = await upsertAccount(client, {
    ...d,
    parentId: d.parentId || undefined,
    companyGroupId,
    customFields: setCustomFields(formData),
    createdBy: userId
  });
  if (insertAccount.error) {
    return data(
      {},
      await flash(
        request,
        error(insertAccount.error, "Failed to insert account")
      )
    );
  }

  const accountId = insertAccount.data?.id;
  if (!accountId) {
    return data(
      {},
      await flash(request, error(insertAccount, "Failed to insert account"))
    );
  }

  throw redirect(
    path.to.chartOfAccounts,
    await flash(request, success("Account created"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    accountsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewAccountRoute() {
  const { groupAccounts } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const parentId = searchParams.get("parentId") ?? undefined;

  const initialValues = {
    name: "",
    number: "",
    parentId,
    isGroup: false,
    accountType: undefined,
    class: "Asset" as AccountClass,
    incomeBalance: "Balance Sheet" as AccountIncomeBalance,
    consolidatedRate: "Average" as const
  };

  return (
    <ChartOfAccountForm
      initialValues={initialValues}
      groupAccounts={groupAccounts}
      onClose={() => navigate(path.to.chartOfAccounts)}
    />
  );
}
