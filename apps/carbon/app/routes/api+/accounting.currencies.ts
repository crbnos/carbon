import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getCurrenciesList } from "~/modules/accounting";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {});

  return json(await getCurrenciesList(client));
}
