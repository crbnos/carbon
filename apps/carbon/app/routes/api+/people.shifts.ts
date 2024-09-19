import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getShiftsList } from "~/modules/people";
import { requirePermissions } from "~/services/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {});

  const url = new URL(request.url);
  const location = url.searchParams.get("location");

  return json(await getShiftsList(authorized.client, location));
}
