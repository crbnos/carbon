import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getTagsList } from "~/modules/shared";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});
  const url = new URL(request.url);
  const table = url.searchParams.get("table");

  return json(await getTagsList(client, companyId, table as string | null));
}
