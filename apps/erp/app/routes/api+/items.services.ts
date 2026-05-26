import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getServicesList } from "~/modules/items/items.service.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts"
  });

  const services = await getServicesList();
  if (services.error) {
    return data(
      services,
      await flash(request, error(services.error, "Failed to get services"))
    );
  }

  return services;
}
