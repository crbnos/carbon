import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type { CustomerBankAccount } from "~/modules/sales";
import { deleteCustomerBankAccount } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { customerId, id } = params;
  if (!customerId) throw new Error("Could not find customerId");
  if (!id) throw new Error("Could not find id");

  const remove = await deleteCustomerBankAccount(client, id);

  if (remove.error) {
    throw redirect(
      path.to.customerBankAccounts(customerId),
      await flash(
        request,
        error(remove.error, "Failed to delete customer bank account")
      )
    );
  }

  return redirect(path.to.customerBankAccounts(customerId));
}

export default function DeleteCustomerBankAccountRoute() {
  const navigate = useNavigate();
  const { t } = useLingui();
  const { customerId, id } = useParams();
  if (!customerId) throw new Error("Could not find customerId");
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{ bankAccounts: CustomerBankAccount[] }>(
    path.to.customerBankAccounts(customerId)
  );

  const bankAccount = routeData?.bankAccounts.find(
    (account) => account.id === id
  );
  if (!bankAccount) throw new Error("Could not find bank account");

  return (
    <ConfirmDelete
      action={path.to.deleteCustomerBankAccount(customerId, id)}
      isOpen
      name={bankAccount.name}
      text={t`Are you sure you want to permanently delete this bank account?`}
      onCancel={() => navigate(-1)}
    />
  );
}
