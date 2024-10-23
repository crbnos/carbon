import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getScrapReasonsList } from "~/modules/production";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
  });

  return json(await getScrapReasonsList(client, companyId));
}
