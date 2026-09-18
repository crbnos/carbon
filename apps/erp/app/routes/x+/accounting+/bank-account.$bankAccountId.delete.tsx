import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteCompanyBankAccount,
  getCompanyBankAccount
} from "~/modules/accounting";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const { bankAccountId } = params;
  if (!bankAccountId) throw notFound("bankAccountId not found");

  const account = await getCompanyBankAccount(client, bankAccountId);
  if (account.error) {
    throw redirect(
      path.to.bankAccounts,
      await flash(request, error(account.error, "Failed to get bank account"))
    );
  }

  return { account: account.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { bankAccountId } = params;
  if (!bankAccountId) {
    throw redirect(
      path.to.bankAccounts,
      await flash(request, error(params, "Failed to get bank account id"))
    );
  }

  const { error: deleteError } = await deleteCompanyBankAccount(
    client,
    bankAccountId
  );
  if (deleteError) {
    throw redirect(
      path.to.bankAccounts,
      await flash(request, error(deleteError, "Failed to delete bank account"))
    );
  }

  throw redirect(
    path.to.bankAccounts,
    await flash(request, success("Successfully deleted bank account"))
  );
}

export default function DeleteBankAccountRoute() {
  const { bankAccountId } = useParams();
  const { account } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!account) return null;
  if (!bankAccountId) throw new Error("bankAccountId is not found");

  const onCancel = () => navigate(path.to.bankAccounts);

  return (
    <ConfirmDelete
      action={path.to.deleteBankAccount(bankAccountId)}
      name={account.name}
      text={`Are you sure you want to delete the bank account: ${account.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
