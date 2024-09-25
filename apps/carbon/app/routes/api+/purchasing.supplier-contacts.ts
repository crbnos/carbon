import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getSupplierContacts } from "~/modules/purchasing";

export async function loader({ request }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {
    view: "purchasing",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const supplierId = searchParams.get("supplierId") as string;

  if (!supplierId || supplierId === "undefined")
    return json({
      data: [],
    });

  const contacts = await getSupplierContacts(authorized.client, supplierId);
  if (contacts.error) {
    return json(
      contacts,
      await flash(
        request,
        error(contacts.error, "Failed to get supplier contacts")
      )
    );
  }

  return json(contacts);
}
