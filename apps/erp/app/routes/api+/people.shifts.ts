import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getShiftsList } from "~/modules/people";

export async function loader({ request }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {});

  const url = new URL(request.url);
  const location = url.searchParams.get("location");

  return await getShiftsList(authorized.client, authorized.companyId, location);
}
