import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getSupplierLocations } from "~/modules/purchasing";
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

  const locations = await getSupplierLocations(authorized.client, supplierId);
  if (locations.error) {
    return json(
      locations,
      await flash(
        request,
        error(locations.error, "Failed to get supplier locations")
      )
    );
  }

  return json(locations);
}
