// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getDatabaseErrorMessage, redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deactivateAccount,
  deleteAccount,
  getAccount,
  getAccountInUse
} from "~/modules/accounting";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });
  const { accountId } = params;
  if (!accountId) throw notFound("accountId not found");

  const [account, inUse] = await Promise.all([
    getAccount(client, accountId),
    getAccountInUse(client, accountId)
  ]);
  if (account.error) {
    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, error(account.error, "Failed to get account"))
    );
  }

  return { account: account.data, inUse: inUse.data ?? false };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { accountId } = params;
  if (!accountId) {
    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, error(params, "Failed to get an account id"))
    );
  }

  // Root accounts (Balance Sheet, Income Statement) cannot be deleted
  const existing = await getAccount(client, accountId);
  if (existing.data?.isSystem) {
    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, error(null, "Root accounts cannot be deleted"))
    );
  }

  const formData = await request.formData();
  if (formData.get("intent") === "deactivate") {
    const deactivated = await deactivateAccount(client, accountId, userId);
    if (deactivated.error) {
      throw redirect(
        path.to.chartOfAccounts,
        await flash(
          request,
          error(deactivated.error, "Failed to deactivate account")
        )
      );
    }
    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, success("Account deactivated"))
    );
  }

  const { error: deleteError } = await deleteAccount(client, accountId);
  if (deleteError) {
    throw redirect(
      path.to.chartOfAccounts,
      await flash(
        request,
        error(
          deleteError,
          getDatabaseErrorMessage(deleteError, "Failed to delete account", {
            referenced: "This account has postings. Deactivate it instead."
          })
        )
      )
    );
  }

  throw redirect(
    path.to.chartOfAccounts,
    await flash(request, success("Successfully deleted account"))
  );
}

export default function DeleteAccountRoute() {
  const { accountId } = useParams();
  const { account, inUse } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!accountId || !account) return null; // TODO - handle this better (404?)

  const onCancel = () => navigate(path.to.chartOfAccounts);
  const label = `${account.name}${account.number ? ` (${account.number})` : ""}`;

  if (inUse) {
    return (
      <ConfirmDelete
        action={path.to.deleteAccountingCharts(accountId)}
        name={account.name}
        title={t`Deactivate ${account.name}`}
        text={t`${label} has postings, so it cannot be deleted. Deactivate it instead: it stays in reports and history, and no longer appears in account pickers.`}
        deleteText={t`Deactivate`}
        fields={{ intent: "deactivate" }}
        onCancel={onCancel}
      />
    );
  }

  return (
    <ConfirmDelete
      action={path.to.deleteAccountingCharts(accountId)}
      name={account.name}
      text={t`Are you sure you want to delete the account: ${label}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
