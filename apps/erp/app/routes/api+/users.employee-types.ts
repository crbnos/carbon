import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { getEmployeeTypes } from "~/modules/users";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "users",
    role: "employee"
  });

  return await getEmployeeTypes();
}
