import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getSequencesList } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const table = url.searchParams.get("table");

  if (!table) {
    return json({
      data: [],
      error: null,
    });
  }

  return json(await getSequencesList(client, table, companyId));
}
