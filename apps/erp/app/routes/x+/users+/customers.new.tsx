// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { CreateCustomerModal } from "~/modules/users/ui";
import { createCustomerAccountValidator } from "~/modules/users/users.models";
import { originOf } from "~/modules/users/users.service";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(createCustomerAccountValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { ip, city } = originOf(args.request);
  const api = await carbon(args.request);
  const result = await api.users.inviteCustomerContact({
    customerContactId: input.data.id,
    customerId: input.data.customer,
    ip,
    city
  });
  // Invited from a customer's contacts: go back there.
  const customerRedirect = new URL(args.request.url).searchParams.get(
    "customer"
  );
  return respond(args.request, result).redirect(
    customerRedirect && !result.error
      ? path.to.customerContacts(customerRedirect)
      : path.to.customerAccounts,
    { message: "Customer invited" }
  );
}

export default function () {
  return <CreateCustomerModal />;
}
