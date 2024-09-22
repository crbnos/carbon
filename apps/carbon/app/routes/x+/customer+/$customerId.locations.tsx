import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { CustomerLocations, getCustomerLocations } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const locations = await getCustomerLocations(client, customerId);
  if (locations.error) {
    throw redirect(
      path.to.customer(customerId),
      await flash(
        request,
        error(locations.error, "Failed to fetch customer locations")
      )
    );
  }

  return json({
    locations: locations.data ?? [],
  });
}

export default function CustomerLocationsRoute() {
  const { locations } = useLoaderData<typeof loader>();

  return <CustomerLocations locations={locations} />;
}
