import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getSequencesList } from "~/modules/settings";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  const url = new URL(request.url);
  const table = url.searchParams.get("table");

  if (!table) {
    return {
      data: [],
      error: null
    };
  }

  return await getSequencesList(table);
}
