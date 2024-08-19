import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getServicesList } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const services = await getServicesList(client, companyId);
  if (services.error) {
    return json(
      services,
      await flash(request, error(services.error, "Failed to get services"))
    );
  }

  return json(services);
}
