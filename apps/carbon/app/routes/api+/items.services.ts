import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type { ServiceType } from "~/modules/items";
import { getServicesList } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const type = searchParams.get("type") as ServiceType | null;

  const services = await getServicesList(client, companyId, type);
  if (services.error) {
    return json(
      services,
      await flash(request, error(services.error, "Failed to get services"))
    );
  }

  return json(services);
}
