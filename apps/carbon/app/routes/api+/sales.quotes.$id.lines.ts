import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getQuoteLinesList } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { id } = params;
  if (!id) return json({ data: [], error: null });

  return json(await getQuoteLinesList(client, id));
}
