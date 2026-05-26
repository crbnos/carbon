import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getTagsList } from "~/modules/shared/shared.service.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});
  const url = new URL(request.url);
  const table = url.searchParams.get("table");

  return await getTagsList(table as string | null);
}
