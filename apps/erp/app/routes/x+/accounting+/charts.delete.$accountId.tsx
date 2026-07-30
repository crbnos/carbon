import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteAccount, getAccount } from "~/modules/accounting";
import { path } from "~/utils/path";
import { accountsQuery, getCompanyId } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });
  const { accountId } = params;
  if (!accountId) throw notFound("accountId not found");

  const account = await getAccount(client, accountId);
  if (account.error) {
    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, error(account.error, "Failed to get account"))
    );
  }

  return { account: account.data };
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

  const { error: deleteTypeError } = await deleteAccount(client, accountId);
  if (deleteTypeError) {
    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, error(deleteTypeError, "Failed to delete account"))
    );
  }

  throw redirect(
    path.to.chartOfAccounts,
    await flash(request, success("Successfully deleted account"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    accountsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function DeleteAccountRoute() {
  const { accountId } = useParams();
  const { account } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!accountId || !account) return null; // TODO - handle this better (404?)

  const onCancel = () => navigate(path.to.chartOfAccounts);

  return (
    <ConfirmDelete
      action={path.to.deleteAccountingCharts(accountId)}
      name={account.name}
      text={t`Are you sure you want to delete the account: ${account.name}${account.number ? ` (${account.number})` : ""}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
