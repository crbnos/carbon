import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getShelvesList } from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
  });

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId");
  if (!locationId) {
    return json({
      data: [],
      error: null,
    });
  }

  return json(await getShelvesList(client, locationId));
}
