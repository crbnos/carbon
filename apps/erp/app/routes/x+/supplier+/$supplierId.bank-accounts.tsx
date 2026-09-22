import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getSupplierBankAccounts } from "~/modules/purchasing";
import SupplierBankAccounts from "~/modules/purchasing/ui/Supplier/SupplierBankAccounts";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const bankAccounts = await getSupplierBankAccounts(client, supplierId);
  if (bankAccounts.error) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(bankAccounts.error, "Failed to fetch supplier bank accounts")
      )
    );
  }

  return {
    bankAccounts: bankAccounts.data ?? []
  };
}

export default function SupplierBankAccountsRoute() {
  const { bankAccounts } = useLoaderData<typeof loader>();

  return <SupplierBankAccounts bankAccounts={bankAccounts} />;
}
