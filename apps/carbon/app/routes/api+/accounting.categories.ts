import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getAccountCategoriesList } from "~/modules/accounting";
import { requirePermissions } from "~/services/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  return json(await getAccountCategoriesList(client, companyId));
}
