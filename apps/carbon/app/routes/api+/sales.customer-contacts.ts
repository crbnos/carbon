import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getCustomerContacts } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

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
