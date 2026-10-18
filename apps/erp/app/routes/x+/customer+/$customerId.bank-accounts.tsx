// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import CustomerBankAccounts from "~/modules/sales/ui/Customer/CustomerBankAccounts";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "accounting"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const bankAccounts = await api.sales.getCustomerBankAccounts({ customerId });
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
