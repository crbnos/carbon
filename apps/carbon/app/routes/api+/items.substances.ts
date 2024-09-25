import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getMaterialSubstancesList } from "~/modules/items";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  return json(await getMaterialSubstancesList(client, companyId));
}
