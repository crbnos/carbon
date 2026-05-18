import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getDepartmentsList } from "~/modules/people";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  return await getDepartmentsList();
}
