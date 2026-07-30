import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  accountValidator,
  getAccount,
  getGroupAccounts,
  groupAccountValidator,
  upsertAccount
} from "~/modules/accounting";
import {
  ChartOfAccountForm,
  GroupAccountForm
} from "~/modules/accounting/ui/ChartOfAccounts";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { accountsQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { accountId } = params;
  if (!accountId) throw notFound("accountId not found");

  const [account, groupAccounts] = await Promise.all([
    getAccount(client, accountId),
    getGroupAccounts(client, companyGroupId)
  ]);

  return {
    account: account?.data ?? null,
    groupAccounts: groupAccounts.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  // Root accounts (Balance Sheet, Income Statement) cannot be modified
  const { accountId } = params;
  if (accountId) {
    const existing = await getAccount(client, accountId);
    if (existing.data?.isSystem) {
      throw redirect(
        path.to.chartOfAccounts,
        await flash(request, error(null, "Root accounts cannot be modified"))
      );
    }
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "group") {
    const validation = await validator(groupAccountValidator).validate(
      formData
    );

    if (validation.error) {
      return validationError(validation.error);
    }

    const { id, ...d } = validation.data;
    if (!id) throw new Error("id not found");

    const updateAccount = await upsertAccount(client, {
      id,
      ...d,
      number: null,
      isGroup: true,
      consolidatedRate: "Average",
      parentId: d.parentId || undefined,
      updatedBy: userId
    });

    if (updateAccount.error) {
      return data(
        {},
        await flash(
          request,
          error(updateAccount.error, "Failed to update group")
        )
      );
    }

    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, success("Updated group"))
    );
  }

  const validation = await validator(accountValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateAccount = await upsertAccount(client, {
    id,
    ...d,
    parentId: d.parentId || undefined,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });

  if (updateAccount.error) {
    return data(
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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    accountsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function EditChartOfAccountsRoute() {
  const { account, groupAccounts } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.chartOfAccounts);

  if (account?.isGroup) {
    const groupInitialValues = {
      id: account.id,
      name: account.name ?? "",
      parentId: account.parentId ?? undefined,
      accountType: account.accountType ?? undefined,
      class: account.class ?? "Asset",
      incomeBalance: account.incomeBalance ?? "Balance Sheet"
    };

    return (
      <GroupAccountForm
        key={account.id}
        initialValues={groupInitialValues}
        groupAccounts={groupAccounts}
        onClose={onClose}
      />
    );
  }

  const initialValues = {
    id: account?.id ?? undefined,
    number: account?.number ?? "",
    name: account?.name ?? "",
    parentId: account?.parentId ?? undefined,
    isGroup: account?.isGroup ?? false,
    accountType: account?.accountType ?? undefined,
    class: account?.class ?? "Asset",
    incomeBalance: account?.incomeBalance ?? "Balance Sheet",
    consolidatedRate: account?.consolidatedRate ?? "Average",
    ...getCustomFields(account?.customFields)
  };

  return (
    <ChartOfAccountForm
      key={initialValues.id}
      initialValues={initialValues}
      groupAccounts={groupAccounts}
      onClose={onClose}
    />
  );
}
