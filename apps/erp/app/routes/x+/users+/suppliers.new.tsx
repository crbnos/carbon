// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { CreateSupplierModal } from "~/modules/users/ui";
import { createSupplierAccountValidator } from "~/modules/users/users.models";
import { originOf } from "~/modules/users/users.service";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(createSupplierAccountValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { ip, city } = originOf(args.request);
  const api = await carbon(args.request);
  const result = await api.users.inviteSupplierContact({
    supplierContactId: input.data.id,
    supplierId: input.data.supplier,
    ip,
    city
  });
  // Invited from a supplier's contacts: go back there.
  const supplierRedirect = new URL(args.request.url).searchParams.get(
    "supplier"
  );
  return respond(args.request, result).redirect(
    supplierRedirect && !result.error
      ? path.to.supplierContacts(supplierRedirect)
      : path.to.supplierAccounts,
    { message: "Supplier invited" }
  );
}

export default function () {
  return <CreateSupplierModal />;
}
