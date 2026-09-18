import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getCustomerBankAccounts } from "~/modules/sales";
import CustomerBankAccounts from "~/modules/sales/ui/Customer/CustomerBankAccounts";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const bankAccounts = await getCustomerBankAccounts(client, customerId);
  if (bankAccounts.error) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(bankAccounts.error, "Failed to fetch customer bank accounts")
      )
    );
  }

  return {
    bankAccounts: bankAccounts.data ?? []
  };
}

export default function CustomerBankAccountsRoute() {
  const { bankAccounts } = useLoaderData<typeof loader>();

  return <CustomerBankAccounts bankAccounts={bankAccounts} />;
}
