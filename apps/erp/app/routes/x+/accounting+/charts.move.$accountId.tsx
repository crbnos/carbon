// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { moveAccountValidator } from "~/modules/accounting/accounting.models";
import {
  getAccount,
  getGroupAccounts
} from "~/modules/accounting/accounting.service";
import { MoveAccountForm } from "~/modules/accounting/ui/ChartOfAccounts";
import { path } from "~/utils/path";

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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(moveAccountValidator).request(args, {
    params: ["accountId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.accounting.moveAccount({
    accountId: input.params.accountId,
    parentId: input.data.parentId || undefined
  });
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
