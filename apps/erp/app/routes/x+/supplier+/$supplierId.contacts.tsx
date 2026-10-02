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
import { getSupplierContacts } from "~/modules/purchasing";
import SupplierContacts from "~/modules/purchasing/ui/Supplier/SupplierContacts";
import { path } from "~/utils/path";

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["supplierId"] })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const contacts = await getSupplierContacts(client, supplierId);
  if (contacts.error) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(contacts.error, "Failed to fetch supplier contacts")
      )
    );
  }

  return {
    contacts: contacts.data ?? []
  };
}

export default function SupplierContactsRoute() {
  const { contacts } = useLoaderData<typeof loader>();

  return <SupplierContacts contacts={contacts} />;
}
