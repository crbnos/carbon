import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getMaterialFormsList } from "~/modules/items/items.service.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  return await getMaterialFormsList();
}
