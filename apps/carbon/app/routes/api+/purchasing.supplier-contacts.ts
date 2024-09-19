import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getSupplierContacts } from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

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
