// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { deleteCustomerContact } from "~/modules/sales";
import { path } from "~/utils/path";
import { customerContactsQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "sales"
  });

  const { customerId, customerContactId } = params;
  if (!customerId || !customerContactId) {
    throw redirect(
      path.to.customers,
      await flash(request, error(params, "Failed to get a customer contact id"))
    );
  }

  // TODO: check whether this person has an account or is a partner first

  const { error: deleteCustomerContactError } = await deleteCustomerContact(
    client,
    customerId,
    customerContactId
  );
  if (deleteCustomerContactError) {
    throw redirect(
      path.to.customerContacts(customerId),
      await flash(
        request,
        error(deleteCustomerContactError, "Failed to delete customer contact")
      )
    );
  }

  throw redirect(
    path.to.customerContacts(customerId),
    await flash(request, success("Successfully deleted customer contact"))
  );
}

export async function clientAction({
  serverAction,
  params
}: ClientActionFunctionArgs) {
  const { customerId } = params;
  if (customerId) {
    window.clientCache?.setQueryData(
      customerContactsQuery(customerId).queryKey,
      null
    );
  }
  return await serverAction();
}
