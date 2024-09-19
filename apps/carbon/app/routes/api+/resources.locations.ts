import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getLocationsList } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  return json(await getLocationsList(client, companyId));
}
