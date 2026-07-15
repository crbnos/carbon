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
  getAccount,
  getGroupAccounts,
  moveAccountValidator
} from "~/modules/accounting";
import { MoveAccountForm } from "~/modules/accounting/ui/ChartOfAccounts";
import { path } from "~/utils/path";
import { accountsQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyGroupId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { accountId } = params;
  if (!accountId) throw notFound("accountId not found");

  const [account, allGroupAccounts] = await Promise.all([
    getAccount(client, accountId),
    getGroupAccounts(client, companyGroupId)
  ]);

  if (account.error || !account.data) {
    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, error(account.error, "Failed to get account"))
    );
  }

  // Filter out the account itself and its descendants to prevent cycles
  const allAccounts = allGroupAccounts.data ?? [];
  const descendantIds = new Set<string>();

  // Build a simple parent-child map from all group accounts
  // We need to fetch all accounts to find descendants
  const allAccountsResult = await client
    .from("account")
    .select("id, parentId")
    .eq("companyGroupId", companyGroupId)
    .eq("active", true);

  const accountsList = allAccountsResult.data ?? [];
  const childrenMap = new Map<string, string[]>();
  for (const a of accountsList) {
    if (a.parentId) {
      const children = childrenMap.get(a.parentId) ?? [];
      children.push(a.id);
      childrenMap.set(a.parentId, children);
    }
  }

  // Walk descendants of the account being moved
  function collectDescendants(id: string) {
    descendantIds.add(id);
    for (const childId of childrenMap.get(id) ?? []) {
      collectDescendants(childId);
    }
  }
  collectDescendants(accountId);

  const validGroupAccounts = allAccounts.filter(
    (a) => !descendantIds.has(a.id)
  );

  return {
    account: account.data,
    groupAccounts: validGroupAccounts
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { accountId } = params;
  if (!accountId) throw notFound("accountId not found");

  const formData = await request.formData();
  const validation = await validator(moveAccountValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { parentId } = validation.data;

  // Get the new parent's class and incomeBalance so the moved account inherits them
  let updateData: Record<string, unknown> = {
    parentId: parentId || null,
    updatedBy: userId
  };

  if (parentId) {
    const parent = await client
      .from("account")
      .select("class, incomeBalance")
      .eq("id", parentId)
      .single();

    if (parent.error || !parent.data) {
      return data(
        {},
        await flash(
          request,
          error(parent.error, "Failed to get parent account")
        )
      );
    }

    updateData = {
      ...updateData,
      class: parent.data.class,
      incomeBalance: parent.data.incomeBalance
    };
  }

  const result = await client
    .from("account")
    .update(updateData)
    .eq("id", accountId)
    .select("id")
    .single();

  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, "Failed to move account"))
    );
  }

  throw redirect(
    path.to.chartOfAccounts,
    await flash(request, success("Account moved"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    accountsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function MoveAccountRoute() {
  const { account, groupAccounts } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <MoveAccountForm
      accountId={account.id}
      accountName={account.name}
      groupAccounts={groupAccounts}
      currentParentId={account.parentId}
      onClose={() => navigate(path.to.chartOfAccounts)}
    />
  );
}
