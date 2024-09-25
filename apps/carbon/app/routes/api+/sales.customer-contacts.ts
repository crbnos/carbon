import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getCustomerContacts } from "~/modules/sales";

export async function loader({ request }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {
    view: "sales",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const customerId = searchParams.get("customerId") as string;

  if (!customerId || customerId === "undefined")
    return json({
      data: [],
    });

  const contacts = await getCustomerContacts(authorized.client, customerId);
  if (contacts.error) {
    return json(
      contacts,
      await flash(
        request,
        error(contacts.error, "Failed to get customer contacts")
      )
    );
  }

  return json(contacts);
}
