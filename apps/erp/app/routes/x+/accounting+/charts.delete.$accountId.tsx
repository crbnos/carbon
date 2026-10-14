// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { isAccountInUse } from "@carbon/database/account-import-reads";
import { getLogger } from "@carbon/logger";
import { getDatabaseErrorMessage, redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteAccount, getAccount } from "~/modules/accounting";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "accounting/charts.delete");

/** Shown when anything refers to the account; the database refuses it too. */
const IN_USE_MESSAGE =
  "This account is used by documents, journals or default accounts, so it cannot be deleted.";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    { view: "accounting" }
  );
  const { accountId } = params;
  if (!accountId) throw notFound("accountId not found");

  const account = await getAccount(client, accountId);
  if (account.error) {
    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, error(account.error, "Failed to get account"))
    );
  }

  // Across every company of the group: the chart is shared.
  let inUse: boolean;
  try {
    inUse = await isAccountInUse(
      getDatabaseClient(),
      companyGroupId,
      accountId
    );
  } catch (err) {
    logger.error("Failed to check whether an account is in use", {
      companyId,
      accountId,
      error: err
    });
    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, error(err, "Failed to get account"))
    );
  }

  return { account: account.data, inUse };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
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

  const { error: deleteError } = await deleteAccount(client, accountId);
  if (deleteError) {
    throw redirect(
      path.to.chartOfAccounts,
      await flash(
        request,
        error(
          deleteError,
          getDatabaseErrorMessage(deleteError, "Failed to delete account", {
            referenced: IN_USE_MESSAGE
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

  return (
    <ConfirmDelete
      action={path.to.deleteAccountingCharts(accountId)}
      name={account.name}
      text={
        inUse
          ? t`${label} is used by documents, journals or default accounts, so it cannot be deleted.`
          : t`Are you sure you want to delete the account: ${label}? This cannot be undone.`
      }
      isDisabled={inUse}
      onCancel={onCancel}
    />
  );
}
