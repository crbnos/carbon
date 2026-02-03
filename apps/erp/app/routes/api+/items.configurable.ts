import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  return await client
    .from("itemReplenishment")
    .select("itemId")
    .eq("requiresConfiguration", true)
    .eq("companyId", companyId);
}
