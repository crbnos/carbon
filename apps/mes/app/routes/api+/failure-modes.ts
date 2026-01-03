import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getFailureModesList } from "~/services/operations.service";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  return await getFailureModesList(client, companyId);
}
