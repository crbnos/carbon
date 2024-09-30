import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getCountries } from "~/modules/shared";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  return json(await getCountries(client));
}
