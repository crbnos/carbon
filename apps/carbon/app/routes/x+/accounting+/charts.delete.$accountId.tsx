import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteAccount, getAccount } from "~/modules/accounting";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
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

  return json({ account: account.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "accounting",
  });

  const { accountId } = params;
  if (!accountId) {
    throw redirect(
      path.to.chartOfAccounts,
      await flash(request, error(params, "Failed to get an account id"))
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

export default function DeleteAccountRoute() {
  const { accountId } = useParams();
  const { account } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!accountId || !account) return null; // TODO - handle this better (404?)

  const onCancel = () => navigate(path.to.chartOfAccounts);

  return (
    <ConfirmDelete
      action={path.to.deleteAccountingCharts(accountId)}
      name={account.name}
      text={`Are you sure you want to delete the account: ${account.name} (${account.number})? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
