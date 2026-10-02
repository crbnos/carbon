// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { isUnaffectedByNavigation } from "@carbon/utils";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { redirect, useLoaderData } from "react-router";
import { getCustomerBankAccounts } from "~/modules/sales";
import CustomerBankAccounts from "~/modules/sales/ui/Customer/CustomerBankAccounts";
import { path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["customerId"] })
    ? false
    : args.defaultShouldRevalidate;

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
