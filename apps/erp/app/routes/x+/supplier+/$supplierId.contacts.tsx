// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getSupplierContacts } from "~/modules/purchasing/purchasing.service";
import SupplierContacts from "~/modules/purchasing/ui/Supplier/SupplierContacts";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const [contacts, supplier] = await Promise.all([
    getSupplierContacts(client, supplierId),
    client
      .from("supplier")
      .select("requireContactEmail")
      .eq("id", supplierId)
      .maybeSingle()
  ]);
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
    contacts: contacts.data ?? [],
    requireContactEmail: supplier.data?.requireContactEmail ?? false
  };
}

export default function SupplierContactsRoute() {
  const { contacts, requireContactEmail } = useLoaderData<typeof loader>();

  return (
    <SupplierContacts
      contacts={contacts}
      requireContactEmail={requireContactEmail}
    />
  );
}
