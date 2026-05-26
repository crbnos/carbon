import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getQuoteLinesList } from "~/modules/sales/sales.service.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) return { data: [], error: null };

  return await getQuoteLinesList(id);
}
